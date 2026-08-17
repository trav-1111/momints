import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import type { Umi } from '@metaplex-foundation/umi'
import type { RollDb } from '../db'
import { HttpError } from '../lib/http'
import { buildNftMetadata } from '../lib/metadata'
import { royaltiesPlugin } from '../lib/royalties'
import { sanitizeDisplayName } from '../lib/sanitize'
import { withBackoff } from '../lib/retry'
import type { FundingProvider, StorageProvider, TreasurySink } from '../providers/types'
import { sendAndConfirm } from '../solana/confirm'
import { generateCover } from './cover'
import { estimatedRollBytes, getRollFeeLamports, isRollSize, type RollSize } from './config'

export interface CreateRollRequest {
  wallet: string
  size: number
  /** User-editable vanity display name (prefilled app-side from the SKR handle). */
  artist?: string
  /** Verified SKR handle (resolved app-side). Falls back to the wallet address. */
  skrIdentity?: string
  /** Client-local calendar date (yyyy-mm-dd) so the roll name matches the shooter's day. */
  localDate?: string
  /** Client-reported fee-payment signature — bookkeeping context only. */
  feeSignature?: string
}

export interface CreateRollDeps {
  db: RollDb
  rpcUrl: string
  treasury: TreasurySink
  /**
   * Lazy on purpose: umi and the Irys seams are only constructed after
   * validation and the single-open-roll check pass, so invalid requests never
   * touch the bundler node or the RPC.
   */
  getUmi: () => Promise<Umi>
  getSeams: () => Promise<{ storage: StorageProvider; funding: FundingProvider }>
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Roll name date: the client's local calendar day when provided (a shooter at
 * 7pm PDT should not get tomorrow's UTC date on their roll), sanity-bounded
 * to ±1 day of server time; otherwise server UTC.
 */
function resolveDateLabel(localDate: string | undefined): string {
  const serverDay = new Date().toISOString().slice(0, 10)
  if (!localDate) return serverDay
  if (!DATE_SHAPE.test(localDate)) {
    throw new HttpError(400, `localDate must be yyyy-mm-dd, got "${localDate}"`)
  }
  const drift = Math.abs(Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${serverDay}T00:00:00Z`))
  if (Number.isNaN(drift) || drift > DAY_MS) {
    throw new HttpError(400, `localDate ${localDate} is more than a day away from server date ${serverDay}`)
  }
  return localDate
}

/**
 * Create a prepaid roll: validate -> single-open-roll check -> ensureFunded
 * PRE-CHECK (fail fast; never fund inline) -> derive `yyyy-mm-dd.NN` name ->
 * generate + upload the static cover -> upload collection metadata -> create
 * the immutable Metaplex Core collection -> persist to D1 -> record the fee
 * with the TreasurySink.
 */
export async function createRoll(deps: CreateRollDeps, req: CreateRollRequest) {
  const { db, rpcUrl, treasury, getUmi, getSeams } = deps

  // ---- Validation ----
  if (typeof req.wallet !== 'string' || !BASE58_ADDRESS.test(req.wallet)) {
    throw new HttpError(400, 'wallet must be a base58 Solana address')
  }
  if (typeof req.size !== 'number' || !isRollSize(req.size)) {
    throw new HttpError(400, `size must be 12 or 24, got ${JSON.stringify(req.size)}`)
  }
  const size: RollSize = req.size
  const skrIdentity = req.skrIdentity ? sanitizeDisplayName(req.skrIdentity) : req.wallet
  const artist = req.artist ? sanitizeDisplayName(req.artist) : skrIdentity
  if (!artist) {
    throw new HttpError(400, 'artist is empty after sanitization')
  }
  const dateLabel = resolveDateLabel(req.localDate)

  // ---- Single active roll ----
  const open = await db.getOpenRoll(req.wallet)
  if (open) {
    throw new HttpError(
      409,
      `Wallet already has an open roll (${open.name}, ${open.minted_count}/${open.size} minted, ` +
        `collection ${open.collection_address}). Finish or complete it first. ` +
        'Quick-shoot single mints remain available — they never count toward the roll.',
    )
  }

  // ---- Funding PRE-CHECK — fail fast, never fund inline ----
  const { storage, funding } = await getSeams()
  const fundingStatus = await funding.ensureFunded(estimatedRollBytes(size))
  if (!fundingStatus.sufficient) {
    throw new HttpError(
      503,
      `Roll creation refused: Irys storage balance is insufficient (have ${fundingStatus.balanceAtomic}, ` +
        `need ${fundingStatus.requiredAtomic} atomic for ~${fundingStatus.anticipatedBytes} bytes). ` +
        'This is an OPERATOR issue, not a user issue: top up the Irys balance per the README runbook. ' +
        'Funding takes 120+ seconds to confirm, so it is never attempted inside this request.',
    )
  }

  // ---- Name: `yyyy-mm-dd.NN`, NN = same-day index for this wallet ----
  const sameDay = await db.countRollsForDay(req.wallet, dateLabel)
  if (sameDay >= 99) {
    throw new HttpError(429, `Wallet already has 99 rolls dated ${dateLabel}`)
  }
  const name = `${dateLabel}.${String(sameDay + 1).padStart(2, '0')}`

  // ---- Cover (static for the roll's life) + collection metadata ----
  const cover = await generateCover(dateLabel, size)
  const coverUri = await storage.uploadImage(cover.bytes, cover.mime)
  const metadataUri = await storage.uploadJSON(
    buildNftMetadata({
      name,
      symbol: 'MOMINTS',
      description: `Momints roll ${name} — ${size} exposures by ${artist}.`,
      imageUri: coverUri,
      mime: cover.mime,
      attributes: [
        // Two separate identity fields, deliberately:
        // skr_identity = provenance/truth (immutable), artist = vanity display.
        { trait_type: 'skr_identity', value: skrIdentity },
        { trait_type: 'artist', value: artist },
        { trait_type: 'exposures', value: String(size) },
      ],
      creators: [{ address: req.wallet, share: 100 }],
    }),
  )

  // ---- On-chain collection ----
  //
  // The SHOOTER is the update authority from the moment the collection exists
  // — never the Worker. The Worker instead holds a scoped UpdateDelegate,
  // granted in this same instruction, which is what lets it mint frames into
  // the collection later (rolls/frames.ts). That delegate is revoked once the
  // roll completes (rolls/handoff.ts).
  //
  // This is the opposite of a leaked-key-proof design: the Worker's funding
  // key is a single keypair shared across every roll. Under the old model
  // (Worker as update authority) a leak of that key would have permanently
  // compromised every roll collection that ever existed — unrecoverable. Under
  // this one a leak revokes to a scoped, single-purpose delegate that can only
  // mint into collections, and that can be revoked out from under it.
  const umi = await getUmi()
  const { createCollection } = await import('@metaplex-foundation/mpl-core')
  const collectionSigner = generateSigner(umi)
  const blockhash = await withBackoff('getLatestBlockhash', () => umi.rpc.getLatestBlockhash())
  const tx = await createCollection(umi, {
    collection: collectionSigner,
    name,
    uri: metadataUri,
    updateAuthority: publicKey(req.wallet),
    plugins: [
      {
        type: 'UpdateDelegate',
        additionalDelegates: [],
        authority: { type: 'Address', address: umi.identity.publicKey },
      },
      // Collection-level, not per-frame: Core checks a member asset's own
      // collection for Royalties when the asset has none of its own, so one
      // plugin here covers every frame ever minted into this roll.
      royaltiesPlugin(publicKey(req.wallet)),
    ],
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi)
  const signature = await sendAndConfirm(umi, rpcUrl, tx)
  const collectionAddress = collectionSigner.publicKey.toString()

  // ---- Persist + fee bookkeeping ----
  await db.insertRoll({
    collectionAddress,
    wallet: req.wallet,
    name,
    size,
    artist,
    skrIdentity,
    coverUri,
    metadataUri,
    createSignature: signature,
  })

  const feeLamports = getRollFeeLamports(size)
  await treasury.record(feeLamports, {
    kind: 'roll_fee',
    collection: collectionAddress,
    wallet: req.wallet,
    size,
    feeSignature: req.feeSignature,
  })

  return {
    collectionAddress,
    name,
    size,
    artist,
    skrIdentity,
    coverUri,
    metadataUri,
    feeLamports,
    signature,
    status: 'OPEN' as const,
    mintedCount: 0,
    fundingWarning: fundingStatus.warning,
  }
}

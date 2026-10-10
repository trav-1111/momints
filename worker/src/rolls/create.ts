import { publicKey, type Umi } from '@metaplex-foundation/umi'
import type { RollDb, RollRow } from '../db'
import type { FeeCache } from '../fees/cache'
import { HttpError } from '../lib/http'
import { buildNftMetadata } from '../lib/metadata'
import { royaltiesPlugin } from '../lib/royalties'
import { sanitizeDisplayName } from '../lib/sanitize'
import type { FundingProvider, StorageProvider, TreasurySink } from '../providers/types'
import { getFinalizedBlockHeight, getSignatureStatus, sendAndConfirm } from '../solana/confirm'
import { rollCollectionSigner, signatureToBase58 } from '../solana/client'
import { deriveAta } from '../skr/ata'
import { SKR_MINT_ADDRESS } from '../skr/config'
import { generateCover } from './cover'
import { estimatedRollBytes, isRollSize } from './config'
import { verifyRollFeePayment } from './verify'
import { knownFilmStock } from '../filmstocks/catalogue'
import { assertRollCapability, hashRollCapability } from './auth'
import type { RollCreationStore } from './creationStore'

export interface CreateRollRequest {
  wallet: string
  size: number
  artist?: string
  skrIdentity?: string
  localDate?: string
  feeSignature: string
  payment?: 'SOL' | 'SKR'
  filmStockId?: string
  rollCapability: string
  quoteId?: string
  aspect?: 'full' | '1:1' | '4:3' | '16:9'
  filmMode?: 'color' | 'bw'
}
export interface CreateRollDeps {
  db: RollDb
  creations: RollCreationStore
  rpcUrl: string
  treasury: TreasurySink
  treasuryAddress: string
  feeCache: FeeCache
  getUmi: () => Promise<Umi>
  getSeams: () => Promise<{ storage: StorageProvider; funding: FundingProvider }>
}
function assertTerms(
  req: CreateRollRequest,
  saved: {
    wallet: string
    size: number
    payment: string
    authHash: string
    filmStockId?: string | null
    aspect?: string | null
    filmMode?: string | null
  },
  authHash: string,
) {
  if (saved.wallet !== req.wallet || saved.authHash !== authHash)
    throw new HttpError(403, 'Roll purchase authorization was refused')
  if (
    saved.size !== req.size ||
    saved.payment !== (req.payment ?? 'SOL') ||
    (saved.filmStockId && saved.filmStockId !== (req.filmStockId ?? 'momints-color-v1')) ||
    (saved.aspect && saved.aspect !== req.aspect) ||
    (saved.filmMode && saved.filmMode !== req.filmMode)
  ) {
    throw new HttpError(409, 'This receipt belongs to different roll settings. Recover its original purchase.')
  }
}
async function recordFee(deps: CreateRollDeps, row: RollRow) {
  if (row.fee_currency === 'SOL' && row.fee_lamports != null)
    await deps.treasury.record(row.fee_lamports, {
      kind: 'roll_fee',
      collection: row.collection_address,
      wallet: row.wallet,
      size: row.size,
      feeSignature: row.fee_signature!,
    })
}
async function replay(deps: CreateRollDeps, req: CreateRollRequest, row: RollRow, authHash: string) {
  assertTerms(
    req,
    {
      wallet: row.wallet,
      size: row.size,
      payment: row.fee_currency,
      authHash: row.auth_hash ?? '',
      filmStockId: row.film_stock_id,
      aspect: row.aspect,
      filmMode: row.film_mode,
    },
    authHash,
  )
  // Pre-migration rows carry the immutable recipe in their Arweave metadata.
  // Never silently claim the newly selected film was the original purchase.
  let filmStockId = row.film_stock_id
  if (!filmStockId) {
    const response = await fetch(row.metadata_uri)
    if (!response.ok) throw new HttpError(503, 'Original roll metadata is unavailable. Retry this receipt.')
    const metadata = (await response.json()) as { attributes?: { trait_type: string; value: string }[] }
    filmStockId = metadata.attributes?.find((a) => a.trait_type === 'filmStockId')?.value ?? 'momints-color-v1'
    if (filmStockId !== (req.filmStockId ?? 'momints-color-v1'))
      throw new HttpError(409, 'The original roll uses a different film recipe')
  }
  await recordFee(deps, row)
  await deps.creations.finish(req.feeSignature)
  return {
    collectionAddress: row.collection_address,
    name: row.name,
    size: row.size,
    artist: row.artist,
    skrIdentity: row.skr_identity,
    coverUri: row.cover_uri,
    metadataUri: row.metadata_uri,
    feeLamports: row.fee_lamports ?? 0,
    signature: row.create_signature,
    status: row.status,
    mintedCount: row.minted_count,
    fundingWarning: null,
    filmStockId,
    replayed: true,
  }
}
function dateLabel(local: string | undefined, reference: number) {
  const day = new Date(reference).toISOString().slice(0, 10)
  if (!local) return day
  const stamp = Date.parse(local + 'T00:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(local) ||
    !Number.isFinite(stamp) ||
    Math.abs(stamp - Date.parse(day + 'T00:00:00Z')) > 86400000
  )
    // A prepared purchase may sit unpaid for days before its quote refreshes.
    // Its stale display date cannot strand a newly verified payment.
    return day
  return local
}

/** A verified receipt reserves a wallet before uploads or chain writes. Every
 * external side effect has a durable checkpoint; retries share one address. */
export async function createRoll(deps: CreateRollDeps, req: CreateRollRequest) {
  const { db, creations, rpcUrl } = deps
  if (typeof req.wallet !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.wallet) || !isRollSize(req.size))
    throw new HttpError(400, 'Invalid roll wallet or size')
  if (req.payment !== undefined && req.payment !== 'SOL' && req.payment !== 'SKR')
    throw new HttpError(400, 'Invalid roll payment currency')
  if (req.aspect !== undefined && !['full', '1:1', '4:3', '16:9'].includes(req.aspect))
    throw new HttpError(400, 'Invalid roll aspect')
  if (req.filmMode !== undefined && !['color', 'bw'].includes(req.filmMode))
    throw new HttpError(400, 'Invalid roll film mode')
  assertRollCapability(req.rollCapability)
  const authHash = await hashRollCapability(req.rollCapability)
  if (typeof req.feeSignature !== 'string' || !req.feeSignature)
    throw new HttpError(402, 'The original feeSignature is required')
  // Receipt lookup MUST precede open-roll/date/live-price checks.
  const existing = await db.getRollByFeeSignature(req.feeSignature)
  if (existing) return replay(deps, req, existing, authHash)
  let data = await creations.get(req.feeSignature)
  if (data) assertTerms(req, data, authHash)
  if (!data) {
    if (await db.getOpenRoll(req.wallet))
      throw new HttpError(409, 'This wallet already has an open roll. Resume it; do not send another payment.')
    const filmStockId = req.filmStockId ?? 'momints-color-v1'
    if (!knownFilmStock(filmStockId)) throw new HttpError(400, 'Unknown film stock')
    const skrIdentity = req.skrIdentity ? sanitizeDisplayName(req.skrIdentity) : req.wallet
    const artist = req.artist ? sanitizeDisplayName(req.artist) : skrIdentity
    if (!artist) throw new HttpError(400, 'Artist is empty')
    let requiredLamports = 0
    let skr: { treasurySkrAta: string; requiredAtomic: number; quoteExpiresAt: string | null } | undefined
    let quoteCreatedAt: string | undefined, quoteExpiresAt: string | undefined
    if (req.quoteId) {
      const quote = await creations.quote(req.quoteId)
      if (
        !quote ||
        quote.wallet !== req.wallet ||
        quote.size !== req.size ||
        quote.currency !== (req.payment ?? 'SOL') ||
        quote.auth_hash !== authHash
      )
        throw new HttpError(403, 'Original purchase quote does not authorize this payment')
      quoteCreatedAt = quote.created_at
      quoteExpiresAt = quote.expires_at
      if (quote.currency === 'SOL') requiredLamports = quote.amount
      else skr = { treasurySkrAta: quote.treasury_ata!, requiredAtomic: quote.amount, quoteExpiresAt: quote.expires_at }
    } else if (req.payment === 'SKR') {
      const quote = await db.getRollSkrQuote(req.wallet)
      if (!quote || quote.size !== req.size)
        throw new HttpError(402, 'Original SKR quote is missing. Preserve the payment receipt for support.')
      const umi = await deps.getUmi()
      skr = {
        treasurySkrAta: deriveAta(umi, publicKey(deps.treasuryAddress), publicKey(SKR_MINT_ADDRESS)).toString(),
        requiredAtomic: quote.skr_amount_atomic,
        quoteExpiresAt: quote.expires_at,
      }
    } else {
      const fees = await deps.feeCache.get()
      if (!fees) throw new HttpError(503, 'Fee cache unavailable; retry the same receipt')
      requiredLamports = req.size === 12 ? fees.rollFee12Lamports : fees.rollFee24Lamports
    }
    const verdict = await verifyRollFeePayment(rpcUrl, {
      signature: req.feeSignature,
      wallet: req.wallet,
      treasury: deps.treasuryAddress,
      size: req.size,
      requiredLamports,
      skr,
      quoteCreatedAt,
      quoteExpiresAt,
    })
    if (!verdict.ok)
      throw new HttpError(
        verdict.retryable ? 503 : 402,
        `Roll fee: ${verdict.reason}. Preserve and retry this receipt; do not pay again.`,
      )
    const day = dateLabel(req.localDate, quoteCreatedAt ? Date.parse(quoteCreatedAt) : (verdict.paidAt ?? Date.now()))
    const count = await db.countRollsForDay(req.wallet, day)
    if (count >= 99) throw new HttpError(429, 'Daily roll limit reached; preserve the receipt for support')
    await creations.reserve(req.feeSignature, {
      wallet: req.wallet,
      size: req.size,
      filmStockId,
      artist,
      skrIdentity,
      payment: req.payment ?? 'SOL',
      authHash,
      dateLabel: day,
      name: `${day}.${String(count + 1).padStart(2, '0')}`,
      feeLamports: verdict.feeLamports,
      skrQuoteAtomic: skr?.requiredAtomic,
      aspect: req.aspect,
      filmMode: req.filmMode,
    })
  }
  const owner = crypto.randomUUID()
  if (!(await creations.claim(req.feeSignature, owner)))
    throw new HttpError(503, 'This roll is already being recovered. Retry the same receipt shortly.')
  try {
    // Reload after acquiring the lease; a racing request's durable terms win.
    data = (await creations.get(req.feeSignature))!
    assertTerms(req, data, authHash)
    const checkpoint = () => creations.checkpoint(req.feeSignature, owner, data!)
    const { storage, funding } = await deps.getSeams()
    const fundingStatus = await funding.ensureFunded(estimatedRollBytes(data.size))
    if (!fundingStatus.sufficient && !data.signedTransaction)
      throw new HttpError(503, 'Roll creation is waiting for operator storage funding. Your payment receipt is saved.')
    if (!data.coverUri) {
      const cover = await generateCover(data.dateLabel, data.size)
      data.coverUri = await storage.uploadImage(cover.bytes, cover.mime)
      await checkpoint()
    }
    if (!data.metadataUri) {
      data.metadataUri = await storage.uploadJSON(
        buildNftMetadata({
          name: data.name,
          symbol: 'MOMINTS',
          description: `Momints roll ${data.name} — ${data.size} exposures by ${data.artist}.`,
          imageUri: data.coverUri,
          mime: 'image/jpeg',
          attributes: [
            { trait_type: 'skr_identity', value: data.skrIdentity },
            { trait_type: 'artist', value: data.artist },
            { trait_type: 'exposures', value: String(data.size) },
            { trait_type: 'creatorAddress', value: data.wallet },
            { trait_type: 'filmStockId', value: data.filmStockId },
          ],
          creators: [{ address: data.wallet, share: 100 }],
        }),
      )
      await checkpoint()
    }
    const umi = await deps.getUmi()
    const signer = await rollCollectionSigner(umi, req.feeSignature)
    if (data.collectionAddress && data.collectionAddress !== signer.publicKey.toString())
      throw new HttpError(503, 'Creation signer changed. Restore the original signer before recovering this receipt.')
    data.collectionAddress = signer.publicKey.toString()
    data.signerAuthority = umi.identity.publicKey.toString()
    const { createCollection, safeFetchCollectionV1 } = await import('@metaplex-foundation/mpl-core')
    const collection = await safeFetchCollectionV1(umi, publicKey(data.collectionAddress))
    if (collection) {
      if (
        collection.uri !== data.metadataUri ||
        collection.name !== data.name ||
        collection.updateAuthority.toString() !== data.wallet
      )
        throw new HttpError(503, 'Existing collection does not match its saved creation. Operator review required.')
      const delegate = collection.updateDelegate?.authority
      if (delegate?.type !== 'Address' || delegate.address?.toString() !== data.signerAuthority)
        throw new HttpError(503, 'Original collection no longer delegates minting. Preserve this receipt for support.')
    } else {
      const status = data.signature ? await getSignatureStatus(rpcUrl, data.signature) : null
      if (status && !status.err && ['confirmed', 'finalized'].includes(status.confirmationStatus ?? ''))
        throw new HttpError(503, 'Confirmed collection is not visible yet. Retry the same receipt.')
      // Resend the identical signed transaction while its blockhash is valid.
      // If expired, rebuild at the SAME collection address, never a new signer.
      const expired =
        data.lastValidBlockHeight !== undefined && (await getFinalizedBlockHeight(rpcUrl)) > data.lastValidBlockHeight
      if (!data.signedTransaction || status?.err || expired) {
        const blockhash = await umi.rpc.getLatestBlockhash()
        const tx = await createCollection(umi, {
          collection: signer,
          name: data.name,
          uri: data.metadataUri,
          updateAuthority: publicKey(data.wallet),
          plugins: [
            {
              type: 'UpdateDelegate',
              additionalDelegates: [],
              authority: { type: 'Address', address: umi.identity.publicKey },
            },
            royaltiesPlugin(publicKey(data.wallet)),
            { type: 'ImmutableMetadata' },
          ],
        })
          .setBlockhash(blockhash)
          .buildAndSign(umi)
        data.signedTransaction = btoa(String.fromCharCode(...umi.transactions.serialize(tx)))
        data.signature = signatureToBase58(tx.signatures[0])
        data.lastValidBlockHeight = Number(blockhash.lastValidBlockHeight)
        await checkpoint() // identity, metadata, signed bytes BEFORE broadcasting
      }
      const tx = umi.transactions.deserialize(Uint8Array.from(atob(data.signedTransaction!), (c) => c.charCodeAt(0)))
      await sendAndConfirm(umi, rpcUrl, tx)
    }
    if (!data.signature) throw new HttpError(503, 'Creation receipt is incomplete; operator review required')
    await db.insertRoll({
      collectionAddress: data.collectionAddress,
      wallet: data.wallet,
      name: data.name,
      size: data.size,
      artist: data.artist,
      skrIdentity: data.skrIdentity,
      coverUri: data.coverUri,
      metadataUri: data.metadataUri,
      createSignature: data.signature,
      feeSignature: req.feeSignature,
      feeCurrency: data.payment,
      skrFeeAtomic: data.skrQuoteAtomic,
      protocolVersion: 2,
      authHash: data.authHash,
      filmStockId: data.filmStockId,
      filmMode: data.filmMode,
      aspect: data.aspect,
      feeLamports: data.feeLamports,
    })
    const row = await db.getRollByFeeSignature(req.feeSignature)
    if (!row) throw new HttpError(503, 'Roll persistence is not visible yet. Retry the same receipt.')
    return { ...(await replay(deps, req, row, authHash)), replayed: false, fundingWarning: fundingStatus.warning }
  } finally {
    await creations.release(req.feeSignature, owner)
  }
}

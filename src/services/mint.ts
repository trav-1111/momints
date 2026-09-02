import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore, create as createCoreAsset, fetchCollection, ruleSet } from '@metaplex-foundation/mpl-core'
import {
  createNoopSigner,
  generateSigner,
  publicKey,
  signTransaction as umiSignTransaction,
  transactionBuilder,
  type Umi,
  type PublicKey as UmiPublicKey,
  type BlockhashWithExpiryBlockHeight,
} from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { sendTransactionWithoutConfirmingFactory } from '@solana/kit'
import type { Signature } from '@solana/keys'
import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  getSignatureFromTransaction,
  getTransactionDecoder,
  type Transaction,
} from '@solana/transactions'
import type { Client } from '@wallet-ui/react-native-kit'

const COMPUTE_BUDGET_PROGRAM_ID = publicKey('ComputeBudget111111111111111111111111111111')
const DEFAULT_COMPUTE_UNIT_LIMIT = 300_000
const DEFAULT_COMPUTE_UNIT_PRICE = 100 // micro-lamports

function encodeSetComputeUnitLimit(units: number): Uint8Array {
  const data = new Uint8Array(5)
  data[0] = 2
  const view = new DataView(data.buffer)
  view.setUint32(1, units, true)
  return data
}

function encodeSetComputeUnitPrice(microLamports: number): Uint8Array {
  const data = new Uint8Array(9)
  data[0] = 3
  // Write u64 as two u32s (little-endian) — avoids BigInt for RN compatibility
  const view = new DataView(data.buffer)
  view.setUint32(1, microLamports >>> 0, true)
  view.setUint32(5, Math.floor(microLamports / 0x100000000), true)
  return data
}

function computeBudgetItems() {
  const limitItem = {
    instruction: {
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [] as never[],
      data: encodeSetComputeUnitLimit(DEFAULT_COMPUTE_UNIT_LIMIT),
    },
    signers: [] as never[],
    bytesCreatedOnChain: 0,
  }
  const priceItem = {
    instruction: {
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [] as never[],
      data: encodeSetComputeUnitPrice(DEFAULT_COMPUTE_UNIT_PRICE),
    },
    signers: [] as never[],
    bytesCreatedOnChain: 0,
  }
  return [limitItem, priceItem]
}

const SYSTEM_PROGRAM_ID = publicKey('11111111111111111111111111111111')

// System Program Transfer: u32 instruction index (2) + u64 lamports, LE.
// Written as two u32s to avoid BigInt (RN compatibility, same as above).
function encodeSystemTransfer(lamports: number): Uint8Array {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, 2, true)
  view.setUint32(4, lamports >>> 0, true)
  view.setUint32(8, Math.floor(lamports / 0x100000000), true)
  return data
}

/**
 * A SOL transfer as a transaction-builder item, so a fee can ride inside the
 * transaction it pays for. Lives here rather than in rollCollection.ts because
 * both the roll fee and the quick-mint fee need it, and rollCollection.ts
 * already depends on this module.
 */
export function transferSolItem(from: UmiPublicKey, to: UmiPublicKey, lamports: number) {
  return {
    instruction: {
      programId: SYSTEM_PROGRAM_ID,
      keys: [
        { pubkey: from, isSigner: true, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: true },
      ],
      data: encodeSystemTransfer(lamports),
    },
    signers: [],
    bytesCreatedOnChain: 0,
  }
}

// Momints earns on the mint fee, not on secondary sales. 100% of the royalty
// goes to the shooter; there is no platform cut. This is a DECIDED value, not
// a placeholder — mirrors ROYALTY_BASIS_POINTS in worker/src/lib/royalties.ts
// (kept in sync by hand: separate projects, no shared module between them).
const ROYALTY_BASIS_POINTS = 500 // 5%

/** The Royalties plugin, enforced on-chain, 100% to `creator`. */
function royaltiesPlugin(creator: UmiPublicKey) {
  return {
    type: 'Royalties' as const,
    basisPoints: ROYALTY_BASIS_POINTS,
    creators: [{ address: creator, percentage: 100 }],
    ruleSet: ruleSet('None'),
  }
}

export type MintPhaseCallback = (phase: 'signing' | 'confirming') => void

/**
 * Everything the Worker's POST /quick/stage hands back for a quick mint.
 *
 * The server owns all of it — fee, treasury, update authority, placeholder —
 * so pricing can move without an app release and the transaction the user
 * signs can never drift from what the Worker will verify.
 */
export interface QuickMintTerms {
  treasury: string
  feeLamports: number
  updateAuthority: string
}

export interface MintNFTParams {
  /** For a quick mint this is the placeholder URI, not the final metadata. */
  metadataUri: string
  name: string
  symbol: string
  walletAddress: string
  rpc?: string
  onPhase?: MintPhaseCallback
  /** Set for a Worker-backed quick mint: bundles the fee, mints a Core asset. */
  quick?: QuickMintTerms
  /**
   * Fired the moment a signature exists, BEFORE the transaction is sent.
   *
   * The confirm wait is the longest window in which the app can die holding a
   * mint the user has paid for, so anything that needs to survive a crash has
   * to be written here rather than from the return value.
   */
  onSigned?: (info: { signature: string; mintAddress: string }) => void
}

export interface MintNFTDeps {
  client: Pick<Client, 'rpc' | 'rpcSubscriptions'>
  signTransaction: (tx: Transaction) => Promise<Transaction>
}

/**
 * The user closing the wallet without approving. On Android MWA this surfaces
 * as `java.util.concurrent.CancellationException`, which reads like a crash and
 * is not one.
 *
 * Kept separate from useMint's categorizeError deliberately: hooks import from
 * services, so reaching the other way would be a cycle. Same reason
 * isRateLimitError lives here.
 */
function isUserCancellation(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('cancellationexception') ||
    msg.includes('cancel') ||
    msg.includes('declined') ||
    msg.includes('rejected') ||
    msg.includes('user dismissed') ||
    msg.includes('user closed')
  )
}

function devMintLog(phase: string, err: unknown): void {
  if (!__DEV__) return
  const msg = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
  const line = `[mint:${phase}]`
  const detail = cause ? `(cause: ${cause})` : ''
  // Declining is a normal outcome, not a failure — and now that quick mints
  // carry a fee, it is a common one. Logging it through console.error puts a
  // red LogBox overlay in front of the developer every time someone changes
  // their mind, which is exactly how a warning surface gets ignored.
  if (isUserCancellation(err)) {
    console.log(line, 'cancelled by user —', msg, detail)
    return
  }
  console.error(line, msg, detail)
}

function mintPhaseError(phaseLabel: string, err: unknown): Error {
  devMintLog(phaseLabel, err)
  const base = err instanceof Error ? err.message : String(err)
  return new Error(`Mint: ${phaseLabel} failed: ${base}`, {
    cause: err instanceof Error ? err : undefined,
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Backoff between rate-limited send retries. Length caps the retry count, and
 * the total stays well inside the shared blockhash's validity window. */
const SEND_RETRY_BACKOFFS_MS = [400, 800, 1600]

/** Transient throttling from the RPC (a shared/public endpoint rate-limits
 * hard once a chunk sends and polls in parallel) — worth retrying, unlike a
 * malformed transaction or an on-chain failure. */
function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return msg.includes('429') || msg.includes('503') || msg.includes('too many requests') || msg.includes('rate limit')
}

async function waitUntilSignatureConfirmed(rpc: Client['rpc'], signature: Signature, maxAttempts = 45): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    // A throttled status poll says nothing about the transaction — it may
    // already have landed. Treating it as a failure would report a false
    // negative, and the retry would mint a duplicate asset. Back off and keep
    // polling within the same attempt budget.
    const status = await rpc
      .getSignatureStatuses([signature])
      .send()
      .then((r) => r.value[0])
      .catch((e) => {
        if (!isRateLimitError(e)) throw e
        return 'throttled' as const
      })

    if (status === 'throttled') {
      await delay(2000)
      continue
    }
    if (status?.err) {
      throw new Error(typeof status.err === 'string' ? status.err : JSON.stringify(status.err))
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return
    }
    await delay(1000)
  }
  throw new Error('Transaction confirmation timed out')
}

export function createMintUmi(walletAddress: string, rpcOverride?: string): { umi: Umi; walletPk: UmiPublicKey } {
  const rpcUrl = rpcOverride ?? process.env.EXPO_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
  const umi = createUmi(rpcUrl).use(mplCore())
  const walletPk = publicKey(walletAddress)
  const noopWallet = createNoopSigner(walletPk)
  umi.payer = noopWallet
  umi.identity = noopWallet
  return { umi, walletPk }
}

/** What `create` needs to attach an asset to a collection — always fetched. */
type FetchedCollection = Awaited<ReturnType<typeof fetchCollection>>

// Prepaid-roll frame: a Metaplex Core asset minted into the roll's collection.
// The wallet is the collection's update authority (it created it), so its
// signature authorizes adding the asset — no extra signer needed.
//
// The collection is FETCHED, never hand-built. Core derives the extra accounts
// a mint needs from the collection's external plugin adapters (oracles,
// lifecycle hooks); a literal with empty lists asserts there are none, which is
// an assumption this file cannot actually make on the collection's behalf. Get
// it wrong and the mint either fails or skips validation it should have run.
async function buildCoreFrameTransaction(
  umi: Umi,
  walletPk: UmiPublicKey,
  item: { name: string; metadataUri: string; collection: FetchedCollection },
  blockhash: BlockhashWithExpiryBlockHeight,
): Promise<{ kitTx: Transaction; mintAddress: string }> {
  const assetSigner = generateSigner(umi)
  const [limitItem, priceItem] = computeBudgetItems()
  const built = transactionBuilder()
    .add(limitItem)
    .add(priceItem)
    .add(
      createCoreAsset(umi, {
        asset: assetSigner,
        collection: item.collection,
        name: item.name,
        uri: item.metadataUri,
        owner: walletPk,
      })
    )
    .setBlockhash(blockhash)
    .build(umi)

  const assetSignedUmi = await umiSignTransaction(built, [assetSigner])
  const web3Tx = toWeb3JsTransaction(assetSignedUmi)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())
  return { kitTx, mintAddress: assetSigner.publicKey.toString() }
}

/**
 * Quick mint: a standalone Metaplex Core asset plus the fee that pays for its
 * permanent storage, in ONE transaction the user signs once.
 *
 * Two things make this different from the other builders:
 *
 * - `uri` is the Worker's PLACEHOLDER document, not the real metadata. The
 *   real image cannot be uploaded until this transaction is verified as paid,
 *   so the asset is minted against a permanent "Developing…" document and the
 *   Worker swaps it seconds later.
 * - `updateAuthority` is the Worker, which is what makes that swap possible.
 *   The Worker hands authority to the owner in the same instruction that sets
 *   the real URI, so it only holds it for the length of the upload.
 *
 * Core rather than Token Metadata: a Core asset is one rent-paying account
 * instead of four, which is what leaves the user paying less overall than they
 * did when quick mints were free but minted as NFTs.
 *
 * Carries Royalties (enforced on-chain, 100% to the shooter) and a
 * VerifiedCreators entry marked `verified: true` — valid because the wallet
 * co-signs this same transaction (it must, to pay the fee).
 */
async function buildQuickCoreTransaction(
  umi: Umi,
  walletPk: UmiPublicKey,
  item: { name: string; placeholderUri: string; terms: QuickMintTerms },
  blockhash: BlockhashWithExpiryBlockHeight,
): Promise<{ kitTx: Transaction; mintAddress: string }> {
  const assetSigner = generateSigner(umi)
  const [limitItem, priceItem] = computeBudgetItems()
  const built = transactionBuilder()
    .add(limitItem)
    .add(priceItem)
    .add(transferSolItem(walletPk, publicKey(item.terms.treasury), item.terms.feeLamports))
    .add(
      createCoreAsset(umi, {
        asset: assetSigner,
        name: item.name,
        uri: item.placeholderUri,
        owner: walletPk,
        updateAuthority: publicKey(item.terms.updateAuthority),
        plugins: [royaltiesPlugin(walletPk), { type: 'VerifiedCreators', signatures: [{ address: walletPk, verified: true }] }],
      })
    )
    .setBlockhash(blockhash)
    .build(umi)

  const assetSignedUmi = await umiSignTransaction(built, [assetSigner])
  const web3Tx = toWeb3JsTransaction(assetSignedUmi)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())
  return { kitTx, mintAddress: assetSigner.publicKey.toString() }
}

export async function sendAndConfirm(client: MintNFTDeps['client'], signedTx: Transaction): Promise<Signature> {
  try {
    assertIsFullySignedTransaction(signedTx)
    assertIsTransactionWithinSizeLimit(signedTx)
  } catch (e) {
    throw mintPhaseError('transaction validation', e)
  }

  const signature = getSignatureFromTransaction(signedTx)

  // Resending is safe: the transaction is already signed, so every attempt
  // carries the same signature — one that already landed is a no-op, not a
  // second mint.
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc: client.rpc })
  for (let attempt = 0; ; attempt++) {
    try {
      await sendTransaction(signedTx, { commitment: 'confirmed' })
      break
    } catch (e) {
      if (attempt >= SEND_RETRY_BACKOFFS_MS.length || !isRateLimitError(e)) {
        throw mintPhaseError('RPC send', e)
      }
      await delay(SEND_RETRY_BACKOFFS_MS[attempt])
    }
  }

  try {
    await waitUntilSignatureConfirmed(client.rpc, signature)
  } catch (e) {
    throw mintPhaseError('confirmation', e)
  }

  return signature
}

export interface BatchMintItemParams {
  /** Caller's correlation id (photoId) — echoed back on the result. */
  id: string
  /** For a quick mint this is the placeholder URI, not the final metadata. */
  metadataUri: string
  name: string
  symbol: string
  /** Mint a Metaplex Core asset into this collection (prepaid roll frame). Exactly one of this or `quick` must be set. */
  collectionAddress?: string
  /** Mint a standalone Core asset and bundle the quick-mint fee. Exactly one of this or `collectionAddress` must be set. */
  quick?: QuickMintTerms
}

export interface BatchMintItemResult {
  id: string
  success: boolean
  signature?: string
  mintAddress?: string
  error?: string
}

export interface BatchMintDeps {
  client: Pick<Client, 'rpc' | 'rpcSubscriptions'>
  /** MWA signs the whole array with a single wallet approval. */
  signTransactions: (txs: Transaction[]) => Promise<Transaction[]>
}

/**
 * Mint several NFTs with ONE wallet approval: every transaction shares a fresh
 * blockhash, the wallet signs them as a batch, then they're sent and confirmed
 * in parallel with per-item results.
 *
 * A wallet-sign failure (user declined, dead session) throws — no transaction
 * was sent, the whole batch is unminted. After signing, failures are per-item.
 */
export async function mintNFTBatch(
  items: BatchMintItemParams[],
  params: Pick<MintNFTParams, 'walletAddress' | 'rpc' | 'onPhase'> & {
    /** Per item, the moment its signature exists — before anything is sent. */
    onItemSigned?: (id: string, info: { signature: string; mintAddress: string }) => void
  },
  deps: BatchMintDeps,
  onItemResult?: (result: BatchMintItemResult) => void,
): Promise<BatchMintItemResult[]> {
  const { walletAddress, onPhase, rpc: rpcOverride, onItemSigned } = params
  const { client, signTransactions } = deps

  const { umi, walletPk } = createMintUmi(walletAddress, rpcOverride)
  const blockhash = await umi.rpc.getLatestBlockhash()

  // One fetch per distinct collection, not per frame — a chunk of roll frames
  // shares one collection, and the read is only needed to build the mint.
  const collections = new Map<string, FetchedCollection>()
  const getCollection = async (address: string): Promise<FetchedCollection> => {
    const cached = collections.get(address)
    if (cached) return cached
    let fetched: FetchedCollection
    try {
      fetched = await fetchCollection(umi, publicKey(address))
    } catch (e) {
      throw mintPhaseError(`collection read (${address})`, e)
    }
    collections.set(address, fetched)
    return fetched
  }

  const built: { kitTx: Transaction; mintAddress: string }[] = []
  for (const item of items) {
    if (item.quick) {
      built.push(
        await buildQuickCoreTransaction(
          umi,
          walletPk,
          { name: item.name, placeholderUri: item.metadataUri, terms: item.quick },
          blockhash,
        ),
      )
    } else if (item.collectionAddress) {
      built.push(
        await buildCoreFrameTransaction(
          umi,
          walletPk,
          {
            name: item.name,
            metadataUri: item.metadataUri,
            collection: await getCollection(item.collectionAddress),
          },
          blockhash,
        ),
      )
    } else {
      // Every real caller sets one or the other — see BatchMintItemParams.
      // There is no standalone Token Metadata fallback to fall back to.
      throw mintPhaseError('build', new Error(`Item ${item.id} has neither quick terms nor a collectionAddress`))
    }
  }

  onPhase?.('signing')
  let signedTxs: Transaction[]
  try {
    signedTxs = await signTransactions(built.map((b) => b.kitTx))
  } catch (e) {
    throw mintPhaseError('wallet sign', e)
  }

  if (onItemSigned) {
    signedTxs.forEach((signedTx, i) => {
      onItemSigned(items[i].id, {
        signature: getSignatureFromTransaction(signedTx),
        mintAddress: built[i].mintAddress,
      })
    })
  }

  onPhase?.('confirming')
  const results = await Promise.all(
    signedTxs.map(async (signedTx, i): Promise<BatchMintItemResult> => {
      const { id } = items[i]
      let result: BatchMintItemResult
      try {
        const signature = await sendAndConfirm(client, signedTx)
        result = { id, success: true, signature, mintAddress: built[i].mintAddress }
      } catch (e) {
        result = { id, success: false, error: e instanceof Error ? e.message : String(e) }
      }
      onItemResult?.(result)
      return result
    }),
  )

  return results
}

export function getSolscanUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`
}

export function getSolscanNftUrl(mintAddress: string): string {
  return `https://solscan.io/token/${mintAddress}`
}

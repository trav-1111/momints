import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata, createNft } from '@metaplex-foundation/mpl-token-metadata'
import { mplCore, create as createCoreAsset } from '@metaplex-foundation/mpl-core'
import {
  createNoopSigner,
  generateSigner,
  percentAmount,
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

export type MintPhaseCallback = (phase: 'signing' | 'confirming') => void

export interface MintNFTParams {
  metadataUri: string
  name: string
  symbol: string
  walletAddress: string
  rpc?: string
  cluster?: 'mainnet' | 'devnet'
  onPhase?: MintPhaseCallback
}

export interface MintNFTDeps {
  client: Pick<Client, 'rpc' | 'rpcSubscriptions'>
  signTransaction: (tx: Transaction) => Promise<Transaction>
}

export interface MintResult {
  signature: string
  mintAddress: string
}

function devMintLog(phase: string, err: unknown): void {
  if (!__DEV__) return
  const msg = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
  console.error(`[mint:${phase}]`, msg, cause ? `(cause: ${cause})` : '')
}

function mintPhaseError(phaseLabel: string, err: unknown): Error {
  devMintLog(phaseLabel, err)
  const base = err instanceof Error ? err.message : String(err)
  return new Error(`Mint: ${phaseLabel} failed: ${base}`, {
    cause: err instanceof Error ? err : undefined,
  })
}

async function waitUntilSignatureConfirmed(rpc: Client['rpc'], signature: Signature, maxAttempts = 45): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send()
    const status = value[0]
    if (status?.err) {
      throw new Error(typeof status.err === 'string' ? status.err : JSON.stringify(status.err))
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Transaction confirmation timed out')
}

export function resolveSolanaCluster(runtimeCluster?: 'mainnet' | 'devnet'): 'devnet' | 'mainnet' {
  if (runtimeCluster) return runtimeCluster
  const env = process.env.EXPO_PUBLIC_SOLANA_CLUSTER?.toLowerCase()
  if (env === 'devnet') return 'devnet'
  const rpc = (process.env.EXPO_PUBLIC_SOLANA_RPC ?? '').toLowerCase()
  if (rpc.includes('devnet')) return 'devnet'
  return 'mainnet'
}

export function createMintUmi(walletAddress: string, rpcOverride?: string): { umi: Umi; walletPk: UmiPublicKey } {
  const rpcUrl = rpcOverride ?? process.env.EXPO_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
  const umi = createUmi(rpcUrl).use(mplTokenMetadata()).use(mplCore())
  const walletPk = publicKey(walletAddress)
  const noopWallet = createNoopSigner(walletPk)
  umi.payer = noopWallet
  umi.identity = noopWallet
  return { umi, walletPk }
}

// Build one createNft transaction, pre-signed by the throwaway mint keypair;
// the wallet's signature is added by the caller. The connected wallet is the
// sole creator with verified: true — valid because it signs the transaction —
// so wallets display the NFT as verified instead of flagging it.
async function buildMintTransaction(
  umi: Umi,
  walletPk: UmiPublicKey,
  item: { name: string; symbol: string; metadataUri: string },
  blockhash: BlockhashWithExpiryBlockHeight,
): Promise<{ kitTx: Transaction; mintAddress: string }> {
  const mintSigner = generateSigner(umi)
  const [limitItem, priceItem] = computeBudgetItems()
  const built = transactionBuilder()
    .add(limitItem)
    .add(priceItem)
    .add(
      createNft(umi, {
        mint: mintSigner,
        name: item.name,
        symbol: item.symbol,
        uri: item.metadataUri,
        sellerFeeBasisPoints: percentAmount(0),
        creators: [{ address: walletPk, verified: true, share: 100 }],
        tokenOwner: walletPk,
      })
    )
    .setBlockhash(blockhash)
    .build(umi)

  const mintSignedUmi = await umiSignTransaction(built, [mintSigner])
  const web3Tx = toWeb3JsTransaction(mintSignedUmi)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())
  return { kitTx, mintAddress: mintSigner.publicKey.toString() }
}

// Prepaid-roll frame: a Metaplex Core asset minted into the roll's collection.
// The wallet is the collection's update authority (it created it), so its
// signature authorizes adding the asset — no extra signer needed. Our
// collections carry no plugins, hence the empty oracle/hook lists.
async function buildCoreFrameTransaction(
  umi: Umi,
  walletPk: UmiPublicKey,
  item: { name: string; metadataUri: string; collectionAddress: string },
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
        collection: { publicKey: publicKey(item.collectionAddress), oracles: [], lifecycleHooks: [] },
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

export async function sendAndConfirm(client: MintNFTDeps['client'], signedTx: Transaction): Promise<Signature> {
  try {
    assertIsFullySignedTransaction(signedTx)
    assertIsTransactionWithinSizeLimit(signedTx)
  } catch (e) {
    throw mintPhaseError('transaction validation', e)
  }

  const signature = getSignatureFromTransaction(signedTx)

  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc: client.rpc })
  try {
    await sendTransaction(signedTx, { commitment: 'confirmed' })
  } catch (e) {
    throw mintPhaseError('RPC send', e)
  }

  try {
    await waitUntilSignatureConfirmed(client.rpc, signature)
  } catch (e) {
    throw mintPhaseError('confirmation', e)
  }

  return signature
}

export async function mintNFT(params: MintNFTParams, deps: MintNFTDeps): Promise<MintResult> {
  const { metadataUri, name, symbol, walletAddress, onPhase, rpc: rpcOverride } = params
  const { client, signTransaction } = deps

  const { umi, walletPk } = createMintUmi(walletAddress, rpcOverride)
  const blockhash = await umi.rpc.getLatestBlockhash()
  const { kitTx, mintAddress } = await buildMintTransaction(umi, walletPk, { name, symbol, metadataUri }, blockhash)

  onPhase?.('signing')
  let signedTx: Transaction
  try {
    signedTx = await signTransaction(kitTx)
  } catch (e) {
    throw mintPhaseError('wallet sign', e)
  }

  onPhase?.('confirming')
  const signature = await sendAndConfirm(client, signedTx)

  return { signature, mintAddress }
}

export interface BatchMintItemParams {
  /** Caller's correlation id (photoId) — echoed back on the result. */
  id: string
  metadataUri: string
  name: string
  symbol: string
  /** When set, mint a Metaplex Core asset into this collection (prepaid roll)
   * instead of a standalone Token Metadata NFT. */
  collectionAddress?: string
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
  params: Pick<MintNFTParams, 'walletAddress' | 'rpc' | 'cluster' | 'onPhase'>,
  deps: BatchMintDeps,
  onItemResult?: (result: BatchMintItemResult) => void,
): Promise<BatchMintItemResult[]> {
  const { walletAddress, onPhase, rpc: rpcOverride } = params
  const { client, signTransactions } = deps

  const { umi, walletPk } = createMintUmi(walletAddress, rpcOverride)
  const blockhash = await umi.rpc.getLatestBlockhash()

  const built: { kitTx: Transaction; mintAddress: string }[] = []
  for (const item of items) {
    built.push(
      item.collectionAddress
        ? await buildCoreFrameTransaction(
            umi,
            walletPk,
            { name: item.name, metadataUri: item.metadataUri, collectionAddress: item.collectionAddress },
            blockhash,
          )
        : await buildMintTransaction(umi, walletPk, item, blockhash),
    )
  }

  onPhase?.('signing')
  let signedTxs: Transaction[]
  try {
    signedTxs = await signTransactions(built.map((b) => b.kitTx))
  } catch (e) {
    throw mintPhaseError('wallet sign', e)
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

export function getSolscanUrl(signature: string, cluster?: 'mainnet' | 'devnet'): string {
  const c = resolveSolanaCluster(cluster)
  const q = c === 'devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${q}`
}

export function getSolscanNftUrl(mintAddress: string, cluster?: 'mainnet' | 'devnet'): string {
  const c = resolveSolanaCluster(cluster)
  const q = c === 'devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/token/${mintAddress}${q}`
}

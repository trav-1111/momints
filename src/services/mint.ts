import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata, createNft } from '@metaplex-foundation/mpl-token-metadata'
import {
  createNoopSigner,
  generateSigner,
  none,
  percentAmount,
  publicKey,
  signTransaction as umiSignTransaction,
  transactionBuilder,
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

export async function mintNFT(params: MintNFTParams, deps: MintNFTDeps): Promise<MintResult> {
  const { metadataUri, name, symbol, walletAddress, onPhase, rpc: rpcOverride, cluster } = params
  const { client, signTransaction } = deps

  const rpcUrl = rpcOverride ?? process.env.EXPO_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'

  const umi = createUmi(rpcUrl).use(mplTokenMetadata())
  const walletPk = publicKey(walletAddress)
  const noopWallet = createNoopSigner(walletPk)
  umi.payer = noopWallet
  umi.identity = noopWallet

  const mintSigner = generateSigner(umi)

  const [limitItem, priceItem] = computeBudgetItems()
  const built = await transactionBuilder()
    .add(limitItem)
    .add(priceItem)
    .add(
      createNft(umi, {
        mint: mintSigner,
        name,
        symbol,
        uri: metadataUri,
        sellerFeeBasisPoints: percentAmount(0),
        creators: none(),
        tokenOwner: walletPk,
      })
    )
    .buildWithLatestBlockhash(umi)

  const mintSignedUmi = await umiSignTransaction(built, [mintSigner])
  const web3Tx = toWeb3JsTransaction(mintSignedUmi)
  const serialized = web3Tx.serialize()
  const kitTx = getTransactionDecoder().decode(serialized)

  onPhase?.('signing')
  let signedTx: Transaction
  try {
    signedTx = await signTransaction(kitTx)
  } catch (e) {
    throw mintPhaseError('wallet sign', e)
  }

  try {
    assertIsFullySignedTransaction(signedTx)
    assertIsTransactionWithinSizeLimit(signedTx)
  } catch (e) {
    throw mintPhaseError('transaction validation', e)
  }

  const signature = getSignatureFromTransaction(signedTx)

  onPhase?.('confirming')
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

  const mintAddress = mintSigner.publicKey.toString()

  return { signature, mintAddress }
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

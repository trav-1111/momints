import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata, createNft } from '@metaplex-foundation/mpl-token-metadata'
import {
  createNoopSigner,
  generateSigner,
  none,
  percentAmount,
  publicKey,
  signTransaction as umiSignTransaction,
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

const SOLANA_RPC = process.env.EXPO_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'

export type MintPhaseCallback = (phase: 'signing' | 'confirming') => void

export interface MintNFTParams {
  metadataUri: string
  name: string
  symbol: string
  walletAddress: string
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

export function resolveSolanaCluster(): 'devnet' | 'mainnet' {
  const env = process.env.EXPO_PUBLIC_SOLANA_CLUSTER?.toLowerCase()
  if (env === 'devnet') return 'devnet'
  const rpc = (process.env.EXPO_PUBLIC_SOLANA_RPC ?? '').toLowerCase()
  if (rpc.includes('devnet')) return 'devnet'
  return 'mainnet'
}

export async function mintNFT(params: MintNFTParams, deps: MintNFTDeps): Promise<MintResult> {
  const { metadataUri, name, symbol, walletAddress, onPhase } = params
  const { client, signTransaction } = deps

  const umi = createUmi(SOLANA_RPC).use(mplTokenMetadata())
  const walletPk = publicKey(walletAddress)
  const noopWallet = createNoopSigner(walletPk)
  umi.payer = noopWallet
  umi.identity = noopWallet

  const mintSigner = generateSigner(umi)

  const built = await createNft(umi, {
    mint: mintSigner,
    name,
    symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    creators: none(),
    tokenOwner: walletPk,
  }).buildWithLatestBlockhash(umi)

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
    // Broadcast via app RPC (EXPO_PUBLIC_SOLANA_RPC / MobileWalletProvider), not the wallet app's default RPC.
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

  return {
    signature,
    mintAddress,
  }
}

export function getSolscanUrl(signature: string): string {
  const cluster = resolveSolanaCluster()
  const q = cluster === 'devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${q}`
}

export function getSolscanNftUrl(mintAddress: string): string {
  const cluster = resolveSolanaCluster()
  const q = cluster === 'devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/token/${mintAddress}${q}`
}

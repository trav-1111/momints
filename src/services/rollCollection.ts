import { publicKey, transactionBuilder } from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { getTransactionDecoder, type Transaction } from '@solana/transactions'
import { getSignatureFromTransaction } from '@solana/kit'
import type { SignedRollPayment } from './rollCreation'
import type { RollPurchaseQuote } from './rollApi'
import {
  createMintUmi,
  deriveOwnerSkrAta,
  memoItem,
  sendAndConfirm,
  transferSolItem,
  transferSplTokenCheckedItem,
  type MintNFTDeps,
  type MintPhaseCallback,
} from './mint'
import { hashRollCapability } from './rollCapability'
import { getWorkerFees } from './rollApi'
import { isSkrQuoteUnavailable, quoteSkrFee } from './skrApi'
import { ROLL_TREASURY_ADDRESS, type PrepaidRollSize } from '../config/roll'
import { SKR_DECIMALS, SKR_MINT_ADDRESS } from '../config/skr'

/**
 * Pay the prepaid roll fee on its own. The Worker creates the collection
 * separately once this lands. The shooter owns the collection; the Worker
 * receives a scoped minting delegate.
 *
 * The fee moves BEFORE the roll exists. Callers must surface the returned
 * signature if roll creation then fails, so a charge without a roll is
 * traceable and refundable.
 *
 * New callers use an immutable server-issued purchase quote, saved before
 * signing. Legacy callers without a quote still fetch the live fee here.
 */
type RollPaymentParams = {
  walletAddress: string
  size: PrepaidRollSize
  rpc?: string
  onPhase?: MintPhaseCallback
  quote?: RollPurchaseQuote
  onSigned?: (receipt: SignedRollPayment) => Promise<void>
  rollCapability?: string
}

export async function payRollFee(
  params: RollPaymentParams,
  deps: MintNFTDeps,
): Promise<{ signature: string; feeLamports: number }> {
  const { walletAddress, size, rpc, onPhase } = params
  const { client, signTransaction } = deps

  if (!ROLL_TREASURY_ADDRESS) {
    throw new Error('Roll treasury not configured — set EXPO_PUBLIC_ROLL_TREASURY in .env and restart Expo')
  }
  const fees = params.quote ? null : await getWorkerFees()
  const feeLamports = params.quote?.amount ?? (size === 12 ? fees!.rollFee12Lamports : fees!.rollFee24Lamports)

  const { umi, walletPk } = createMintUmi(walletAddress, rpc)
  const blockhash = await umi.rpc.getLatestBlockhash()

  let built = transactionBuilder()
    .add(transferSolItem(walletPk, publicKey(ROLL_TREASURY_ADDRESS), feeLamports))

  if (params.rollCapability) {
    const capabilityHash = hashRollCapability(params.rollCapability)
    built = built.add(memoItem(walletPk, `momints:roll:${capabilityHash}`))
  }

  const builtTx = built
    .setBlockhash(blockhash)
    .build(umi)

  const web3Tx = toWeb3JsTransaction(builtTx)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())

  onPhase?.('signing')
  if (params.quote && Date.parse(params.quote.expiresAt) <= Date.now())
    throw new Error('Roll quote expired before signing. No payment was sent; retry to refresh it.')
  let signedTx: Transaction
  try {
    signedTx = await signTransaction(kitTx)
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e)
    throw new Error(`Roll payment: wallet sign failed: ${base}`, { cause: e instanceof Error ? e : undefined })
  }

  if (params.quote && Date.parse(params.quote.expiresAt) <= Date.now())
    throw new Error('Roll quote expired during wallet approval. No payment was sent; retry to refresh it.')
  await params.onSigned?.({
    signature: getSignatureFromTransaction(signedTx),
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  })
  onPhase?.('confirming')
  const signature = await sendAndConfirm(client, signedTx)
  return { signature, feeLamports }
}

/** Thrown by paySkrRollFee when the Worker's quote came back `unavailable` — callers should fall back to payRollFee (SOL). */
export class SkrQuoteUnavailableError extends Error {}

/**
 * Pay the prepaid roll fee in $SKR instead of SOL — same shape as
 * payRollFee, a standalone fee-only transaction, just a TransferChecked
 * instead of a System transfer.
 *
 * Quotes FRESH here, at the moment of payment — never a value the mode-select
 * screen fetched earlier for display — mirroring payRollFee's own "fetch
 * right before paying" rule for SOL exactly. This is also what makes the
 * 120s quote-expiry window a non-issue: the quote used for the actual
 * transaction is always seconds old, by construction.
 */
export async function paySkrRollFee(
  params: RollPaymentParams,
  deps: MintNFTDeps,
): Promise<{ signature: string; skrAmount: number }> {
  const { walletAddress, size, rpc, onPhase } = params
  const { client, signTransaction } = deps

  const quote = params.quote
    ? {
        skrAmount: params.quote.amount,
        treasurySkrAta: params.quote.treasurySkrAta!,
        expiresAt: params.quote.expiresAt,
      }
    : await quoteSkrFee({ context: 'roll', wallet: walletAddress, size })
  if (isSkrQuoteUnavailable(quote)) {
    throw new SkrQuoteUnavailableError(quote.reason)
  }

  const { umi, walletPk } = createMintUmi(walletAddress, rpc)
  const blockhash = await umi.rpc.getLatestBlockhash()

  let built = transactionBuilder()
    .add(
      transferSplTokenCheckedItem({
        source: deriveOwnerSkrAta(umi, walletPk),
        mint: publicKey(SKR_MINT_ADDRESS),
        destination: publicKey(quote.treasurySkrAta),
        owner: walletPk,
        amount: quote.skrAmount,
        decimals: SKR_DECIMALS,
      }),
    )

  if (params.rollCapability) {
    const capabilityHash = hashRollCapability(params.rollCapability)
    built = built.add(memoItem(walletPk, `momints:roll:${capabilityHash}`))
  }

  const builtTx = built
    .setBlockhash(blockhash)
    .build(umi)

  const web3Tx = toWeb3JsTransaction(builtTx)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())

  onPhase?.('signing')
  if (params.quote && Date.parse(params.quote.expiresAt) <= Date.now())
    throw new Error('Roll quote expired before signing. No payment was sent; retry to refresh it.')
  let signedTx: Transaction
  try {
    signedTx = await signTransaction(kitTx)
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e)
    throw new Error(`Roll payment: wallet sign failed: ${base}`, { cause: e instanceof Error ? e : undefined })
  }

  if (params.quote && Date.parse(params.quote.expiresAt) <= Date.now())
    throw new Error('Roll quote expired during wallet approval. No payment was sent; retry to refresh it.')
  await params.onSigned?.({
    signature: getSignatureFromTransaction(signedTx),
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  })
  onPhase?.('confirming')
  const signature = await sendAndConfirm(client, signedTx)
  return { signature, skrAmount: quote.skrAmount }
}

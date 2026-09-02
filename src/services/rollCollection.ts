import { publicKey, transactionBuilder } from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { getTransactionDecoder, type Transaction } from '@solana/transactions'
import { createMintUmi, sendAndConfirm, transferSolItem, type MintNFTDeps, type MintPhaseCallback } from './mint'
import { getWorkerFees } from './rollApi'
import { ROLL_TREASURY_ADDRESS, type PrepaidRollSize } from '../config/roll'

/**
 * Pay the prepaid roll fee on its own. The Worker creates the collection
 * separately once this lands — its key is the on-chain authority, so the fee
 * can't ride along in that transaction.
 *
 * The fee moves BEFORE the roll exists. Callers must surface the returned
 * signature if roll creation then fails, so a charge without a roll is
 * traceable and refundable.
 *
 * The fee is fetched from the Worker HERE, at the moment of payment — not
 * read from a value the mode-select screen captured on mount. Roll fees are
 * cost-plus and recompute every 3h (worker/src/fees/compute.ts); the Worker's
 * own verify.ts checks this exact same live cache when the transaction lands
 * moments later, so paying anything else risks a rejection.
 */
export async function payRollFee(
  params: { walletAddress: string; size: PrepaidRollSize; rpc?: string; onPhase?: MintPhaseCallback },
  deps: MintNFTDeps,
): Promise<{ signature: string; feeLamports: number }> {
  const { walletAddress, size, rpc, onPhase } = params
  const { client, signTransaction } = deps

  if (!ROLL_TREASURY_ADDRESS) {
    throw new Error('Roll treasury not configured — set EXPO_PUBLIC_ROLL_TREASURY in .env and restart Expo')
  }
  const fees = await getWorkerFees()
  const feeLamports = size === 12 ? fees.rollFee12Lamports : fees.rollFee24Lamports

  const { umi, walletPk } = createMintUmi(walletAddress, rpc)
  const blockhash = await umi.rpc.getLatestBlockhash()

  const built = transactionBuilder()
    .add(transferSolItem(walletPk, publicKey(ROLL_TREASURY_ADDRESS), feeLamports))
    .setBlockhash(blockhash)
    .build(umi)

  const web3Tx = toWeb3JsTransaction(built)
  const kitTx = getTransactionDecoder().decode(web3Tx.serialize())

  onPhase?.('signing')
  let signedTx: Transaction
  try {
    signedTx = await signTransaction(kitTx)
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e)
    throw new Error(`Roll payment: wallet sign failed: ${base}`, { cause: e instanceof Error ? e : undefined })
  }

  onPhase?.('confirming')
  const signature = await sendAndConfirm(client, signedTx)
  return { signature, feeLamports }
}


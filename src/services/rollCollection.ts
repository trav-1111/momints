import { createCollection } from '@metaplex-foundation/mpl-core'
import {
  generateSigner,
  publicKey,
  signTransaction as umiSignTransaction,
  transactionBuilder,
} from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { getTransactionDecoder, type Transaction } from '@solana/transactions'
import { createMintUmi, sendAndConfirm, transferSolItem, type MintNFTDeps, type MintPhaseCallback } from './mint'
import { ROLL_TREASURY_ADDRESS, getRollFeeLamports, type PrepaidRollSize } from '../config/roll'

/**
 * Pay the prepaid roll fee on its own — used when the roll backend Worker
 * creates the collection (its key is the on-chain authority, so the fee can't
 * ride along in that transaction the way it does in `createRollCollection`).
 *
 * The fee moves BEFORE the roll exists. Callers must surface the returned
 * signature if roll creation then fails, so a charge without a roll is
 * traceable and refundable.
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
  const feeLamports = getRollFeeLamports(size)

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

export interface CreateRollCollectionParams {
  walletAddress: string
  /** Collection name: `yyyy-mm-dd.NN`. */
  name: string
  /** Uploaded collection metadata JSON URI. */
  metadataUri: string
  size: PrepaidRollSize
  rpc?: string
  onPhase?: MintPhaseCallback
}

export interface CreateRollCollectionResult {
  collectionAddress: string
  signature: string
}

/**
 * Pay the prepaid roll fee and create the roll's Metaplex Core collection in
 * ONE atomic transaction — the fee can't be taken without the collection
 * existing, and vice versa. The wallet becomes the collection's update
 * authority; its metadata (name, cover, identity attributes) is set here once
 * and never touched again for the roll's life.
 */
export async function createRollCollection(
  params: CreateRollCollectionParams,
  deps: MintNFTDeps,
): Promise<CreateRollCollectionResult> {
  const { walletAddress, name, metadataUri, size, onPhase, rpc } = params
  const { client, signTransaction } = deps

  if (!ROLL_TREASURY_ADDRESS) {
    throw new Error('Roll treasury not configured — set EXPO_PUBLIC_ROLL_TREASURY in .env and restart Expo')
  }
  const feeLamports = getRollFeeLamports(size)

  const { umi, walletPk } = createMintUmi(walletAddress, rpc)
  const collectionSigner = generateSigner(umi)
  const blockhash = await umi.rpc.getLatestBlockhash()

  const built = transactionBuilder()
    .add(transferSolItem(walletPk, publicKey(ROLL_TREASURY_ADDRESS), feeLamports))
    .add(
      createCollection(umi, {
        collection: collectionSigner,
        name,
        uri: metadataUri,
      }),
    )
    .setBlockhash(blockhash)
    .build(umi)

  const preSigned = await umiSignTransaction(built, [collectionSigner])
  const web3Tx = toWeb3JsTransaction(preSigned)
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

  return { collectionAddress: collectionSigner.publicKey.toString(), signature }
}

import { createCollection } from '@metaplex-foundation/mpl-core'
import {
  generateSigner,
  publicKey,
  signTransaction as umiSignTransaction,
  transactionBuilder,
  type PublicKey as UmiPublicKey,
} from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { getTransactionDecoder, type Transaction } from '@solana/transactions'
import { createMintUmi, sendAndConfirm, type MintNFTDeps, type MintPhaseCallback } from './mint'
import { ROLL_TREASURY_ADDRESS, getRollFeeLamports, type PrepaidRollSize } from '../config/roll'

const SYSTEM_PROGRAM_ID = publicKey('11111111111111111111111111111111')

// System Program Transfer: u32 instruction index (2) + u64 lamports, LE.
// Written as two u32s to avoid BigInt (RN compatibility, same as mint.ts).
function encodeSystemTransfer(lamports: number): Uint8Array {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, 2, true)
  view.setUint32(4, lamports >>> 0, true)
  view.setUint32(8, Math.floor(lamports / 0x100000000), true)
  return data
}

function transferSolItem(from: UmiPublicKey, to: UmiPublicKey, lamports: number) {
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

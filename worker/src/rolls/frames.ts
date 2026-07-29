import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import type { Umi } from '@metaplex-foundation/umi'
import type { FrameRow, RollDb, RollRow } from '../db'
import { HttpError } from '../lib/http'
import { withBackoff } from '../lib/retry'
import type { FundingProvider, StorageProvider } from '../providers/types'
import { ConfirmTimeoutError, getSignatureStatus, sendAndConfirm } from '../solana/confirm'
import { ESTIMATED_METADATA_BYTES } from './config'

export interface MintFrameRequest {
  collectionAddress: string
  /** 1-based position in the roll (1..size). The client owns frame ordering. */
  frameIndex: number
  imageBytes: Uint8Array
  mime: string
  description?: string
  /** Extra attributes from the app's auto-metadata pipeline (location, weather, ...). */
  attributes?: Array<{ trait_type: string; value: string }>
}

export interface MintFrameDeps {
  db: RollDb
  rpcUrl: string
  /**
   * Lazy on purpose: the already-MINTED fast path and all validation are
   * pure-D1, so resume re-POSTs of completed frames never touch the bundler
   * node or construct a umi client.
   */
  getUmi: () => Promise<Umi>
  getSeams: () => Promise<{ storage: StorageProvider; funding: FundingProvider }>
}

export interface MintFrameResult {
  collectionAddress: string
  frameIndex: number
  frameName: string
  assetAddress: string
  imageUri: string
  metadataUri: string
  signature: string | null
  alreadyMinted: boolean
  rollStatus: 'OPEN' | 'COMPLETE'
  mintedCount: number
  fundingWarning: string | null
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

function frameName(roll: RollRow, frameIndex: number): string {
  return `${roll.name}.${String(frameIndex).padStart(3, '0')}`
}

/**
 * Mint one frame into the roll's collection, checkpointed in D1 at every
 * step so an interrupted roll RESUMES instead of re-uploading or re-minting:
 *
 *   (none)            -> upload image            -> IMAGE_UPLOADED
 *   IMAGE_UPLOADED    -> upload metadata JSON    -> METADATA_UPLOADED
 *   METADATA_UPLOADED -> record signer, send tx  -> MINT_PENDING
 *   MINT_PENDING      -> confirmed on-chain      -> MINTED
 *
 * Re-POSTing an already-MINTED frame is a cheap no-op that returns the
 * existing asset. A MINT_PENDING frame (confirm timeout last time) is checked
 * on-chain first — only a transaction that provably did not land is re-sent.
 * Uploaded URIs are never re-uploaded: the client is expected to resend the
 * same image bytes for a resumed frame, and the stored image_uri wins.
 */
export async function mintFrame(deps: MintFrameDeps, req: MintFrameRequest): Promise<MintFrameResult> {
  const { db, rpcUrl, getUmi, getSeams } = deps

  const roll = await db.getRoll(req.collectionAddress)
  if (!roll) {
    throw new HttpError(404, `No roll with collection address ${req.collectionAddress}`)
  }
  if (!Number.isInteger(req.frameIndex) || req.frameIndex < 1 || req.frameIndex > roll.size) {
    throw new HttpError(400, `frameIndex must be an integer in 1..${roll.size}, got ${req.frameIndex}`)
  }

  const existing = await db.getFrame(req.collectionAddress, req.frameIndex)

  // ---- Fast path: already minted (idempotent resume) ----
  if (existing?.status === 'MINTED' && existing.asset_address) {
    return {
      collectionAddress: req.collectionAddress,
      frameIndex: req.frameIndex,
      frameName: frameName(roll, req.frameIndex),
      assetAddress: existing.asset_address,
      imageUri: existing.image_uri ?? '',
      metadataUri: existing.metadata_uri ?? '',
      signature: existing.mint_signature,
      alreadyMinted: true,
      rollStatus: roll.status,
      mintedCount: roll.minted_count,
      fundingWarning: null,
    }
  }

  if (roll.status !== 'OPEN') {
    throw new HttpError(409, `Roll ${roll.name} is ${roll.status} — no new frames can be minted`)
  }

  // ---- MINT_PENDING: a previous attempt sent a tx but timed out confirming.
  // Check the chain before doing anything else — re-minting a landed tx would
  // mint a duplicate asset. ----
  if (existing?.status === 'MINT_PENDING' && existing.mint_signature) {
    const status = await getSignatureStatus(rpcUrl, existing.mint_signature)
    if (
      status &&
      !status.err &&
      (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')
    ) {
      await db.upsertFrame({
        collectionAddress: req.collectionAddress,
        frameIndex: req.frameIndex,
        status: 'MINTED',
        assetAddress: existing.asset_address,
        mintSignature: existing.mint_signature,
      })
      const { mintedCount, status: rollStatus } = await db.syncMintedCount(req.collectionAddress)
      return {
        collectionAddress: req.collectionAddress,
        frameIndex: req.frameIndex,
        frameName: frameName(roll, req.frameIndex),
        assetAddress: existing.asset_address ?? '',
        imageUri: existing.image_uri ?? '',
        metadataUri: existing.metadata_uri ?? '',
        signature: existing.mint_signature,
        alreadyMinted: true,
        rollStatus,
        mintedCount,
        fundingWarning: null,
      }
    }
    if (status && !status.err && status.confirmationStatus === 'processed') {
      throw new HttpError(
        503,
        `Frame ${req.frameIndex} mint ${existing.mint_signature} is still propagating — re-POST in a few seconds.`,
      )
    }
    // Not landed (or failed on-chain): fall through and re-mint with a fresh signer.
  }

  if (!ALLOWED_MIME.has(req.mime)) {
    throw new HttpError(400, `Unsupported image MIME "${req.mime}" — use image/jpeg, image/png, or image/webp`)
  }
  if (req.imageBytes.byteLength === 0 && !existing?.image_uri) {
    throw new HttpError(400, 'Empty image body')
  }

  // ---- Funding PRE-CHECK (never funds inline; insufficient = resumable 503) ----
  const { storage, funding } = await getSeams()
  const bytesStillToUpload =
    (existing?.image_uri ? 0 : req.imageBytes.byteLength) + (existing?.metadata_uri ? 0 : ESTIMATED_METADATA_BYTES)
  let fundingWarning: string | null = null
  if (bytesStillToUpload > 0) {
    const fundingStatus = await funding.ensureFunded(bytesStillToUpload)
    fundingWarning = fundingStatus.warning
    if (!fundingStatus.sufficient) {
      throw new HttpError(
        503,
        `Frame upload refused: Irys storage balance is insufficient (have ${fundingStatus.balanceAtomic}, ` +
          `need ${fundingStatus.requiredAtomic} atomic). OPERATOR: top up per the README runbook. `
          + 'The frame checkpoint is untouched — re-POST this frame after the top-up to resume.',
      )
    }
  }

  const name = frameName(roll, req.frameIndex)

  // ---- Step 1: image upload (skipped on resume — permanent bytes are paid for once) ----
  let imageUri = existing?.image_uri ?? null
  if (!imageUri) {
    imageUri = await storage.uploadImage(req.imageBytes, req.mime)
    await db.upsertFrame({
      collectionAddress: req.collectionAddress,
      frameIndex: req.frameIndex,
      status: 'IMAGE_UPLOADED',
      imageUri,
    })
  }

  // ---- Step 2: metadata upload ----
  let metadataUri = existing?.metadata_uri ?? null
  if (!metadataUri) {
    metadataUri = await storage.uploadJSON({
      name,
      symbol: 'MOMINTS',
      description: req.description ?? `Frame ${String(req.frameIndex).padStart(3, '0')} of Momints roll ${roll.name}.`,
      image: imageUri,
      attributes: [
        // Inherited from the roll: provenance identity + vanity display name.
        { trait_type: 'skr_identity', value: roll.skr_identity },
        { trait_type: 'artist', value: roll.artist },
        { trait_type: 'roll', value: roll.name },
        { trait_type: 'frame', value: `${String(req.frameIndex).padStart(3, '0')}/${roll.size}` },
        ...(req.attributes ?? []),
      ],
    })
    await db.upsertFrame({
      collectionAddress: req.collectionAddress,
      frameIndex: req.frameIndex,
      status: 'METADATA_UPLOADED',
      imageUri,
      metadataUri,
    })
  }

  // ---- Step 3: mint the Core asset into the roll's collection ----
  const umi = await getUmi()
  const { create, fetchCollection } = await import('@metaplex-foundation/mpl-core')
  const collection = await withBackoff('fetchCollection', () =>
    fetchCollection(umi, publicKey(req.collectionAddress)),
  )
  const assetSigner = generateSigner(umi)

  // Checkpoint BEFORE sending: if confirmation times out, the next attempt
  // finds the signature here and checks the chain instead of double-minting.
  const blockhash = await withBackoff('getLatestBlockhash', () => umi.rpc.getLatestBlockhash())
  const tx = await create(umi, {
    asset: assetSigner,
    collection,
    name,
    uri: metadataUri,
    owner: publicKey(roll.wallet),
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi)

  const { base58 } = await import('@metaplex-foundation/umi/serializers')
  const pendingSignature = base58.deserialize(tx.signatures[0])[0]
  await db.upsertFrame({
    collectionAddress: req.collectionAddress,
    frameIndex: req.frameIndex,
    status: 'MINT_PENDING',
    imageUri,
    metadataUri,
    assetAddress: assetSigner.publicKey.toString(),
    mintSignature: pendingSignature,
  })

  let signature: string
  try {
    signature = await sendAndConfirm(umi, rpcUrl, tx)
  } catch (err) {
    if (err instanceof ConfirmTimeoutError) {
      // Checkpoint already holds the signature — surface as resumable.
      throw new HttpError(
        504,
        `Frame ${req.frameIndex} mint sent (${err.signature}) but not confirmed in time. ` +
          'Re-POST this frame: the checkpoint will detect whether it landed and will not double-mint.',
      )
    }
    throw err
  }

  await db.upsertFrame({
    collectionAddress: req.collectionAddress,
    frameIndex: req.frameIndex,
    status: 'MINTED',
    imageUri,
    metadataUri,
    assetAddress: assetSigner.publicKey.toString(),
    mintSignature: signature,
  })
  const { mintedCount, status: rollStatus } = await db.syncMintedCount(req.collectionAddress)

  return {
    collectionAddress: req.collectionAddress,
    frameIndex: req.frameIndex,
    frameName: name,
    assetAddress: assetSigner.publicKey.toString(),
    imageUri,
    metadataUri,
    signature,
    alreadyMinted: false,
    rollStatus,
    mintedCount,
    fundingWarning,
  }
}

/** Compact per-frame status view for the roll status endpoint. */
export function summarizeFrames(frames: FrameRow[]) {
  return frames.map((f) => ({
    frameIndex: f.frame_index,
    status: f.status,
    assetAddress: f.asset_address,
    imageUri: f.image_uri,
    metadataUri: f.metadata_uri,
    signature: f.mint_signature,
    updatedAt: f.updated_at,
  }))
}

import { fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getClusterRpc } from '../store/network'
import { createMintUmi } from './mint'
import { getQuickMintStatus } from './quickMintApi'
import { getWorkerRoll } from './rollApi'
import {
  isPermanentArweaveUri,
  isPermanentImagePending,
  normalizeArweaveUri,
  verifyPermanentImage,
} from './imagePrivacy'

interface MetadataDocument {
  image?: unknown
  properties?: { files?: { uri?: unknown }[] }
}

async function imageFromMetadataUri(metadataUri: string): Promise<string | null> {
  try {
    const uri = normalizeArweaveUri(metadataUri)
    const response = await fetch(uri, { headers: { 'Cache-Control': 'no-store' }, cache: 'no-store' })
    if (!response.ok) return null
    const metadata = (await response.json()) as MetadataDocument
    const candidate =
      typeof metadata.image === 'string'
        ? metadata.image
        : typeof metadata.properties?.files?.[0]?.uri === 'string'
          ? metadata.properties.files[0].uri
          : null
    if (!candidate) return null
    const normalized = normalizeArweaveUri(candidate)
    return isPermanentArweaveUri(normalized) ? normalized : null
  } catch {
    return null
  }
}

async function imageFromCoreAsset(assetAddress: string): Promise<string | null> {
  try {
    const { umi } = createMintUmi(assetAddress, getClusterRpc())
    const asset = await fetchAssetV1(umi, publicKey(assetAddress))
    return imageFromMetadataUri(asset.uri)
  } catch {
    return null
  }
}

export interface PermanentImageLookup {
  imageUri?: unknown
  mintAddress?: unknown
  rollContext?: {
    collectionAddress?: unknown
    frameNumber?: unknown
  }
}

export async function resolvePermanentImageUri(item: PermanentImageLookup): Promise<string | null> {
  if (typeof item.imageUri === 'string') {
    const candidate = normalizeArweaveUri(item.imageUri)
    if (isPermanentArweaveUri(candidate)) return candidate
  }

  const collectionAddress = item.rollContext?.collectionAddress
  const frameNumber = item.rollContext?.frameNumber
  if (typeof collectionAddress === 'string' && typeof frameNumber === 'number') {
    try {
      const roll = await getWorkerRoll(collectionAddress)
      const candidate = roll.frames.find((frame) => frame.frameIndex === frameNumber)?.imageUri
      if (candidate) {
        const normalized = normalizeArweaveUri(candidate)
        if (isPermanentArweaveUri(normalized)) return normalized
      }
    } catch {
      // Fall through to the asset metadata lookup.
    }
  }

  if (typeof item.mintAddress === 'string') {
    try {
      const quick = await getQuickMintStatus(item.mintAddress)
      if (quick.imageUri) {
        const normalized = normalizeArweaveUri(quick.imageUri)
        if (isPermanentArweaveUri(normalized)) return normalized
      }
    } catch {
      // A roll asset will not exist in the quick-mint status endpoint.
    }
    return imageFromCoreAsset(item.mintAddress)
  }

  return null
}

async function verifyIfReady(uri: string): Promise<string | null> {
  const normalized = normalizeArweaveUri(uri)
  if (!isPermanentArweaveUri(normalized)) return null
  try {
    return await verifyPermanentImage(normalized)
  } catch (error) {
    if (isPermanentImagePending(error)) {
      // Arweave gateway 404 is propagation latency, not a missing upload.
      // Accept the known permanent Arweave URI immediately so quick mints
      // are not held up for 8–12 minutes.
      return normalized
    }
    throw error
  }
}

/** One non-blocking reconciliation pass for the background finalize poller. */
export async function tryPermanentQuickImage(
  assetAddress: string,
  hintedImageUri?: string | null,
): Promise<string | null> {
  if (hintedImageUri) return verifyIfReady(hintedImageUri)

  const status = await getQuickMintStatus(assetAddress)
  if (status.status === 'DEAD') throw new Error('Permanent upload failed.')
  return status.imageUri ? verifyIfReady(status.imageUri) : null
}

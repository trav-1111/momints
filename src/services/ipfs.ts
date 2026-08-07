import { File as ExpoFile } from 'expo-file-system'
import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'
import { formatCapturedAt } from './captureMetadata'
import { getStorageProvider } from './storage'

interface MetadataParams {
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
}

interface UploadParams extends MetadataParams {
  photoUri: string
  /** Wallet address minting the NFT — listed as creator in the JSON metadata. */
  creatorAddress?: string
}

interface UploadResult {
  imageUri: string
  metadataUri: string
}

/** The metadata document minus its image — everything knowable before upload. */
export interface MintMetadataBase {
  name: string
  symbol: string
  description: string
  external_url: string
  attributes: { trait_type: string; value: string }[]
}

/**
 * Build the NFT metadata for a shot.
 *
 * Split out from the upload because the two storage paths learn the image URI
 * at different times: the on-device path uploads first and fills it in here,
 * while a Worker-backed quick mint sends this document off to be staged and
 * the Worker injects the image URI once it has bought the bytes. Same metadata
 * either way.
 */
export function buildMintMetadata(params: MetadataParams): MintMetadataBase {
  const { title, artist, capturedAt, rollContext, captureMeta } = params
  return {
    name: title,
    symbol: 'MOMINT',
    description: `Shot on Seeker by ${artist}`,
    external_url: 'https://momints.xyz',
    attributes: [
      { trait_type: 'Artist', value: artist },
      { trait_type: 'Device', value: 'Solana Seeker' },
      { trait_type: 'Captured', value: formatCapturedAt(capturedAt) },
      { trait_type: 'Minted With', value: 'Momints' },
      ...(captureMeta?.location ? [{ trait_type: 'Location', value: captureMeta.location }] : []),
      ...(captureMeta?.weather ? [{ trait_type: 'Weather', value: captureMeta.weather }] : []),
      ...(rollContext
        ? [
            { trait_type: 'Roll', value: rollContext.rollName },
            {
              trait_type: 'Frame',
              value: `${rollContext.frameNumber} of ${rollContext.totalFrames}`,
            },
          ]
        : []),
    ],
  }
}

/** Upload a frame's image + NFT metadata JSON through the storage provider. */
export async function uploadToIPFS(params: UploadParams): Promise<UploadResult> {
  const { photoUri, creatorAddress } = params

  const storage = getStorageProvider()

  const imageBytes = await new ExpoFile(photoUri).bytes()
  const imageUri = await storage.uploadImage(imageBytes, 'image/jpeg')

  const metadataUri = await storage.uploadJSON({
    ...buildMintMetadata(params),
    image: imageUri,
    properties: {
      files: [{ uri: imageUri, type: 'image/jpeg' }],
      category: 'image',
      creators: creatorAddress ? [{ address: creatorAddress, share: 100 }] : [],
    },
  })

  return { imageUri, metadataUri }
}

export function getIPFSGatewayUrl(ipfsUri: string): string {
  return getStorageProvider().resolveUrl(ipfsUri)
}

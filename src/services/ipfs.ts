import { File as ExpoFile } from 'expo-file-system'
import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'
import { formatCapturedAt } from './captureMetadata'
import { getStorageProvider } from './storage'

interface UploadParams {
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
  /** Wallet address minting the NFT — listed as creator in the JSON metadata. */
  creatorAddress?: string
}

interface UploadResult {
  imageUri: string
  metadataUri: string
}

/** Upload a frame's image + NFT metadata JSON through the storage provider. */
export async function uploadToIPFS(params: UploadParams): Promise<UploadResult> {
  const { photoUri, title, artist, capturedAt, rollContext, captureMeta, creatorAddress } = params

  const storage = getStorageProvider()

  const imageBytes = await new ExpoFile(photoUri).bytes()
  const imageUri = await storage.uploadImage(imageBytes, 'image/jpeg')

  const metadata = {
    name: title,
    symbol: 'MOMINT',
    description: `Shot on Seeker by ${artist}`,
    image: imageUri,
    external_url: 'https://momints.xyz',
    attributes: [
      {
        trait_type: 'Artist',
        value: artist,
      },
      {
        trait_type: 'Device',
        value: 'Solana Seeker',
      },
      {
        trait_type: 'Captured',
        value: formatCapturedAt(capturedAt),
      },
      {
        trait_type: 'Minted With',
        value: 'Momints',
      },
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
    properties: {
      files: [
        {
          uri: imageUri,
          type: 'image/jpeg',
        },
      ],
      category: 'image',
      creators: creatorAddress ? [{ address: creatorAddress, share: 100 }] : [],
    },
  }

  const metadataUri = await storage.uploadJSON(metadata)

  return { imageUri, metadataUri }
}

export function getIPFSGatewayUrl(ipfsUri: string): string {
  return getStorageProvider().resolveUrl(ipfsUri)
}

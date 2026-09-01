import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'
import { formatCapturedAt, resolveLocation } from './captureMetadata'

interface MetadataParams {
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
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
 * Build the NFT metadata for a shot, minus its image URI: this document is
 * sent to the Worker's stage endpoint, and the Worker injects the image URI
 * itself once it has bought the permanent bytes.
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
      { trait_type: 'Location', value: resolveLocation(captureMeta) },
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

import type { MetadataAttribute } from './sanitize'

/**
 * Off-chain NFT metadata, in the shape Metaplex actually specifies.
 *
 * `properties` is REQUIRED by the standard (alongside `name` and `image`) —
 * not the optional extra it looks like. Roll collections and roll frames used
 * to omit it entirely, which made them non-conformant and left indexers to
 * guess. `external_url` and `attributes` are formally optional but explicitly
 * recommended, because wallets and marketplaces lean on them for display.
 *
 * One builder rather than a literal per call site: the three copies had already
 * drifted into three different shapes, which is exactly how the roll paths
 * ended up missing half the schema while quick mints had it.
 */

const DEFAULT_EXTERNAL_URL = 'https://momints.xyz'

export interface MetadataCreator {
  address: string
  /** Percent of the creator split. Display-only — on-chain enforcement is the Royalties plugin. */
  share: number
}

export interface BuildNftMetadataInput {
  name: string
  description: string
  /** Permanent URI of the image. Becomes both `image` and `properties.files[0]`. */
  imageUri: string
  mime: string
  attributes?: MetadataAttribute[]
  creators?: MetadataCreator[]
  externalUrl?: string
  /**
   * Not part of the NFT metadata standard — it exists only in the fungible
   * token schema — but harmless, and every existing Momints mint carries one.
   * Passed through per call site rather than unified, so this change alters no
   * existing value.
   */
  symbol?: string
}

export interface NftMetadata {
  name: string
  symbol?: string
  description: string
  external_url: string
  image: string
  attributes: MetadataAttribute[]
  properties: {
    files: { uri: string; type: string }[]
    category: 'image'
    creators: MetadataCreator[]
  }
}

export function buildNftMetadata(input: BuildNftMetadataInput): NftMetadata {
  return {
    name: input.name,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    description: input.description,
    external_url: input.externalUrl ?? DEFAULT_EXTERNAL_URL,
    image: input.imageUri,
    attributes: input.attributes ?? [],
    properties: {
      // files[0] is the image, matching the top-level `image` field — the
      // documented ordering convention, not an accident of construction.
      files: [{ uri: input.imageUri, type: input.mime }],
      category: 'image',
      creators: input.creators ?? [],
    },
  }
}

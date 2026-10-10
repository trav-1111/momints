import { getClusterRpc } from '../store/network'
import type { MintHistoryItem } from '../store/mintQueue'

export interface UserMintAsset {
  id: string
  name: string
  imageUri: string
  arweaveUri?: string
  metadataUri?: string
  filmStock?: string
  rollName?: string
  frameNumber?: string
  artist?: string
  location?: string
  mintedAt: string
  transactionSignature?: string
  collectionAddress?: string
  attributes?: { trait_type: string; value: string }[]
  source?: 'chain' | 'local' | 'reconciled'
  /** Position in the indexer's creation-descending portfolio, across pages. */
  chainOrder?: number
}

export interface PortfolioFetchResult {
  items: UserMintAsset[]
  source: 'chain' | 'cache' | 'offline'
  totalCount: number
  error?: string
}

interface DasItem {
  id: string
  interface?: string
  burnt?: boolean
  content?: {
    json_uri?: string
    metadata?: {
      name?: string
      symbol?: string
      description?: string
      attributes?: { trait_type?: string; value?: unknown }[]
    }
    links?: {
      image?: string
      external_url?: string
    }
    files?: {
      uri?: string
      mime?: string
    }[]
  }
  authorities?: { address: string; scopes: string[] }[]
  creators?: { address: string; verified: boolean; share: number }[]
  grouping?: { group_key: string; group_value: string }[]
}

interface DasResponse {
  result?: {
    items?: DasItem[]
    total?: number
    limit?: number
    page?: number
  }
  error?: {
    code: number
    message: string
  }
}

// In-memory cache by wallet address
interface CacheEntry {
  items: UserMintAsset[]
  timestamp: number
}

const CACHE_TTL_MS = 60_000 // 1 minute cache
const memoryCache = new Map<string, CacheEntry>()

/**
 * Normalizes an image URI into an accessible HTTPS gateway URI.
 */
export function normalizeArweaveUrl(uri?: string | null): string {
  if (!uri) return ''
  if (uri.startsWith('ar://')) {
    return `https://arweave.net/${uri.slice(5)}`
  }
  if (uri.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`
  }
  return uri
}

/**
 * Extracts a recognizable film stock display name from metadata attributes or item name.
 */
function extractFilmStock(attributes?: { trait_type?: string; value?: unknown }[], name?: string): string | undefined {
  if (attributes) {
    for (const attr of attributes) {
      const type = attr.trait_type?.toLowerCase()
      if (type === 'film' || type === 'filmstock' || type === 'film stock' || type === 'filmstockid') {
        const val = String(attr.value || '').trim()
        if (val) {
          if (val === 'momints-color-v1' || val.toLowerCase().includes('color')) return 'Momints Color'
          if (val === 'momints-bw-v1' || val.toLowerCase().includes('b&w') || val.toLowerCase().includes('bw'))
            return 'Momints B&W'
          if (val === 'bali-400-v1' || val.toLowerCase().includes('bali')) return 'Bali 400'
          if (val === 'martha-v1' || val.toLowerCase().includes('martha')) return 'Martha'
          return val
        }
      }
    }
  }

  if (name) {
    const lower = name.toLowerCase()
    if (lower.includes('bali 400')) return 'Bali 400'
    if (lower.includes('martha')) return 'Martha'
    if (lower.includes('b&w') || lower.includes('bw')) return 'Momints B&W'
    if (lower.includes('color')) return 'Momints Color'
  }

  return undefined
}

/**
 * Determines whether a DAS asset represents a Momints photo NFT.
 */
function isMomintsAsset(item: DasItem): boolean {
  // A roll collection is the album/cover, not an exposure owned by the shooter.
  if (item.interface === 'MplCoreCollection' || item.burnt) return false
  const metadata = item.content?.metadata
  const name = metadata?.name || ''
  const symbol = metadata?.symbol || ''
  const attributes = metadata?.attributes || []

  if (['MOMINT', 'MOMINTS'].includes(symbol.toUpperCase())) return true
  if (name.toLowerCase().startsWith('momints')) return true

  for (const attr of attributes) {
    const type = attr.trait_type?.toLowerCase() || ''
    const val = String(attr.value || '').toLowerCase()
    if (type === 'minted with' && val === 'momints') return true
    if (type === 'device' && val.includes('seeker')) return true
    if (type === 'filmstockid' || type === 'filmstock') return true
    if (type === 'roll' && attributes.some((a) => a.trait_type?.toLowerCase() === 'frame')) return true
  }

  return false
}

/**
 * Converts a raw DAS item into a typed UserMintAsset.
 */
function parseDasItemToUserAsset(item: DasItem, chainOrder: number): UserMintAsset {
  const metadata = item.content?.metadata
  const name = metadata?.name || `Momints #${item.id.slice(0, 4)}`
  const attributes = (metadata?.attributes || []).map((a) => ({
    trait_type: String(a.trait_type || ''),
    value: String(a.value ?? ''),
  }))

  const rawImage =
    item.content?.links?.image || item.content?.files?.find((file) => file.mime?.startsWith('image/'))?.uri || ''
  const imageUri = normalizeArweaveUrl(rawImage)

  let rollName: string | undefined
  let frameNumber: string | undefined
  let artist: string | undefined
  let location: string | undefined
  let capturedAtStr: string | undefined

  for (const attr of attributes) {
    const t = attr.trait_type.toLowerCase()
    if (t === 'roll') rollName = attr.value
    if (t === 'frame') frameNumber = attr.value
    if (t === 'artist' || t === 'creator') artist = attr.value
    if (t === 'location') location = attr.value
    if (t === 'captured') capturedAtStr = attr.value
  }

  const collectionGrouping = item.grouping?.find((g) => g.group_key === 'collection')
  const collectionAddress = collectionGrouping?.group_value

  return {
    id: item.id,
    name,
    imageUri,
    arweaveUri:
      rawImage.includes('arweave.net') || rawImage.startsWith('ar://') ? normalizeArweaveUrl(rawImage) : undefined,
    metadataUri: item.content?.json_uri,
    filmStock: extractFilmStock(metadata?.attributes, name),
    rollName,
    frameNumber,
    artist,
    location,
    // Captured is often display text ("10:06 PM · Saturday"), not a sortable
    // timestamp. Preserve it for display; creation order comes from the RPC.
    mintedAt: capturedAtStr || '',
    collectionAddress,
    attributes,
    source: 'chain',
    chainOrder,
  }
}

/**
 * Queries Solana DAS RPC endpoint to fetch all permanent Momints photo NFTs owned by a wallet.
 */
export async function fetchUserOnChainMints(
  walletAddress: string,
  options: { forceRefresh?: boolean; timeoutMs?: number } = {},
): Promise<PortfolioFetchResult> {
  const cleanAddress = walletAddress.trim()
  if (!cleanAddress) {
    return { items: [], source: 'offline', totalCount: 0 }
  }

  // Check in-memory cache
  if (!options.forceRefresh) {
    const cached = memoryCache.get(cleanAddress)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        items: cached.items,
        source: 'cache',
        totalCount: cached.items.length,
      }
    }
  }

  const rpcUrl = getClusterRpc()
  const timeoutMs = options.timeoutMs ?? 12_000

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const items: DasItem[] = []
    const seen = new Set<string>()
    const pageSize = 100
    for (let page = 1; ; page++) {
      const payload = {
        jsonrpc: '2.0',
        id: 'momints-portfolio-query',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: cleanAddress,
          page,
          limit: pageSize,
          sortBy: { sortBy: 'created', sortDirection: 'desc' },
          displayOptions: {
            showFungible: false,
            showNativeBalance: false,
          },
        },
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`DAS query failed with HTTP status ${response.status}`)
      }

      const data = (await response.json()) as DasResponse

      if (data.error) {
        throw new Error(`DAS RPC error: ${data.error.message} (code ${data.error.code})`)
      }

      const batch = data.result?.items || []
      const previousCount = seen.size
      for (const item of batch) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          items.push(item)
        }
      }
      if (batch.length < pageSize) break
      if (seen.size === previousCount) throw new Error('DAS pagination did not advance')
    }
    const momintsAssets = items.filter(isMomintsAsset).map(parseDasItemToUserAsset)

    // Update in-memory cache
    memoryCache.set(cleanAddress, {
      items: momintsAssets,
      timestamp: Date.now(),
    })

    return {
      items: momintsAssets,
      source: 'chain',
      totalCount: momintsAssets.length,
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown on-chain error'

    // Return cached items if available during network fallback
    const cached = memoryCache.get(cleanAddress)
    if (cached) {
      return {
        items: cached.items,
        source: 'cache',
        totalCount: cached.items.length,
        error: errMsg,
      }
    }

    return {
      items: [],
      source: 'offline',
      totalCount: 0,
      error: errMsg,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Merges on-chain DAS assets with local device mint history items,
 * deduplicating by mintAddress / asset id or signature and sorting by newest first.
 */
export function mergeMintPortfolio(onChainMints: UserMintAsset[], localHistory: MintHistoryItem[]): UserMintAsset[] {
  const resultMap = new Map<string, UserMintAsset>()

  // 1. Add on-chain items first (authoritative permanent records)
  for (const onChain of onChainMints) {
    resultMap.set(onChain.id, { ...onChain })
  }

  // 2. Overlay / insert local history items (may have local thumbnails or recent unindexed mints)
  for (const local of localHistory) {
    const key = local.mintAddress || local.id
    const existing = resultMap.get(key)

    if (existing) {
      // Enrich existing on-chain asset with local metadata if missing
      if (!existing.transactionSignature && local.transactionSignature) {
        existing.transactionSignature = local.transactionSignature
      }
      if (!existing.filmStock && local.filmUsed) {
        existing.filmStock = local.filmUsed
      }
      if (!existing.artist && local.artist) {
        existing.artist = local.artist
      }
      if (!existing.imageUri && local.imageUri) {
        existing.imageUri = normalizeArweaveUrl(local.imageUri)
        existing.arweaveUri = local.imageUri.includes('arweave') ? local.imageUri : undefined
      }
      if (!Number.isFinite(Date.parse(existing.mintedAt)) && Number.isFinite(Date.parse(local.mintedAt))) {
        existing.mintedAt = local.mintedAt
      }
    } else {
      // Local mint not yet indexed by DAS
      const newAsset: UserMintAsset = {
        id: local.mintAddress || local.id,
        name: local.title || 'Momints Capture',
        imageUri: normalizeArweaveUrl(local.imageUri),
        arweaveUri: local.imageUri.includes('arweave') ? local.imageUri : undefined,
        filmStock: local.filmUsed,
        rollName: local.rollContext?.rollName,
        frameNumber: local.rollContext
          ? `${local.rollContext.frameNumber}/${local.rollContext.totalFrames}`
          : undefined,
        artist: local.artist,
        mintedAt: local.mintedAt || new Date().toISOString(),
        transactionSignature: local.transactionSignature,
        collectionAddress: local.rollContext?.collectionAddress,
        source: 'local',
      }
      resultMap.set(key, newAsset)
    }
  }

  const merged = Array.from(resultMap.values())

  // Sort newest first
  merged.sort((a, b) => {
    if (a.chainOrder !== undefined && b.chainOrder !== undefined) return a.chainOrder - b.chainOrder
    // Unindexed local records appear first; all indexed records retain the
    // RPC's creation order regardless of display-only capture time strings.
    if (a.chainOrder !== undefined) return 1
    if (b.chainOrder !== undefined) return -1
    const timeA = Date.parse(a.mintedAt) || 0
    const timeB = Date.parse(b.mintedAt) || 0
    return timeB - timeA
  })

  return merged
}

/**
 * Clears cached portfolio data.
 */
export function clearPortfolioCache(walletAddress?: string): void {
  if (walletAddress) {
    memoryCache.delete(walletAddress.trim())
  } else {
    memoryCache.clear()
  }
}

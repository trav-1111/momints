import { publicKey } from '@metaplex-foundation/umi'
import { FILMSTOCK_CATALOGUE } from './catalogue'
import { HttpError } from '../lib/http'

interface DasAsset {
  interface?: string
  id?: string
  content?: {
    json_uri?: string
    metadata?: Record<string, unknown>
  }
  plugins?: {
    immutable_metadata?: object
    verified_creators?: {
      data?: { signatures?: { address?: string; verified?: boolean }[] }
    }
  }
}

interface DasPage {
  items?: DasAsset[]
  total?: number
}

interface RpcEnvelope<T> {
  result?: T
  error?: { code?: number; message?: string }
}

interface RollMetadata {
  attributes?: { trait_type?: unknown; value?: unknown }[]
}

const MAX_DAS_PAGES = 20
const DAS_PAGE_SIZE = 1000

async function dasCall<T>(rpcUrl: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'filmstock-unlocks', method, params }),
  })
  if (!response.ok) throw new HttpError(502, `DAS request failed (${response.status})`)
  const body = (await response.json()) as RpcEnvelope<T>
  if (body.error || !body.result) throw new HttpError(502, body.error?.message ?? 'DAS returned no result')
  return body.result
}

function attribute(metadata: RollMetadata, name: string): string | null {
  const found = metadata.attributes?.find((entry) => entry.trait_type === name)
  return typeof found?.value === 'string' ? found.value : null
}

async function fetchRollMetadata(uri: string): Promise<RollMetadata | null> {
  if (!uri.startsWith('https://arweave.net/')) return null
  try {
    const response = await fetch(uri, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      console.warn('[filmstock-unlocks] Roll metadata HTTP failure', response.status)
      throw new HttpError(502, 'Permanent roll metadata is temporarily unavailable')
    }
    return (await response.json()) as RollMetadata
  } catch (error) {
    if (error instanceof HttpError) throw error
    console.warn('[filmstock-unlocks] Roll metadata fetch failed')
    throw new HttpError(502, 'Permanent roll metadata is temporarily unavailable')
  }
}

/**
 * Stateless reconstruction from the Worker's verified developed-roll marker.
 * `creatorAddress` comes from immutable roll metadata written while the fee
 * payer is verified; ownership of individual frames is deliberately ignored,
 * so later transfers do not take an unlock away from the original shooter.
 */
export async function deriveUnlockedFilmStocks(
  rpcUrl: string,
  creatorAddress: string,
  momintsAuthority: string,
): Promise<string[]> {
  try {
    publicKey(creatorAddress)
    publicKey(momintsAuthority)
  } catch {
    throw new HttpError(400, 'creatorAddress must be a valid Solana address')
  }

  const known = new Set(FILMSTOCK_CATALOGUE.map((stock) => stock.filmStockId))
  const unlocked = new Set<string>()

  for (let page = 1; page <= MAX_DAS_PAGES; page += 1) {
    // Roll collections keep the paying wallet as update authority. Querying
    // that authority scopes work to one user's collections instead of walking
    // every Momints frame globally; the verified Worker signature below is
    // still the authenticity/developed gate.
    const result = await dasCall<DasPage>(rpcUrl, 'getAssetsByAuthority', {
      authorityAddress: creatorAddress,
      page,
      limit: DAS_PAGE_SIZE,
      options: { showUnverifiedCollections: false },
    })
    const items = result.items ?? []
    for (const asset of items) {
      // The verified Momints signature is added to the *collection* only when
      // every prepaid frame has minted. Child assets may inherit creators in
      // DAS, so collections are explicitly required here.
      if (asset.interface !== 'MplCoreCollection') continue
      // DAS's top-level creators describe royalties; Core's developed marker
      // lives in the VerifiedCreators plugin and is independent of that list.
      if (
        !asset.plugins?.verified_creators?.data?.signatures?.some(
          (creator) => creator.address === momintsAuthority && creator.verified === true,
        )
      )
        continue
      const uri = asset.content?.json_uri
      if (!uri) continue
      if (!uri.startsWith('https://arweave.net/')) continue
      // DAS indexes the immutable Arweave JSON alongside the Core plugins.
      // Use those attributes when present: the public gateway can reject
      // Worker requests even while the indexed permanent metadata is healthy.
      // Mutable or incomplete indexed metadata still requires a gateway read.
      const indexed = asset.content?.metadata
      const metadata =
        asset.plugins?.immutable_metadata && Array.isArray(indexed?.attributes)
          ? (indexed as RollMetadata)
          : await fetchRollMetadata(uri)
      if (!metadata) continue
      if (attribute(metadata, 'creatorAddress') !== creatorAddress) continue
      const filmStockId = attribute(metadata, 'filmStockId')
      if (filmStockId && known.has(filmStockId)) unlocked.add(filmStockId)
    }
    if (items.length < DAS_PAGE_SIZE) break
  }

  return [...unlocked].sort()
}

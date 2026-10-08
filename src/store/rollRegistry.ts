import { create } from 'zustand'
import { Paths, File } from 'expo-file-system'
import type { PrepaidRollSize } from '../config/roll'
import type { AspectRatio, FilmMode } from './session'

/**
 * Every prepaid roll this device has created, keyed by its on-chain
 * collection address. Source of truth for:
 *  - same-day roll numbering per wallet (yyyy-mm-dd.NN)
 *  - roll lifecycle (frames minted count, OPEN → CLOSED)
 */
export interface RollRecord {
  collectionAddress: string
  /** Wallet that created (and paid for) the roll. */
  wallet: string
  /** Collection name: `yyyy-mm-dd.NN`. */
  name: string
  size: PrepaidRollSize
  /** Vanity display name chosen at creation. */
  artist: string
  /** Verified SKR handle or wallet address — immutable provenance. */
  skrIdentity: string
  /** App-side display metadata for contact sheets; never affects the mint. */
  film: FilmMode
  /** Exact immutable processing recipe; inferred for legacy Color/B&W rolls. */
  filmStockId: string
  /** Capture crop applied to every frame; absent on legacy records. */
  aspect?: AspectRatio
  framesMinted: number
  status: 'open' | 'closed'
  createdAt: number
}

interface RollRegistryStore {
  rolls: RollRecord[]
  addRoll: (record: RollRecord) => void
  setFramesMinted: (collectionAddress: string, count: number) => void
  closeRoll: (collectionAddress: string) => void
  getRoll: (collectionAddress: string) => RollRecord | undefined
}

const STORAGE_KEY = 'roll-registry'

function boundedFrameCount(count: number, size: PrepaidRollSize): number {
  return Number.isFinite(count) ? Math.max(0, Math.min(size, Math.floor(count))) : 0
}

function parseRecord(raw: unknown): RollRecord | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.collectionAddress !== 'string' ||
    typeof r.wallet !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.artist !== 'string' ||
    typeof r.skrIdentity !== 'string' ||
    typeof r.createdAt !== 'number' ||
    (r.size !== 12 && r.size !== 24)
  ) {
    return null
  }
  return {
    collectionAddress: r.collectionAddress,
    wallet: r.wallet,
    name: r.name,
    size: r.size as PrepaidRollSize,
    artist: r.artist,
    skrIdentity: r.skrIdentity,
    film: r.film === 'bw' ? 'bw' : 'color',
    filmStockId:
      typeof r.filmStockId === 'string' ? r.filmStockId : r.film === 'bw' ? 'momints-bw-v1' : 'momints-color-v1',
    aspect:
      r.aspect === '1:1' || r.aspect === '4:3' || r.aspect === '16:9' || r.aspect === 'full' ? r.aspect : undefined,
    framesMinted: boundedFrameCount(typeof r.framesMinted === 'number' ? r.framesMinted : 0, r.size),
    status: r.status === 'closed' ? 'closed' : 'open',
    createdAt: r.createdAt,
  }
}

async function readPersistedRolls(): Promise<RollRecord[]> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return []
    const data: unknown = JSON.parse(await file.text())
    if (!Array.isArray(data)) return []
    return data.map(parseRecord).filter((r): r is RollRecord => r !== null)
  } catch {
    return []
  }
}

function persistRolls(rolls: RollRecord[]): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(JSON.stringify(rolls))
  } catch {
    // non-critical
  }
}

export const useRollRegistry = create<RollRegistryStore>((set, get) => ({
  rolls: [],

  addRoll: (record) => {
    set((state) => {
      const rolls = [
        ...state.rolls.filter((r) => r.collectionAddress !== record.collectionAddress),
        { ...record, framesMinted: boundedFrameCount(record.framesMinted, record.size) },
      ]
      persistRolls(rolls)
      return { rolls }
    })
  },

  setFramesMinted: (collectionAddress, count) => {
    set((state) => {
      const rolls = state.rolls.map((roll) =>
        roll.collectionAddress === collectionAddress
          ? {
              ...roll,
              framesMinted: Math.max(
                boundedFrameCount(roll.framesMinted, roll.size),
                boundedFrameCount(count, roll.size),
              ),
            }
          : roll,
      )
      persistRolls(rolls)
      return { rolls }
    })
  },

  closeRoll: (collectionAddress) => {
    set((state) => {
      const rolls = state.rolls.map((r) =>
        r.collectionAddress === collectionAddress ? { ...r, status: 'closed' as const } : r,
      )
      persistRolls(rolls)
      return { rolls }
    })
  },

  getRoll: (collectionAddress) => {
    return get().rolls.find((r) => r.collectionAddress === collectionAddress)
  },
}))

// Async hydration on startup — same pattern as session.ts and mintQueue.ts
export const rollRegistryHydrated = readPersistedRolls().then((rolls) => {
  if (rolls.length > 0) {
    useRollRegistry.setState({ rolls })
    // Repair saved overcounts as well as the in-memory display on startup.
    persistRolls(rolls)
  }
})

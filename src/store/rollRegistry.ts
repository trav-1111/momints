import { create } from 'zustand'
import { Paths, File } from 'expo-file-system'
import type { PrepaidRollSize } from '../config/roll'

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
  framesMinted: number
  status: 'open' | 'closed'
  createdAt: number
}

interface RollRegistryStore {
  rolls: RollRecord[]
  addRoll: (record: RollRecord) => void
  incrementFramesMinted: (collectionAddress: string, by?: number) => void
  closeRoll: (collectionAddress: string) => void
  getRoll: (collectionAddress: string) => RollRecord | undefined
}

const STORAGE_KEY = 'roll-registry'

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
    framesMinted: typeof r.framesMinted === 'number' ? r.framesMinted : 0,
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
      const rolls = [...state.rolls.filter((r) => r.collectionAddress !== record.collectionAddress), record]
      persistRolls(rolls)
      return { rolls }
    })
  },

  incrementFramesMinted: (collectionAddress, by = 1) => {
    set((state) => {
      const rolls = state.rolls.map((r) =>
        r.collectionAddress === collectionAddress ? { ...r, framesMinted: r.framesMinted + by } : r,
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
readPersistedRolls().then((rolls) => {
  if (rolls.length > 0) useRollRegistry.setState({ rolls })
})

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'
import type { CaptureMeta } from './photos'
import type { AspectRatio } from './session'
import { resolvePermanentImageUri } from '../services/permanentAsset'
import { isPermanentArweaveUri, normalizeArweaveUri } from '../services/imagePrivacy'

export interface RollContext {
  rollId: string
  rollName: string
  frameNumber: number
  totalFrames: number
  /** Prepaid roll's Core collection — frames mint into it as Core assets. */
  collectionAddress?: string
}

/** Display name of the exact immutable film recipe applied to the capture. */
export type MintFilmUsed = string

export interface MintQueueItem {
  id: string
  photoId: string
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  txSignature?: string
  mintAddress?: string
  error?: string
  createdAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
  /** App-side display metadata for contact sheets; not sent to mint rails. */
  filmUsed?: MintFilmUsed
  aspect?: AspectRatio
  /** Quick mint only — which currency should pay the fee. Defaults 'SOL'. A Worker quote failure falls back to SOL. */
  paymentCurrency?: 'SOL' | 'SKR'
}

export interface MintHistoryItem {
  id: string
  imageUri: string
  imageHash?: string
  width?: number
  height?: number
  title: string
  artist: string
  transactionSignature: string
  mintAddress: string
  mintedAt: string
  capturedAt?: number
  rollContext?: RollContext
  filmUsed?: MintFilmUsed
  aspect?: AspectRatio
}

interface MintQueueStore {
  queue: MintQueueItem[]
  mintHistory: MintHistoryItem[]
  addToQueue: (item: Omit<MintQueueItem, 'id' | 'status' | 'createdAt'>) => void
  updateStatus: (
    photoId: string,
    status: MintQueueItem['status'],
    txSignature?: string,
    error?: string,
    mintAddress?: string,
  ) => void
  removeFromQueue: (photoId: string) => void
  getNextPending: () => MintQueueItem | undefined
  clearQueue: () => void
  clearCompleted: () => void
  addToHistory: (item: MintHistoryItem) => void
  clearHistory: () => void
}

const HISTORY_FILE = 'mint-history'
const MIGRATION_PENDING_FILE = 'mint-history-migration-pending'

function historyFile(name: string): File {
  return new File(Paths.document, name + '.json')
}

async function readArray(file: File): Promise<unknown[]> {
  if (!file.exists) return []
  const parsed: unknown = JSON.parse(await file.text())
  return Array.isArray(parsed) ? parsed : []
}

function safeMigrationRecord(raw: unknown): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  return {
    id: h.id,
    title: h.title,
    artist: h.artist,
    transactionSignature: h.transactionSignature,
    txSignature: h.txSignature,
    mintAddress: h.mintAddress,
    mintedAt: h.mintedAt,
    capturedAt: h.capturedAt,
    rollContext: h.rollContext,
    filmUsed: h.filmUsed,
    aspect: h.aspect,
    imageHash: h.imageHash,
    width: h.width,
    height: h.height,
  }
}

function persistPendingMigration(items: Record<string, unknown>[]): void {
  const file = historyFile(MIGRATION_PENDING_FILE)
  if (items.length === 0) {
    if (file.exists) file.delete()
    return
  }
  file.write(JSON.stringify(items))
}

// Mint history is the app's only durable record of what is already on-chain —
// the photo store reconciles against it on startup — so a malformed file must
// degrade to "no history" per item rather than poisoning that check.
async function parseHistoryItem(raw: unknown): Promise<MintHistoryItem | null> {
  if (raw === null || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  const transactionSignature =
    typeof h.transactionSignature === 'string'
      ? h.transactionSignature
      : typeof h.txSignature === 'string'
        ? h.txSignature
        : null
  const mintAddress = typeof h.mintAddress === 'string' ? h.mintAddress : null
  if (typeof h.id !== 'string' || !transactionSignature || !mintAddress) return null
  let rollContext: RollContext | undefined
  if (h.rollContext !== null && typeof h.rollContext === 'object') {
    const r = h.rollContext as Record<string, unknown>
    if (
      typeof r.rollId === 'string' &&
      typeof r.rollName === 'string' &&
      typeof r.frameNumber === 'number' &&
      typeof r.totalFrames === 'number'
    ) {
      rollContext = {
        rollId: r.rollId,
        rollName: r.rollName,
        frameNumber: r.frameNumber,
        totalFrames: r.totalFrames,
        collectionAddress: typeof r.collectionAddress === 'string' ? r.collectionAddress : undefined,
      }
    }
  }
  const directImage =
    typeof h.imageUri === 'string'
      ? h.imageUri
      : typeof h.photoUri === 'string' && /^https?:\/\//i.test(h.photoUri)
        ? h.photoUri
        : undefined
  const imageUri = await resolvePermanentImageUri({ imageUri: directImage, mintAddress, rollContext })
  if (!imageUri || !isPermanentArweaveUri(normalizeArweaveUri(imageUri))) return null
  const mintedAt =
    typeof h.mintedAt === 'string'
      ? h.mintedAt
      : typeof h.mintedAt === 'number'
        ? new Date(h.mintedAt).toISOString()
        : new Date(0).toISOString()
  return {
    id: h.id,
    imageUri: normalizeArweaveUri(imageUri),
    imageHash: typeof h.imageHash === 'string' ? h.imageHash : undefined,
    width: typeof h.width === 'number' ? h.width : undefined,
    height: typeof h.height === 'number' ? h.height : undefined,
    title: typeof h.title === 'string' ? h.title : 'Untitled',
    artist: typeof h.artist === 'string' ? h.artist : '',
    transactionSignature,
    mintAddress,
    mintedAt,
    capturedAt: typeof h.capturedAt === 'number' ? h.capturedAt : undefined,
    rollContext,
    filmUsed: typeof h.filmUsed === 'string' && h.filmUsed.trim() ? h.filmUsed : undefined,
    aspect:
      h.aspect === '1:1' || h.aspect === '4:3' || h.aspect === '16:9' || h.aspect === 'full' ? h.aspect : undefined,
  }
}

async function readHistory(): Promise<MintHistoryItem[]> {
  try {
    const source = [
      ...(await readArray(historyFile(HISTORY_FILE))),
      ...(await readArray(historyFile(MIGRATION_PENDING_FILE))),
    ]
    const migrated = await Promise.all(source.map(parseHistoryItem))
    const history = migrated.filter((item): item is MintHistoryItem => item !== null)
    const pending = source.flatMap((raw, index) => {
      if (migrated[index]) return []
      const safe = safeMigrationRecord(raw)
      return safe ? [safe] : []
    })
    persistHistory(history)
    persistPendingMigration(pending)
    return history
  } catch {
    return []
  }
}

function persistHistory(history: MintHistoryItem[]): void {
  try {
    if (history.some((item) => !isPermanentArweaveUri(item.imageUri))) {
      throw new Error('Refusing to persist non-Arweave mint history.')
    }
    const file = historyFile(HISTORY_FILE)
    file.write(JSON.stringify(history))
  } catch {
    // non-critical
  }
}

export const useMintQueue = create<MintQueueStore>((set, get) => ({
  queue: [],
  mintHistory: [],

  addToQueue: (item) => {
    const existingIndex = get().queue.findIndex((q) => q.photoId === item.photoId)

    if (existingIndex !== -1) {
      set((state) => ({
        queue: state.queue.map((q, index) =>
          index === existingIndex
            ? {
                ...q,
                ...item,
                status: 'pending' as const,
                error: undefined,
                txSignature: undefined,
                mintAddress: undefined,
              }
            : q,
        ),
      }))
    } else {
      const newItem: MintQueueItem = {
        ...item,
        id: uuidv4(),
        status: 'pending',
        createdAt: Date.now(),
      }
      set((state) => ({
        queue: [...state.queue, newItem],
      }))
    }
  },

  updateStatus: (photoId, status, txSignature, error, mintAddress) => {
    set((state) => ({
      queue: state.queue.map((item) =>
        item.photoId === photoId ? { ...item, status, txSignature, error, mintAddress } : item,
      ),
    }))
  },

  removeFromQueue: (photoId: string) => {
    set((state) => ({
      queue: state.queue.filter((item) => item.photoId !== photoId),
    }))
  },

  getNextPending: () => {
    return get().queue.find((item) => item.status === 'pending')
  },

  clearQueue: () => {
    set({ queue: [] })
  },

  clearCompleted: () => {
    set((state) => ({
      queue: state.queue.filter((item) => item.status !== 'completed'),
    }))
  },

  addToHistory: (item) => {
    set((state) => {
      const next = [
        item,
        ...state.mintHistory.filter((existing) => existing.id !== item.id && existing.mintAddress !== item.mintAddress),
      ].slice(0, 100)
      persistHistory(next)
      return { mintHistory: next }
    })
  },

  clearHistory: () => {
    persistHistory([])
    set({ mintHistory: [] })
  },
}))

// Load persisted history asynchronously on startup. Exported so the photo
// store can sequence its mint-history reconcile after this read lands.
export const historyHydrated: Promise<void> = readHistory().then((mintHistory) => {
  useMintQueue.setState({ mintHistory })
})

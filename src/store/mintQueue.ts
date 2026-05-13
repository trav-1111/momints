import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'

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
}

export interface MintHistoryItem {
  id: string
  photoUri: string
  title: string
  artist: string
  txSignature: string
  mintAddress?: string
  mintedAt: number
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
    mintAddress?: string
  ) => void
  removeFromQueue: (photoId: string) => void
  getNextPending: () => MintQueueItem | undefined
  clearQueue: () => void
  clearCompleted: () => void
  addToHistory: (item: MintHistoryItem) => void
  clearHistory: () => void
}

const HISTORY_FILE = 'mint-history'

async function readHistory(): Promise<MintHistoryItem[]> {
  try {
    const file = new File(Paths.document, `${HISTORY_FILE}.json`)
    if (!file.exists) return []
    const text = await file.text()
    return JSON.parse(text) ?? []
  } catch {
    return []
  }
}

function persistHistory(history: MintHistoryItem[]): void {
  try {
    const file = new File(Paths.document, `${HISTORY_FILE}.json`)
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
            : q
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
        item.photoId === photoId
          ? { ...item, status, txSignature, error, mintAddress }
          : item
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
      const next = [item, ...state.mintHistory].slice(0, 100)
      persistHistory(next)
      return { mintHistory: next }
    })
  },

  clearHistory: () => {
    persistHistory([])
    set({ mintHistory: [] })
  },
}))

// Load persisted history asynchronously on startup
readHistory().then((mintHistory) => {
  useMintQueue.setState({ mintHistory })
})

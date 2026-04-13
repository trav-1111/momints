import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export interface MintQueueItem {
  id: string
  photoId: string
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  txSignature?: string
  error?: string
  createdAt: number
}

interface MintQueueStore {
  queue: MintQueueItem[]
  addToQueue: (item: Omit<MintQueueItem, 'id' | 'status' | 'createdAt'>) => void
  updateStatus: (
    photoId: string,
    status: MintQueueItem['status'],
    txSignature?: string,
    error?: string
  ) => void
  removeFromQueue: (photoId: string) => void
  getNextPending: () => MintQueueItem | undefined
  clearQueue: () => void
  clearCompleted: () => void
}

export const useMintQueue = create<MintQueueStore>((set, get) => ({
  queue: [],

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

  updateStatus: (photoId, status, txSignature, error) => {
    set((state) => ({
      queue: state.queue.map((item) =>
        item.photoId === photoId
          ? { ...item, status, txSignature, error }
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
}))

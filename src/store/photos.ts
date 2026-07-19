import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'

export interface CaptureMeta {
  location?: string // "Austin, Texas" — city level, never raw coords
  weather?: string // "24°C · Partly cloudy"
}

export interface Photo {
  id: string
  uri: string
  capturedAt: number
  // 'mint' = marked for minting; 'minted' = on-chain, terminal — a minted
  // photo can never re-enter a mint flow.
  action: 'pending' | 'delete' | 'save' | 'mint' | 'minted'
  meta?: CaptureMeta
}

interface PhotoStore {
  photos: Photo[]
  addPhoto: (uri: string) => string
  setAction: (id: string, action: Photo['action']) => void
  setBulkAction: (ids: string[], action: Photo['action']) => void
  setPhotoMeta: (id: string, meta: CaptureMeta) => void
  updatePhotoUri: (id: string, newUri: string) => void
  removePhoto: (id: string) => void
  removeBulkPhotos: (ids: string[]) => void
  getPhotosForMint: () => Photo[]
  getPhotosByAction: (action: Photo['action']) => Photo[]
  clearSession: () => void
  clearMintedPhotos: () => void
}

const STORAGE_KEY = 'photos-store'

function parsePhoto(raw: unknown): Photo | null {
  if (raw === null || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (
    typeof p.id !== 'string' ||
    typeof p.uri !== 'string' ||
    typeof p.capturedAt !== 'number' ||
    (p.action !== 'pending' &&
      p.action !== 'delete' &&
      p.action !== 'save' &&
      p.action !== 'mint' &&
      p.action !== 'minted')
  ) {
    return null
  }
  let meta: CaptureMeta | undefined
  if (p.meta !== null && typeof p.meta === 'object') {
    const m = p.meta as Record<string, unknown>
    meta = {
      location: typeof m.location === 'string' ? m.location : undefined,
      weather: typeof m.weather === 'string' ? m.weather : undefined,
    }
  }
  return { id: p.id, uri: p.uri, capturedAt: p.capturedAt, action: p.action, meta }
}

async function readPersistedPhotos(): Promise<Photo[]> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return []
    const text = await file.text()
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) return []
    return data.map(parsePhoto).filter((p): p is Photo => p !== null)
  } catch {
    return []
  }
}

function persistPhotos(photos: Photo[]): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(JSON.stringify(photos))
  } catch {
    // non-critical
  }
}

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: [],

  addPhoto: (uri: string): string => {
    const newPhoto: Photo = {
      id: uuidv4(),
      uri,
      capturedAt: Date.now(),
      action: 'pending',
    }
    set((state) => {
      const photos = [...state.photos, newPhoto]
      persistPhotos(photos)
      return { photos }
    })
    return newPhoto.id
  },

  setAction: (id: string, action: Photo['action']) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        photo.id === id ? { ...photo, action } : photo
      )
      persistPhotos(photos)
      return { photos }
    })
  },

  setBulkAction: (ids: string[], action: Photo['action']) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        ids.includes(photo.id) ? { ...photo, action } : photo
      )
      persistPhotos(photos)
      return { photos }
    })
  },

  setPhotoMeta: (id: string, meta: CaptureMeta) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        photo.id === id ? { ...photo, meta } : photo
      )
      persistPhotos(photos)
      return { photos }
    })
  },

  updatePhotoUri: (id: string, newUri: string) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        photo.id === id ? { ...photo, uri: newUri } : photo
      )
      persistPhotos(photos)
      return { photos }
    })
  },

  removePhoto: (id: string) => {
    set((state) => {
      const photos = state.photos.filter((photo) => photo.id !== id)
      persistPhotos(photos)
      return { photos }
    })
  },

  removeBulkPhotos: (ids: string[]) => {
    set((state) => {
      const photos = state.photos.filter((photo) => !ids.includes(photo.id))
      persistPhotos(photos)
      return { photos }
    })
  },

  getPhotosForMint: () => {
    return get().photos.filter((photo) => photo.action === 'mint')
  },

  getPhotosByAction: (action: Photo['action']) => {
    return get().photos.filter((photo) => photo.action === action)
  },

  clearSession: () => {
    persistPhotos([])
    set({ photos: [] })
  },

  clearMintedPhotos: () => {
    set((state) => {
      const photos = state.photos.filter((photo) => photo.action !== 'minted')
      persistPhotos(photos)
      return { photos }
    })
  },
}))

// Async hydration on startup — same pattern as session.ts and mintQueue.ts.
// Drop records whose image file no longer exists on disk.
readPersistedPhotos().then((persisted) => {
  if (persisted.length === 0) return
  const alive = persisted.filter((p) => {
    try {
      return new File(p.uri).exists
    } catch {
      return false
    }
  })
  usePhotoStore.setState((state) => {
    // Photos captured before hydration finished (unlikely) stay; avoid dupes by id
    const existingIds = new Set(state.photos.map((p) => p.id))
    const merged = [...alive.filter((p) => !existingIds.has(p.id)), ...state.photos]
    return { photos: merged }
  })
})

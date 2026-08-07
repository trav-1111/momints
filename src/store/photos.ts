import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'
// Value import, but not a runtime cycle: mintQueue imports only a *type* from
// this module, which erases at compile time.
import { useMintQueue, historyHydrated } from './mintQueue'

export interface CaptureMeta {
  location?: string // "Austin, Texas" — city level, never raw coords
  weather?: string // "24°C · Partly cloudy"
}

export interface Photo {
  id: string
  uri: string
  capturedAt: number
  // 'mint' = marked for minting; 'minted' = on-chain, terminal — a minted
  // photo can never re-enter a mint flow. Enforced in setAction/setBulkAction,
  // not just by convention.
  action: 'pending' | 'delete' | 'save' | 'mint' | 'minted'
  meta?: CaptureMeta
  // Roll membership, stamped at capture. Deliberately stored on the photo
  // rather than read from session.activeRoll.frameIds: completeRoll() nulls
  // the active roll, and screens that hid frames by subtracting that array
  // un-hid all of them the moment a roll finished minting.
  rollId?: string
  rollName?: string
}

/** Roll a frame belongs to, passed at capture so membership is stamped atomically. */
export interface PhotoRollRef {
  id: string
  name: string
}

interface PhotoStore {
  photos: Photo[]
  addPhoto: (uri: string, roll?: PhotoRollRef) => string
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
  // Records written before roll membership moved onto the photo have neither
  // field; they hydrate as quick photos, which is correct for everything
  // except frames of an already-finished roll — those are healed to 'minted'
  // by the mint-history reconcile at the bottom of this file.
  return {
    id: p.id,
    uri: p.uri,
    capturedAt: p.capturedAt,
    action: p.action,
    meta,
    rollId: typeof p.rollId === 'string' ? p.rollId : undefined,
    rollName: typeof p.rollName === 'string' ? p.rollName : undefined,
  }
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

  addPhoto: (uri: string, roll?: PhotoRollRef): string => {
    const newPhoto: Photo = {
      id: uuidv4(),
      uri,
      capturedAt: Date.now(),
      action: 'pending',
      rollId: roll?.id,
      rollName: roll?.name,
    }
    set((state) => {
      const photos = [...state.photos, newPhoto]
      persistPhotos(photos)
      return { photos }
    })
    return newPhoto.id
  },

  // 'minted' is terminal: an on-chain photo can never be re-marked. Guarding
  // here rather than at each call site closes every re-mint path at once —
  // the review carousel, the gallery's bulk mint, and anything added later.
  setAction: (id: string, action: Photo['action']) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        photo.id === id && photo.action !== 'minted' ? { ...photo, action } : photo
      )
      persistPhotos(photos)
      return { photos }
    })
  },

  setBulkAction: (ids: string[], action: Photo['action']) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        ids.includes(photo.id) && photo.action !== 'minted' ? { ...photo, action } : photo
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
const photosHydrated: Promise<void> = readPersistedPhotos().then((persisted) => {
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

// Self-heal records left behind by builds where minting only set 'mint'. Those
// hydrate as "marked for minting" and would silently mint a second NFT of a
// frame already on-chain — billed to the user's own wallet, since the finished
// roll's prepaid collection context is long gone.
//
// Mint history is the durable record of what actually minted, so it wins. Both
// stores hydrate from independent unawaited reads, hence the Promise.all —
// reconciling early would run against an empty photo store and do nothing.
void Promise.all([photosHydrated, historyHydrated]).then(() => {
  const mintedIds = new Set(useMintQueue.getState().mintHistory.map((h) => h.id))
  if (mintedIds.size === 0) return

  usePhotoStore.setState((state) => {
    let healed = 0
    const photos = state.photos.map((photo) => {
      if (photo.action === 'minted' || !mintedIds.has(photo.id)) return photo
      healed++
      return { ...photo, action: 'minted' as const }
    })
    if (healed === 0) return state
    console.log(`[photos] reconciled ${healed} photo(s) to 'minted' from mint history`)
    persistPhotos(photos)
    return { photos }
  })
})

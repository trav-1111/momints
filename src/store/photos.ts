import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { AspectRatio } from './session'

export interface CaptureMeta {
  location?: string // "Austin, Texas" — granularity the user chose, never raw coords
}

export interface Photo {
  id: string
  uri: string
  capturedAt: number
  // 'mint' = marked for minting; 'minted' = on-chain, terminal — a minted
  // photo can never re-enter a mint flow. Enforced in setAction/setBulkAction,
  // not just by convention.
  action: 'pending' | 'delete' | 'save' | 'mint' | 'minted'
  /** Capture crop applied to the stored image; absent on legacy records. */
  aspect?: AspectRatio
  meta?: CaptureMeta
  // Roll membership, stamped at capture. Deliberately stored on the photo
  // rather than read from session.activeRoll.frameIds: completeRoll() nulls
  // the active roll, and screens that hid frames by subtracting that array
  // un-hid all of them the moment a roll finished minting.
  rollId?: string
  rollName?: string
  kinoId?: string
  kinoIndex?: number
}

/** Roll a frame belongs to, passed at capture so membership is stamped atomically. */
export interface PhotoRollRef {
  id: string
  name: string
}

interface PhotoStore {
  photos: Photo[]
  addPhoto: (
    uri: string,
    roll?: PhotoRollRef,
    aspect?: AspectRatio,
    kino?: { id: string; index: number },
  ) => string
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

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: [],

  addPhoto: (
    uri: string,
    roll?: PhotoRollRef,
    aspect?: AspectRatio,
    kino?: { id: string; index: number },
  ): string => {
    const newPhoto: Photo = {
      id: uuidv4(),
      uri,
      capturedAt: Date.now(),
      action: 'pending',
      aspect,
      rollId: roll?.id,
      rollName: roll?.name,
      kinoId: kino?.id,
      kinoIndex: kino?.index,
    }
    set((state) => {
      const photos = [...state.photos, newPhoto]
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
        photo.id === id && photo.action !== 'minted' ? { ...photo, action } : photo,
      )
      return { photos }
    })
  },

  setBulkAction: (ids: string[], action: Photo['action']) => {
    set((state) => {
      const photos = state.photos.map((photo) =>
        ids.includes(photo.id) && photo.action !== 'minted' ? { ...photo, action } : photo,
      )
      return { photos }
    })
  },

  setPhotoMeta: (id: string, meta: CaptureMeta) => {
    set((state) => {
      const photos = state.photos.map((photo) => (photo.id === id ? { ...photo, meta } : photo))
      return { photos }
    })
  },

  updatePhotoUri: (id: string, newUri: string) => {
    set((state) => {
      const photos = state.photos.map((photo) => (photo.id === id ? { ...photo, uri: newUri } : photo))
      return { photos }
    })
  },

  removePhoto: (id: string) => {
    set((state) => {
      const photos = state.photos.filter((photo) => photo.id !== id)
      return { photos }
    })
  },

  removeBulkPhotos: (ids: string[]) => {
    set((state) => {
      const photos = state.photos.filter((photo) => !ids.includes(photo.id))
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
    set({ photos: [] })
  },

  clearMintedPhotos: () => {
    set((state) => {
      const photos = state.photos.filter((photo) => photo.action !== 'minted')
      return { photos }
    })
  },
}))

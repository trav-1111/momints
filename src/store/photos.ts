import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { AspectRatio } from './session'

export interface PhotoArtifact {
  mime: 'image/jpeg'
  byteLength: number
  width: number
  height: number
  imageHash: string
  renderer: 'native-egl-v2' | 'skia-v2' | 'legacy-v1'
  recipeSha256?: string
  lutSha256: string | null
}

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
  /** Exact recipe already applied to this capture. */
  filmStockId?: string
  /** Verified developed-artifact metadata. Contains no image bytes. */
  artifact?: PhotoArtifact
  meta?: CaptureMeta
  // Roll membership, stamped at capture. Deliberately stored on the photo
  // rather than read from session.activeRoll.frameIds: completeRoll() nulls
  // the active roll, and screens that hid frames by subtracting that array
  // un-hid all of them the moment a roll finished minting.
  rollId?: string
  rollName?: string
  /** Stable 1-based position within a prepaid roll, retained across retries. */
  rollFrameNumber?: number
}

/** Roll a frame belongs to, passed at capture so membership is stamped atomically. */
export interface PhotoRollRef {
  id: string
  name: string
  frameNumber: number
}

interface PhotoStore {
  photos: Photo[]
  addPhoto: (
    uri: string,
    roll?: PhotoRollRef,
    aspect?: AspectRatio,
    filmStockId?: string,
    artifact?: PhotoArtifact,
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
  restoreRollPhotos: (photos: Photo[]) => void
  clearMintedPhotos: () => void
}

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: [],

  addPhoto: (uri, roll, aspect, filmStockId, artifact): string => {
    const newPhoto: Photo = {
      id: uuidv4(),
      uri,
      capturedAt: Date.now(),
      action: 'pending',
      aspect,
      filmStockId,
      artifact,
      rollId: roll?.id,
      rollName: roll?.name,
      rollFrameNumber: roll?.frameNumber,
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

  restoreRollPhotos: (photos) => {
    set((state) => ({
      photos: [...state.photos.filter((photo) => !photo.rollId), ...photos],
    }))
  },

  clearMintedPhotos: () => {
    set((state) => {
      const photos = state.photos.filter((photo) => photo.action !== 'minted')
      return { photos }
    })
  },
}))

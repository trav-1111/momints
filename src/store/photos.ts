import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export interface Photo {
  id: string
  uri: string
  capturedAt: number
  action: 'pending' | 'delete' | 'save' | 'mint'
}

interface PhotoStore {
  photos: Photo[]
  addPhoto: (uri: string) => void
  setAction: (id: string, action: Photo['action']) => void
  setBulkAction: (ids: string[], action: Photo['action']) => void
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

  addPhoto: (uri: string) => {
    const newPhoto: Photo = {
      id: uuidv4(),
      uri,
      capturedAt: Date.now(),
      action: 'pending',
    }
    set((state) => ({
      photos: [...state.photos, newPhoto],
    }))
  },

  setAction: (id: string, action: Photo['action']) => {
    set((state) => ({
      photos: state.photos.map((photo) =>
        photo.id === id ? { ...photo, action } : photo
      ),
    }))
  },

  setBulkAction: (ids: string[], action: Photo['action']) => {
    set((state) => ({
      photos: state.photos.map((photo) =>
        ids.includes(photo.id) ? { ...photo, action } : photo
      ),
    }))
  },

  updatePhotoUri: (id: string, newUri: string) => {
    set((state) => ({
      photos: state.photos.map((photo) =>
        photo.id === id ? { ...photo, uri: newUri } : photo
      ),
    }))
  },

  removePhoto: (id: string) => {
    set((state) => ({
      photos: state.photos.filter((photo) => photo.id !== id),
    }))
  },

  removeBulkPhotos: (ids: string[]) => {
    set((state) => ({
      photos: state.photos.filter((photo) => !ids.includes(photo.id)),
    }))
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
    set((state) => ({
      photos: state.photos.filter((photo) => photo.action !== 'mint'),
    }))
  },
}))

import { useCallback } from 'react'
import { File } from 'expo-file-system'
import { usePhotoStore } from '../store/photos'
import { useSessionStore } from '../store/session'

/**
 * Coordinates roll edits that touch both the session store and the photo
 * store / filesystem: culling a single frame or discarding the whole roll.
 *
 * The session store only tracks frame ids, so deleting the underlying photo
 * record and its file lives here rather than in the store.
 */
export function useRollActions() {
  const removeFrameFromRoll = useSessionStore((s) => s.removeFrameFromRoll)
  const abandonRoll = useSessionStore((s) => s.abandonRoll)

  const deleteFrame = useCallback(
    (photoId: string) => {
      removeFrameFromRoll(photoId)
      deletePhotoWithFile(photoId)
    },
    [removeFrameFromRoll],
  )

  const discardRoll = useCallback(() => {
    const roll = useSessionStore.getState().activeRoll
    if (roll) {
      for (const photoId of roll.frameIds) {
        deletePhotoWithFile(photoId)
      }
    }
    abandonRoll()
  }, [abandonRoll])

  return { deleteFrame, discardRoll }
}

// Remove a photo's record and best-effort delete its file on disk.
function deletePhotoWithFile(photoId: string): void {
  const { photos, removePhoto } = usePhotoStore.getState()
  const photo = photos.find((p) => p.id === photoId)
  if (photo) {
    try {
      const file = new File(photo.uri)
      if (file.exists) file.delete()
    } catch {
      // A stray file is harmless — still drop the record
    }
  }
  removePhoto(photoId)
}

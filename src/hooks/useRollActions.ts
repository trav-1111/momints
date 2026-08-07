import { useCallback } from 'react'
import { File } from 'expo-file-system'
import { usePhotoStore } from '../store/photos'
import { useSessionStore } from '../store/session'
import { completeWorkerRoll } from '../services/rollApi'
import { isWorkerRollEnabled } from '../config/rollApi'

/**
 * Discarding a roll touches the session store, the photo store / filesystem,
 * and — when the roll backend is in play — the Worker, which has to be told
 * the roll is over.
 *
 * There is deliberately no per-frame delete: a roll is shot blind and minted
 * whole, so frames are never culled before minting.
 */
export function useRollActions() {
  const abandonRoll = useSessionStore((s) => s.abandonRoll)

  const discardRoll = useCallback(async () => {
    const roll = useSessionStore.getState().activeRoll
    if (roll) {
      for (const photoId of roll.frameIds) {
        deletePhotoWithFile(photoId)
      }
      // The Worker completes a roll only when every purchased frame has
      // minted, so a discarded roll would hold the wallet's one open slot
      // forever unless it is closed explicitly.
      if (isWorkerRollEnabled() && roll.collectionAddress) {
        try {
          await completeWorkerRoll(roll.collectionAddress)
        } catch (err) {
          // Never block the local discard on a backend hiccup — the roll can
          // still be closed later from the unfinished-roll card.
          console.warn('[roll] discard: failed to close roll on the backend', err)
        }
      }
    }
    abandonRoll()
  }, [abandonRoll])

  return { discardRoll }
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

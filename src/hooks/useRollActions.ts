import { useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../store/photos'
import { useSessionStore } from '../store/session'
import { completeWorkerRoll, ensureWorkerRollAuthorization } from '../services/rollApi'
import { isWorkerRollEnabled } from '../config/rollApi'
import { deleteCapture } from '../services/imagePrivacy'
import { discardRollVault } from '../services/rollVault'
import { deleteRollCapability } from '../services/rollCapability'
import { acknowledgeRollPurchase, getPendingRollPurchase } from '../services/rollCreation'

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
  const { account, signMessage } = useMobileWallet()

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
          const wallet = account?.address.toString()
          if (!wallet) throw new Error('Connect the roll wallet to close this roll on the backend.')
          await ensureWorkerRollAuthorization(roll.collectionAddress, wallet, signMessage)
          await completeWorkerRoll(roll.collectionAddress, 'user-discard')
          const pending = await getPendingRollPurchase(wallet)
          if (pending?.collectionAddress === roll.collectionAddress && pending.signature)
            await acknowledgeRollPurchase(wallet, pending.signature)
          await deleteRollCapability(roll.collectionAddress)
        } catch (err) {
          // Never block the local discard on a backend hiccup — the roll can
          // still be closed later from the unfinished-roll card.
          console.warn('[roll] discard: failed to close roll on the backend', err)
        }
      }
      await discardRollVault(roll.id)
    }
    abandonRoll()
  }, [abandonRoll, account, signMessage])

  return { discardRoll }
}

// Remove a photo's record and best-effort delete its file on disk.
function deletePhotoWithFile(photoId: string): void {
  const { photos, removePhoto } = usePhotoStore.getState()
  const photo = photos.find((p) => p.id === photoId)
  if (photo) deleteCapture(photo.uri)
  removePhoto(photoId)
}

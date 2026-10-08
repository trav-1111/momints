import { useMintQueue, type MintHistoryItem } from '../store/mintQueue'
import { useRollRegistry } from '../store/rollRegistry'

/** Replayed foreground callbacks must not add to the Worker's reconciled count. */
export function recordMintSuccess(item: MintHistoryItem): MintHistoryItem {
  const existing = useMintQueue
    .getState()
    .mintHistory.find((entry) => entry.id === item.id || entry.mintAddress === item.mintAddress)
  // Background reconciliation may already have written the full record and
  // removed the queue item. Keep its metadata instead of replacing it with defaults.
  const recorded = existing ?? item
  if (!existing) useMintQueue.getState().addToHistory(item)

  const collectionAddress = recorded.rollContext?.collectionAddress
  const roll = collectionAddress ? useRollRegistry.getState().getRoll(collectionAddress) : undefined
  if (roll) {
    const frameNumbers = new Set<number>()
    for (const entry of useMintQueue.getState().mintHistory) {
      const context = entry.rollContext
      if (
        context?.collectionAddress === roll.collectionAddress &&
        Number.isInteger(context.frameNumber) &&
        context.frameNumber >= 1 &&
        context.frameNumber <= roll.size
      ) {
        frameNumbers.add(context.frameNumber)
      }
    }
    // History is bounded and can lag Worker reconciliation. Preserve a higher
    // verified total, but never add a callback delta to it.
    useRollRegistry.getState().setFramesMinted(roll.collectionAddress, frameNumbers.size)
  }
  return recorded
}

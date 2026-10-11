import { useSessionStore } from '../store/session'
import { usePhotoStore } from '../store/photos'
import { useMintQueue } from '../store/mintQueue'
import { repairRollVaultFrameNumbers } from './rollVault'

const repairs = new Map<string, Promise<Map<string, number>>>()

/** Commit vault numbering first; a restart restores the same durable mapping. */
export function repairActiveRollFrameNumbers(wallet: string): Promise<Map<string, number>> {
  const roll = useSessionStore.getState().activeRoll
  if (!roll) return Promise.resolve(new Map())
  const pending = repairs.get(roll.id)
  if (pending) return pending
  const operation = (async () => {
    const { photos } = usePhotoStore.getState()
    const { mintHistory } = useMintQueue.getState()
    const minted = new Set(
      roll.frameIds.filter(
        (id) =>
          photos.some((photo) => photo.id === id && photo.action === 'minted') ||
          mintHistory.some((item) => item.id === id),
      ),
    )
    const numbers = await repairRollVaultFrameNumbers(roll, wallet, minted)
    if (useSessionStore.getState().activeRoll?.id !== roll.id)
      throw new Error('The active roll changed. Restart before retrying its preserved frames.')
    usePhotoStore.setState((state) => ({
      photos: state.photos.map((photo) =>
        numbers.has(photo.id) ? { ...photo, rollFrameNumber: numbers.get(photo.id) } : photo,
      ),
    }))
    useMintQueue.setState((state) => ({
      queue: state.queue.map((item) => {
        const frameNumber = numbers.get(item.photoId)
        if (!item.rollContext || item.rollContext.rollId !== roll.id || frameNumber === undefined) return item
        return {
          ...item,
          title: `${roll.name} — Frame ${frameNumber}`,
          rollContext: { ...item.rollContext, frameNumber },
        }
      }),
    }))
    return numbers
  })()
  repairs.set(roll.id, operation)
  void operation
    .finally(() => {
      if (repairs.get(roll.id) === operation) repairs.delete(roll.id)
    })
    .catch(() => {})
  return operation
}

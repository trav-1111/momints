import { historyHydrated, useMintQueue, type MintHistoryItem } from '../store/mintQueue'
import { usePhotoStore } from '../store/photos'
import { rollRegistryHydrated, useRollRegistry } from '../store/rollRegistry'
import { sessionHydrated, useSessionStore } from '../store/session'
import { filmStockHydrated, useFilmStockStore } from '../store/filmstocks'
import { getWorkerRoll, type WorkerFrameSummary } from './rollApi'
import { isPermanentImagePending, verifyPermanentImage } from './imagePrivacy'
import { acknowledgeVerifiedRollCompletion, verifyAndDiscardCompletedRollVault } from './rollVault'
import { readyWorkerFrames, reconciledFrameCount } from './rollReconciliationPolicy.cjs'

export const ROLL_RECONCILIATION_INTERVAL_MS = 60_000
export const ROLL_RECONCILIATION_WINDOW_MS = 40 * 60_000

interface ReadyFrame {
  photoId: string
  frame: WorkerFrameSummary & {
    assetAddress: string
    imageUri: string
    signature: string
  }
}

export interface RollReconciliationResult {
  state: 'idle' | 'pending' | 'awaiting-wallet' | 'complete'
  added: number
  reconciled: number
  expected: number
  vaultVerified: boolean
  issues: string[]
}

let activeReconciliation: Promise<RollReconciliationResult> | null = null

function idleResult(): RollReconciliationResult {
  return { state: 'idle', added: 0, reconciled: 0, expected: 0, vaultVerified: false, issues: [] }
}

async function reconcile(wallet: string | null): Promise<RollReconciliationResult> {
  await Promise.all([sessionHydrated, historyHydrated, rollRegistryHydrated, filmStockHydrated])

  const roll = useSessionStore.getState().activeRoll
  if (!roll?.developed || !roll.collectionAddress || roll.frameIds.length === 0) return idleResult()

  const detail = await getWorkerRoll(roll.collectionAddress)
  const registry = useRollRegistry.getState().getRoll(roll.collectionAddress)
  useRollRegistry.getState().setFramesMinted(roll.collectionAddress, detail.mintedCount)
  if (detail.status === 'COMPLETE') useRollRegistry.getState().closeRoll(roll.collectionAddress)

  const historyBefore = useMintQueue.getState().mintHistory
  const candidates = readyWorkerFrames(roll.frameIds, historyBefore, detail.frames) as ReadyFrame[]
  const catalogue = useFilmStockStore.getState().catalogue
  const filmUsed =
    catalogue.find((stock) => stock.filmStockId === roll.film.filmStockId)?.displayName ??
    (roll.film.mode === 'bw' ? 'B&W' : 'Color')
  const issues: string[] = []
  let added = 0

  for (const { photoId, frame } of candidates) {
    let imageUri: string
    try {
      imageUri = await verifyPermanentImage(frame.imageUri)
    } catch (error) {
      if (!isPermanentImagePending(error)) {
        issues.push(
          `Frame ${frame.frameIndex}: ${error instanceof Error ? error.message : 'permanent image verification failed'}`,
        )
      }
      continue
    }

    const photo = usePhotoStore.getState().photos.find((item) => item.id === photoId)
    const item: MintHistoryItem = {
      id: photoId,
      imageUri,
      imageHash: frame.imageHash ?? undefined,
      width: frame.width ?? undefined,
      height: frame.height ?? undefined,
      title: `${roll.name} — Frame ${frame.frameIndex}`,
      artist: registry?.artist ?? detail.artist,
      transactionSignature: frame.signature,
      mintAddress: frame.assetAddress,
      mintedAt: Number.isNaN(Date.parse(frame.updatedAt)) ? new Date().toISOString() : frame.updatedAt,
      capturedAt: photo?.capturedAt,
      rollContext: {
        rollId: roll.id,
        rollName: roll.name,
        frameNumber: frame.frameIndex,
        totalFrames: roll.size,
        collectionAddress: roll.collectionAddress,
      },
      filmUsed,
      aspect: registry?.aspect ?? roll.aspect,
    }
    useMintQueue.getState().addToHistory(item)
    if (photo) {
      usePhotoStore.getState().updatePhotoUri(photoId, imageUri)
      usePhotoStore.getState().setAction(photoId, 'minted')
    }
    added++
  }

  const reconciled = reconciledFrameCount(
    useMintQueue.getState().mintHistory,
    roll.collectionAddress,
    roll.frameIds,
  ) as number
  const allFramesReady = detail.status === 'COMPLETE' && detail.mintedCount === roll.size && reconciled === roll.size
  let vaultVerified = false

  // Never remove the encrypted source while the mint screen can still be
  // using it. Once its queue entries are gone, reuse the existing independent
  // owner/collection/metadata/hash verification before destroying the vault.
  const rollStillQueued = useMintQueue
    .getState()
    .queue.some((item) => item.rollContext?.collectionAddress === roll.collectionAddress)
  if (allFramesReady && wallet && wallet !== detail.wallet) {
    issues.push('Connect the wallet that created this roll to verify and release its encrypted recovery copy.')
  } else if (allFramesReady && wallet && !rollStillQueued) {
    try {
      await verifyAndDiscardCompletedRollVault(roll, wallet)
      useFilmStockStore.getState().unlockLocally(wallet, roll.film.filmStockId)
      useRollRegistry.getState().closeRoll(roll.collectionAddress)
      useSessionStore.getState().completeRoll()
      acknowledgeVerifiedRollCompletion()
      vaultVerified = true
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Independent roll verification is not complete yet.')
    }
  }

  return {
    state: vaultVerified
      ? 'complete'
      : allFramesReady && (!wallet || wallet !== detail.wallet)
        ? 'awaiting-wallet'
        : 'pending',
    added,
    reconciled,
    expected: roll.size,
    vaultVerified,
    issues,
  }
}

/**
 * Read-only reconciliation of a locally active roll against the Worker's
 * checkpointed frame state. Concurrent callers share one pass so foreground,
 * History refresh and the mint screen cannot fan out duplicate requests.
 */
export function reconcileActiveRollFrames(wallet: string | null = null): Promise<RollReconciliationResult> {
  if (activeReconciliation) return activeReconciliation
  activeReconciliation = reconcile(wallet).finally(() => {
    activeReconciliation = null
  })
  return activeReconciliation
}

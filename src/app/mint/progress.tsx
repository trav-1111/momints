import { useState, useEffect, useCallback } from 'react'
import { View, Text, Pressable, Image, ScrollView, ActivityIndicator, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../../store/photos'
import { useMintQueue } from '../../store/mintQueue'
import { useSessionStore } from '../../store/session'
import { useRollRegistry } from '../../store/rollRegistry'
import { useMint, MINT_CHUNK_SIZE, type BatchItemUpdate } from '../../hooks/useMint'
import { isWorkerRollEnabled } from '../../config/rollApi'
import { completeWorkerRoll } from '../../services/rollApi'
import { getSolscanUrl } from '../../services/mint'
import { colors, fonts, tracking } from '../../theme'
import { IconBack } from '../../components/icons'

type MintStatus = 'pending' | 'uploading' | 'signing' | 'confirming' | 'success' | 'failed'

// Each row snapshots its own uri/title at session start so it stays rendered
// (with its Solscan link) after the queue entry is consumed on success.
interface MintProgress {
  photoId: string
  photoUri: string
  title?: string
  status: MintStatus
  txSignature?: string
  error?: string
}

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.monoBold, fontSize: 20, color }}>{value}</Text>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 9,
          letterSpacing: tracking(0.12, 9),
          color: colors.textSecondary,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  )
}

export default function MintProgressScreen() {
  const router = useRouter()
  const { account } = useMobileWallet()

  const setAction = usePhotoStore((state) => state.setAction)

  const queue = useMintQueue((state) => state.queue)
  const clearQueue = useMintQueue((state) => state.clearQueue)
  const removeFromQueue = useMintQueue((state) => state.removeFromQueue)
  const addToHistory = useMintQueue((state) => state.addToHistory)

  const [progress, setProgress] = useState<MintProgress[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)

  // Snapshot the mint session once on mount: photos marked for mint, with the
  // roll's frames included only when queued (developed + sent to mint) so a
  // quick-mint session doesn't drag un-queued roll frames along. Photos whose
  // action is 'minted' never appear — that state is terminal.
  //
  // Mint history is checked too (as useMintRoll already does): it is the
  // durable record of what is on-chain, so anything in it is excluded even if
  // its photo record somehow still reads 'mint'. Last line of defence against
  // minting a duplicate of a frame the user already paid to mint.
  useEffect(() => {
    const { activeRoll } = useSessionStore.getState()
    const { queue: currentQueue, mintHistory } = useMintQueue.getState()
    const rollFrameIds = new Set(activeRoll?.frameIds ?? [])
    const alreadyMinted = new Set(mintHistory.map((h) => h.id))
    const photos = usePhotoStore
      .getState()
      .getPhotosForMint()
      .filter((p) => !alreadyMinted.has(p.id))
      .filter((p) => !rollFrameIds.has(p.id) || currentQueue.some((q) => q.photoId === p.id))
    setProgress(
      photos.map((photo) => ({
        photoId: photo.id,
        photoUri: photo.uri,
        title: currentQueue.find((q) => q.photoId === photo.id)?.title,
        status: 'pending',
      })),
    )
  }, [])

  const updateProgress = useCallback((photoId: string, update: Partial<MintProgress>) => {
    setProgress((prev) => prev.map((p) => (p.photoId === photoId ? { ...p, ...update } : p)))
  }, [])

  const { mintBatch } = useMint()

  const onItemUpdate = useCallback(
    (photoId: string, update: BatchItemUpdate) => {
      if (update.status === 'success') {
        const queueItem = useMintQueue.getState().queue.find((q) => q.photoId === photoId)
        updateProgress(photoId, { status: 'success', txSignature: update.signature })
        addToHistory({
          id: photoId,
          photoUri: queueItem?.photoUri ?? '',
          title: queueItem?.title ?? 'Untitled',
          artist: queueItem?.artist ?? '',
          txSignature: update.signature,
          mintAddress: update.mintAddress,
          mintedAt: Date.now(),
        })
        // Terminal state — the photo can never re-enter a mint flow
        setAction(photoId, 'minted')
        if (queueItem?.rollContext?.collectionAddress) {
          useRollRegistry.getState().incrementFramesMinted(queueItem.rollContext.collectionAddress)
        }
        removeFromQueue(photoId)
      } else if (update.status === 'failed') {
        updateProgress(photoId, { status: 'failed', error: update.error })
      } else {
        updateProgress(photoId, { status: update.status })
      }
    },
    [updateProgress, addToHistory, setAction, removeFromQueue],
  )

  // Mint everything still pending, in chunks with one wallet approval per
  // MINT_CHUNK_SIZE frames. Photos missing their metadata are handled by
  // tapping their row, not here — the button stays disabled until none are
  // left, so this only ever mints.
  const startMinting = useCallback(async () => {
    if (isProcessing || !account) return

    const { queue: currentQueue } = useMintQueue.getState()
    const pending = progress.filter((p) => p.status === 'pending')
    if (pending.length === 0) return

    // Pair up rather than assert: a pending photo with no queue entry has no
    // metadata to mint with, and the disabled button is a UI guard, not a
    // guarantee this function should be staking a crash on.
    const items = pending.flatMap((p) => {
      const q = currentQueue.find((item) => item.photoId === p.photoId)
      if (!q) return []
      return [
        {
          photoId: p.photoId,
          photoUri: q.photoUri,
          title: q.title,
          artist: q.artist,
          capturedAt: q.capturedAt,
          rollContext: q.rollContext,
          captureMeta: q.captureMeta,
        },
      ]
    })
    if (items.length === 0) return

    // Freeze titles into the rows so they survive queue removal on success
    setProgress((prev) =>
      prev.map((p) => {
        const q = currentQueue.find((item) => item.photoId === p.photoId)
        return q ? { ...p, title: q.title } : p
      }),
    )

    setHasStarted(true)
    setIsProcessing(true)
    try {
      await mintBatch(items, onItemUpdate)
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, account, progress, mintBatch, onItemUpdate])

  const handleRetry = useCallback(
    (photoId: string) => {
      updateProgress(photoId, { status: 'pending', error: undefined })
    },
    [updateProgress],
  )

  const handleViewOnSolscan = useCallback((signature: string) => {
    Linking.openURL(getSolscanUrl(signature))
  }, [])

  // Drop a frame from the mint queue before it's minted: remove its queue
  // item, unmark it for minting, and take it out of this session's list.
  const handleRemoveFromQueue = useCallback(
    (photoId: string) => {
      Alert.alert('Remove from queue', "Skip minting this frame? It won't be minted.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFromQueue(photoId)
            setAction(photoId, 'pending')
            setProgress((prev) => prev.filter((p) => p.photoId !== photoId))
          },
        },
      ])
    },
    [removeFromQueue, setAction],
  )

  const handleFinish = useCallback(() => {
    // If every frame of the roll has minted (this session or a previous one —
    // history ids are photo ids), the roll is complete and clears.
    const { activeRoll: roll, completeRoll } = useSessionStore.getState()
    const { mintHistory } = useMintQueue.getState()
    const { photos } = usePhotoStore.getState()
    const isMinted = (fid: string) =>
      progress.find((p) => p.photoId === fid)?.status === 'success' ||
      mintHistory.some((h) => h.id === fid) ||
      photos.find((p) => p.id === fid)?.action === 'minted'
    if (roll && roll.frameIds.length > 0 && roll.frameIds.every(isMinted)) {
      if (roll.collectionAddress) {
        useRollRegistry.getState().closeRoll(roll.collectionAddress)
        // The backend auto-completes a roll only once every purchased frame has
        // minted. Close it explicitly so a roll that ends short — a frame that
        // never minted — can't hold the wallet's one open slot forever.
        if (isWorkerRollEnabled()) {
          completeWorkerRoll(roll.collectionAddress).catch((err) => {
            console.warn('[roll] finish: failed to close roll on the backend', err)
          })
        }
      }
      completeRoll()
    }
    clearQueue()
    router.replace('/camera')
  }, [clearQueue, router, progress])

  const handleBack = useCallback(() => {
    if (isProcessing) {
      Alert.alert('Minting in Progress', 'Please wait for the current mint to complete.', [{ text: 'OK' }])
      return
    }
    router.back()
  }, [isProcessing, router])

  const successCount = progress.filter((p) => p.status === 'success').length
  const failedCount = progress.filter((p) => p.status === 'failed').length
  const pendingCount = progress.filter((p) => p.status === 'pending').length
  const allComplete = pendingCount === 0 && !isProcessing
  // Only frames that still mint on-device need a signature — roll frames going
  // through the Worker are signed by its key, not the user's wallet.
  const pendingIds = new Set(progress.filter((p) => p.status === 'pending').map((p) => p.photoId))
  const clientSidePending = queue.filter(
    (q) => pendingIds.has(q.photoId) && !(isWorkerRollEnabled() && q.rollContext?.collectionAddress),
  ).length
  const approvalsNeeded = Math.ceil(clientSidePending / MINT_CHUNK_SIZE)

  // Quick shots that still need a title/artist. Roll frames arrive pre-queued
  // from useMintRoll, so anything without a queue entry is a quick shot the
  // user has not filled in yet.
  const needingDetails = progress.filter(
    (p) => p.status === 'pending' && !queue.some((q) => q.photoId === p.photoId),
  ).length

  const openDetails = useCallback(
    (photoId: string) => {
      router.push(`/mint/form/${photoId}`)
    },
    [router],
  )

  const getStatusText = (status: MintStatus) => {
    switch (status) {
      case 'pending':
        return 'Waiting…'
      case 'uploading':
        return 'Uploading…'
      case 'signing':
        return 'Sign in your wallet…'
      case 'confirming':
        return 'Confirming on-chain…'
      case 'success':
        return 'Minted!'
      case 'failed':
        return 'Failed'
      default:
        return ''
    }
  }

  const getStatusColor = (status: MintStatus) => {
    switch (status) {
      case 'success':
        return colors.green
      case 'failed':
        return colors.redSoft
      case 'pending':
        return colors.textSecondary
      case 'signing':
        return colors.textSoft
      default:
        return colors.accentSoft
    }
  }

  const getDotColor = (status: MintStatus) => {
    switch (status) {
      case 'success':
        return colors.green
      case 'failed':
        return colors.red
      case 'signing':
        return colors.yellow
      case 'pending':
        return colors.textMuted
      default:
        return colors.accent
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: 52,
          paddingBottom: 16,
          paddingHorizontal: 22,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable onPress={handleBack} hitSlop={8}>
          <IconBack size={21} color={colors.text} strokeWidth={1.7} />
        </Pressable>
        <Text
          style={{
            fontFamily: fonts.sansBold,
            fontSize: 22,
            letterSpacing: tracking(-0.02, 22),
            color: colors.text,
          }}
        >
          Minting {progress.length} item{progress.length === 1 ? '' : 's'}
        </Text>
      </View>

      {/* Stat tiles */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, marginBottom: 20 }}>
        <StatTile value={successCount} label="SUCCESS" color={colors.green} />
        <StatTile value={failedCount} label="FAILED" color={colors.red} />
        <StatTile value={pendingCount} label="PENDING" color={colors.accent} />
      </View>

      {/* Mint rows */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, gap: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {progress.map((item) => {
          const queueItem = queue.find((q) => q.photoId === item.photoId)
          const isActive = item.status === 'uploading' || item.status === 'confirming'
          // No queue entry at all means a quick shot awaiting its details; a
          // queued roll frame always carries rollContext, and its title is
          // derived rather than user-entered.
          // Scoped to pending: a successful mint REMOVES its queue entry
          // (onItemUpdate), so a missing entry means "already minted" just as
          // often as it means "never filled in". Without the status check a
          // finished row claims it still needs details.
          const needsDetails = item.status === 'pending' && !queueItem
          const canEdit = item.status === 'pending' && !queueItem?.rollContext
          // The affordance lives in the status line rather than a trailing pill:
          // pending rows already carry REMOVE, and a second pill crowds a row
          // that also has a thumbnail and a title.
          const statusLabel = item.error
            ? `Failed — ${item.error}`
            : needsDetails
              ? 'Tap to add details'
              : canEdit
                ? `${getStatusText(item.status)} · tap to edit`
                : getStatusText(item.status)

          return (
            <Pressable
              key={item.photoId}
              onPress={canEdit ? () => openDetails(item.photoId) : undefined}
              disabled={!canEdit}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 14,
                backgroundColor: colors.surface,
                opacity: pressed && canEdit ? 0.7 : 1,
                borderWidth: 1,
                borderColor: isActive
                  ? colors.accent
                  : item.status === 'failed'
                    ? colors.redBorder
                    : needsDetails
                      ? colors.accentSoft
                      : colors.border,
              })}
            >
              <Image
                source={{ uri: item.photoUri }}
                style={{ width: 42, height: 42, borderRadius: 9 }}
                resizeMode="cover"
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.text }}>
                  {queueItem?.title || item.title || 'Untitled'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  {isActive || item.status === 'signing' ? (
                    <ActivityIndicator size={11} color={colors.accent} />
                  ) : (
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: getDotColor(item.status) }} />
                  )}
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10.5,
                      color: needsDetails ? colors.accentSoft : getStatusColor(item.status),
                    }}
                  >
                    {statusLabel}
                  </Text>
                </View>
              </View>

              {item.status === 'success' && item.txSignature && (
                <Pressable
                  onPress={() => handleViewOnSolscan(item.txSignature!)}
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.accentSoft }}>VIEW</Text>
                </Pressable>
              )}
              {item.status === 'failed' && (
                <Pressable
                  onPress={() => handleRetry(item.photoId)}
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: colors.redTint,
                    borderWidth: 1,
                    borderColor: colors.redBorder,
                  }}
                >
                  <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.text }}>RETRY</Text>
                </Pressable>
              )}
              {item.status === 'pending' && !isProcessing && (
                <Pressable
                  onPress={() => handleRemoveFromQueue(item.photoId)}
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSecondary }}>REMOVE</Text>
                </Pressable>
              )}
            </Pressable>
          )
        })}
        <View style={{ height: 12 }} />
      </ScrollView>

      {/* Action Button */}
      <View style={{ padding: 22, paddingBottom: 26 }}>
        {allComplete ? (
          <Pressable
            onPress={handleFinish}
            style={{
              alignItems: 'center',
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: colors.accent,
            }}
          >
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>Return to Camera</Text>
          </Pressable>
        ) : (
          <>
            {/* Held back until every photo has details: the approval count is
                derived from queued items, so it would understate the real
                figure while some photos are still missing their metadata. */}
            {pendingCount > 1 && !isProcessing && needingDetails === 0 && (
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 10,
                  letterSpacing: tracking(0.06, 10),
                  color: colors.textMuted,
                  textAlign: 'center',
                  marginBottom: 10,
                }}
              >
                {approvalsNeeded === 0
                  ? 'NO WALLET APPROVAL NEEDED'
                  : approvalsNeeded === 1
                    ? 'ONE WALLET APPROVAL FOR ALL FRAMES'
                    : `${approvalsNeeded} WALLET APPROVALS — 1 PER ${MINT_CHUNK_SIZE} FRAMES`}
              </Text>
            )}
            <Pressable
              onPress={startMinting}
              disabled={isProcessing || needingDetails > 0}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 15,
                borderRadius: 14,
                backgroundColor: isProcessing || needingDetails > 0 ? colors.surface : colors.accent,
                borderWidth: 1,
                borderColor: isProcessing || needingDetails > 0 ? colors.border : colors.accent,
              }}
            >
              {isProcessing ? (
                <>
                  <ActivityIndicator color={colors.accentSoft} size="small" />
                  <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.accentSoft }}>
                    Processing…
                  </Text>
                </>
              ) : needingDetails > 0 ? (
                // Says what is outstanding instead of offering a mint it cannot
                // perform — the rows themselves are where that work happens now.
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.textSecondary }}>
                  {needingDetails === 1 ? '1 photo needs details' : `${needingDetails} photos need details`}
                </Text>
              ) : (
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>
                  {hasStarted ? 'Continue Minting' : 'Start Minting'}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

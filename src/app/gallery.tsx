import { useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, FlatList, Image, Dimensions, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as MediaLibrary from 'expo-media-library'
import { File } from 'expo-file-system'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore, Photo } from '../store/photos'
import { useSessionStore } from '../store/session'
import { useMintQueue } from '../store/mintQueue'
import { useRollActions } from '../hooks/useRollActions'
import { useMintRoll } from '../hooks/useMintRoll'
import { RollCard } from '../components/RollCard'
import { FinishedRollCard } from '../components/FinishedRollCard'
import { colors, fonts } from '../theme'
import { IconBack, IconCheck, IconMint, IconSave, IconTrash } from '../components/icons'

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 36 - 12) / 3

export default function GalleryScreen() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const photos = usePhotoStore((state) => state.photos)
  const setAction = usePhotoStore((state) => state.setAction)
  const setBulkAction = usePhotoStore((state) => state.setBulkAction)
  const removeBulkPhotos = usePhotoStore((state) => state.removeBulkPhotos)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isProcessing, setIsProcessing] = useState(false)

  const activeRoll = useSessionStore((s) => s.activeRoll)
  const mintHistory = useMintQueue((s) => s.mintHistory)
  const { discardRoll } = useRollActions()
  const { mintRoll } = useMintRoll()

  // Frames already on-chain (this session or a previous one) — the roll card
  // shows partial-mint progress from this.
  const rollMintedCount = useMemo(() => {
    if (!activeRoll) return 0
    const mintedIds = new Set(mintHistory.map((h) => h.id))
    return activeRoll.frameIds.filter((fid) => {
      const p = photos.find((photo) => photo.id === fid)
      return p?.action === 'minted' || mintedIds.has(fid)
    }).length
  }, [activeRoll, photos, mintHistory])

  // Everything below operates on quick photos only — a roll's frames stay
  // hidden (surfaced via the roll cards), never in this grid. Keyed off the
  // photo's own rollId: the old activeRoll.frameIds subtraction dumped all 12
  // frames into this grid the moment completeRoll() cleared the session.
  const quickPhotos = useMemo(() => photos.filter((p) => !p.rollId), [photos])

  // Frames of rolls that are no longer the active roll, newest roll first.
  // Keeps finished rolls reachable and grouped instead of vanishing with the
  // session — nothing is deleted when a roll completes.
  const finishedRolls = useMemo(() => {
    const groups = new Map<string, { rollId: string; name: string; frames: Photo[] }>()
    for (const p of photos) {
      if (!p.rollId || p.rollId === activeRoll?.id) continue
      const group = groups.get(p.rollId) ?? {
        rollId: p.rollId,
        name: p.rollName ?? 'Roll',
        frames: [],
      }
      group.frames.push(p)
      groups.set(p.rollId, group)
    }
    return [...groups.values()].sort(
      (a, b) => (b.frames[0]?.capturedAt ?? 0) - (a.frames[0]?.capturedAt ?? 0),
    )
  }, [photos, activeRoll])

  const photosForMint = useMemo(() => quickPhotos.filter((p) => p.action === 'mint'), [quickPhotos])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(quickPhotos.map((p) => p.id)))
  }, [quickPhotos])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const saveToGallery = useCallback(async (uri: string): Promise<boolean> => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') {
        return false
      }
      await MediaLibrary.saveToLibraryAsync(uri)
      return true
    } catch (error) {
      console.error('Failed to save to gallery:', error)
      return false
    }
  }, [])

  const handleBulkAction = useCallback(
    async (action: Photo['action']) => {
      if (selectedIds.size === 0) return

      setIsProcessing(true)
      const ids = Array.from(selectedIds)

      try {
        if (action === 'delete') {
          for (const id of ids) {
            const photo = photos.find((p) => p.id === id)
            if (photo) {
              const photoFile = new File(photo.uri)
              if (photoFile.exists) {
                photoFile.delete()
              }
            }
          }
          removeBulkPhotos(ids)
          Alert.alert('Deleted', `${ids.length} photo(s) deleted`)
        } else if (action === 'save') {
          let savedCount = 0
          for (const id of ids) {
            const photo = photos.find((p) => p.id === id)
            if (photo) {
              const saved = await saveToGallery(photo.uri)
              if (saved) {
                setAction(id, 'save')
                savedCount++
              }
            }
          }
          Alert.alert('Saved', `${savedCount} photo(s) saved to camera roll`)
        } else {
          // Minted photos are terminal and silently ignored by the store, so
          // report what actually changed rather than what was selected.
          const eligible = ids.filter((id) => photos.find((p) => p.id === id)?.action !== 'minted')
          setBulkAction(ids, action)
          const skipped = ids.length - eligible.length
          if (eligible.length === 0) {
            Alert.alert('Already Minted', 'These photos are already on-chain and cannot be minted again.')
          } else {
            Alert.alert(
              'Marked',
              `${eligible.length} photo(s) marked for ${action}` +
                (skipped > 0 ? ` — ${skipped} already minted, skipped.` : ''),
            )
          }
        }
      } catch (error) {
        console.error('Bulk action failed:', error)
        Alert.alert('Error', 'Failed to complete bulk action')
      } finally {
        setIsProcessing(false)
        exitSelectMode()
      }
    },
    [selectedIds, photos, setBulkAction, removeBulkPhotos, setAction, saveToGallery, exitSelectMode],
  )

  const handlePhotoPress = useCallback(
    (photo: Photo) => {
      if (selectMode) {
        toggleSelect(photo.id)
      } else {
        // Pass the id, not an index: review filters its list differently from
        // this grid, so an index computed here pointed at the wrong photo.
        router.push(`/review?photoId=${photo.id}`)
      }
    },
    [selectMode, toggleSelect, router],
  )

  const handleProceedToMint = useCallback(() => {
    if (photosForMint.length === 0) {
      Alert.alert('No Photos Selected', 'Please mark at least one photo for minting.')
      return
    }
    if (!account) {
      Alert.alert('Wallet Required', 'Connect your Solana wallet to mint NFTs.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Connect', onPress: () => connect() },
      ])
      return
    }
    router.push('/mint/progress')
  }, [photosForMint.length, router, account, connect])


  const handleBack = useCallback(() => {
    if (selectMode) {
      exitSelectMode()
    } else {
      router.back()
    }
  }, [selectMode, exitSelectMode, router])

  const renderPhoto = useCallback(
    ({ item }: { item: Photo }) => {
      const isSelected = selectedIds.has(item.id)

      return (
        <Pressable
          onPress={() => handlePhotoPress(item)}
          onLongPress={() => {
            if (!selectMode) {
              setSelectMode(true)
              toggleSelect(item.id)
            }
          }}
          style={{ margin: 2, borderRadius: 8, overflow: 'hidden', width: ITEM_SIZE, height: ITEM_SIZE }}
        >
          <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />

          {selectMode && (
            <View
              style={{
                position: 'absolute',
                top: 5,
                left: 5,
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isSelected ? colors.accent : 'rgba(0,0,0,0.4)',
                borderWidth: 1.5,
                borderColor: isSelected ? colors.accent : 'rgba(255,255,255,0.6)',
              }}
            >
              {isSelected && <IconCheck size={12} color={colors.white} strokeWidth={2.4} />}
            </View>
          )}

          {!selectMode && item.action !== 'pending' && (
            <View
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
                width: 18,
                height: 18,
                borderRadius: 9,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  item.action === 'mint' || item.action === 'minted'
                    ? 'rgba(125,123,240,0.92)'
                    : item.action === 'save'
                      ? 'rgba(58,208,122,0.92)'
                      : 'rgba(229,84,75,0.92)',
              }}
            >
              {item.action === 'mint' && <IconMint size={10} color={colors.white} strokeWidth={2} />}
              {item.action === 'minted' && <IconCheck size={10} color={colors.white} strokeWidth={2.4} />}
              {item.action === 'save' && <IconSave size={10} color="#06210f" strokeWidth={2.4} />}
              {item.action === 'delete' && <IconTrash size={10} color={colors.white} strokeWidth={2} />}
            </View>
          )}
        </Pressable>
      )
    },
    [selectMode, selectedIds, handlePhotoPress, toggleSelect],
  )

  const pendingCount = quickPhotos.filter((p) => p.action === 'pending').length
  const mintCount = photosForMint.length
  const proceedEnabled = pendingCount === 0 && mintCount > 0

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: 52,
          paddingBottom: 16,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={handleBack} hitSlop={8}>
            <IconBack size={21} color={colors.text} strokeWidth={1.7} />
          </Pressable>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: colors.text }}>
            {selectMode ? `${selectedIds.size} Selected` : 'All Photos'}
          </Text>
        </View>

        {selectMode ? (
          <Pressable onPress={selectedIds.size === quickPhotos.length ? deselectAll : selectAll} hitSlop={8}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.accent }}>
              {selectedIds.size === quickPhotos.length ? 'NONE' : 'ALL'}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => router.push('/past-mints')} hitSlop={8}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textSecondary }}>HISTORY</Text>
            </Pressable>
            <Pressable onPress={() => setSelectMode(true)} hitSlop={8}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.accent }}>SELECT</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Photo Grid (+ roll status card header when a roll is active) */}
      {photos.length === 0 && !activeRoll ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary }}>No photos yet</Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: 8 }}>
            Go back to camera to take some photos
          </Text>
        </View>
      ) : (
        <FlatList
          data={quickPhotos}
          renderItem={renderPhoto}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            selectMode ? null : (
              <>
                {activeRoll && (
                  <RollCard
                    roll={activeRoll}
                    mintedCount={rollMintedCount}
                    onMint={() => mintRoll()}
                    onDiscard={discardRoll}
                  />
                )}
                {finishedRolls.map((roll) => (
                  <FinishedRollCard key={roll.rollId} name={roll.name} frames={roll.frames} />
                ))}
              </>
            )
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary }}>No quick photos</Text>
              <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: 8 }}>
                Photos outside the roll will appear here
              </Text>
            </View>
          }
        />
      )}

      {/* Bottom Action */}
      {quickPhotos.length > 0 && (
        <View style={{ padding: 18, paddingBottom: 26, borderTopWidth: 1, borderTopColor: colors.border }}>
          {selectMode ? (
            <View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => handleBulkAction('delete')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 12,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: selectedIds.size > 0 ? 1 : 0.5,
                  }}
                >
                  <IconTrash size={18} color={colors.redSoft} />
                  <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11, color: colors.redSoft }}>Delete</Text>
                </Pressable>

                <Pressable
                  onPress={() => handleBulkAction('save')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 12,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: selectedIds.size > 0 ? 1 : 0.5,
                  }}
                >
                  <IconSave size={18} color={colors.greenSoft} />
                  <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11, color: colors.greenSoft }}>Save</Text>
                </Pressable>

                <Pressable
                  onPress={() => handleBulkAction('mint')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 12,
                    borderRadius: 14,
                    backgroundColor: selectedIds.size > 0 ? colors.accent : colors.surface,
                    borderWidth: 1,
                    borderColor: selectedIds.size > 0 ? colors.accent : colors.border,
                  }}
                >
                  <IconMint size={18} color={selectedIds.size > 0 ? colors.white : colors.textMuted} />
                  <Text
                    style={{
                      fontFamily: fonts.sansBold,
                      fontSize: 11,
                      color: selectedIds.size > 0 ? colors.white : colors.textMuted,
                    }}
                  >
                    Mint
                  </Text>
                </Pressable>
              </View>
              <Text
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  color: colors.textMuted,
                  textAlign: 'center',
                  marginTop: 10,
                }}
              >
                Long press any photo to start selecting
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={handleProceedToMint}
              disabled={!proceedEnabled}
              style={{
                alignItems: 'center',
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: proceedEnabled ? colors.accent : colors.surface,
                borderWidth: 1,
                borderColor: proceedEnabled ? colors.accent : colors.border,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.sansBold,
                  fontSize: 13.5,
                  color: proceedEnabled ? colors.white : colors.textMuted,
                }}
              >
                {pendingCount > 0
                  ? `Review remaining (${pendingCount} pending)`
                  : mintCount > 0
                    ? `Proceed to Mint (${mintCount})`
                    : 'No photos to mint'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

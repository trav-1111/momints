import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  Dimensions,
  Alert,
  StatusBar,
  ViewStyle,
  StyleSheet,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import * as MediaLibrary from 'expo-media-library'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore, Photo } from '../store/photos'
import {
  useKinoSettingsStore,
  KINO_PLAYBACK_SPEEDS,
  SHUTTER_GAP_MS,
  KINO_SHUTTER_GAP_LABELS,
  getShutterBlackoutMs,
  KinoPlaybackSpeed,
  KinoShutterGap,
} from '../store/kinoSettings'
import { colors, fonts, tracking } from '../theme'
import { IconArrowRight, IconBack, IconMint, IconSave, IconTrash } from '../components/icons'
import { deleteCapture } from '../services/imagePrivacy'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

const chip: ViewStyle = {
  backgroundColor: colors.chipBg,
  borderWidth: 1,
  borderColor: colors.chipBorder,
}

interface KinoReelPlayerProps {
  frames: (Photo & { originalIdx: number })[]
  initialIndex: number
  isPlaying: boolean
  playbackFps: KinoPlaybackSpeed
  shutterGap: KinoShutterGap
  onTogglePlay: () => void
  onFrameChange: (frameIdx: number, originalIdx: number) => void
}

function KinoReelPlayer({
  frames,
  initialIndex,
  isPlaying,
  playbackFps,
  shutterGap,
  onTogglePlay,
  onFrameChange,
}: KinoReelPlayerProps) {
  const [activePointer, setActivePointer] = useState(() => {
    const idx = frames.findIndex((f) => f.originalIdx === initialIndex)
    return idx >= 0 ? idx : 0
  })
  const [isBlackout, setIsBlackout] = useState(false)
  const activePointerRef = useRef(activePointer)
  activePointerRef.current = activePointer

  // When initialIndex changes while NOT playing, sync active pointer
  useEffect(() => {
    if (!isPlaying) {
      const idx = frames.findIndex((f) => f.originalIdx === initialIndex)
      if (idx >= 0) {
        setActivePointer(idx)
      }
    }
  }, [initialIndex, isPlaying, frames])

  // Playback ticker with rotary shutter blade synchronization
  useEffect(() => {
    if (!isPlaying || frames.length <= 1) {
      setIsBlackout(false)
      return
    }

    const framePeriodMs = Math.round(1000 / playbackFps)
    const blackoutMs = getShutterBlackoutMs(shutterGap, playbackFps)
    let blackoutTimer: ReturnType<typeof setTimeout> | null = null

    const ticker = setInterval(() => {
      const nextPointer = (activePointerRef.current + 1) % frames.length
      const targetFrame = frames[nextPointer]

      if (blackoutMs > 0) {
        // Drop rotary shutter blade
        setIsBlackout(true)
        // Advance frame behind closed shutter
        setActivePointer(nextPointer)
        if (targetFrame) {
          onFrameChange(nextPointer, targetFrame.originalIdx)
        }
        // Open rotary shutter blade after blackout duration
        blackoutTimer = setTimeout(() => {
          setIsBlackout(false)
        }, blackoutMs)
      } else {
        // Shutter blade off: direct frame advance
        setActivePointer(nextPointer)
        if (targetFrame) {
          onFrameChange(nextPointer, targetFrame.originalIdx)
        }
      }
    }, framePeriodMs)

    return () => {
      clearInterval(ticker)
      if (blackoutTimer) clearTimeout(blackoutTimer)
      setIsBlackout(false)
    }
  }, [isPlaying, playbackFps, shutterGap, frames, onFrameChange])

  if (!isPlaying) return null

  return (
    <Pressable onPress={onTogglePlay} style={[StyleSheet.absoluteFill, { zIndex: 5 }]}>
      {/* Preloaded stack of all frames in the Kino reel */}
      {frames.map((frame, index) => (
        <View
          key={frame.id}
          style={[
            StyleSheet.absoluteFill,
            { opacity: activePointer === index ? 1 : 0 },
          ]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: frame.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            priority="high"
          />
        </View>
      ))}

      {/* Rotary Shutter Blackout Blade Overlay */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#000',
            opacity: isBlackout ? 1 : 0,
            zIndex: 6,
          },
        ]}
      />

      {/* Live Playback Indicator Badge */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 80,
          left: 18,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 999,
          backgroundColor: 'rgba(211, 84, 0, 0.92)',
          zIndex: 7,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.monoBold,
            fontSize: 10,
            letterSpacing: tracking(0.06, 10),
            color: colors.white,
          }}
        >
          🎞️ KINO #{activePointer + 1} / {frames.length} ({playbackFps} FPS)
        </Text>
      </View>
    </Pressable>
  )
}

export default function ReviewScreen() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const flatListRef = useRef<FlatList>(null)

  const allPhotos = usePhotoStore((state) => state.photos)
  const setAction = usePhotoStore((state) => state.setAction)
  const removePhoto = usePhotoStore((state) => state.removePhoto)

  // Quick-photo reviewer only, and only for photos that still need a decision:
  //  - roll frames are surfaced by the gallery's roll card, never here (keyed
  //    off the photo's own rollId so finished rolls stay excluded too)
  //  - minted photos are terminal; showing them offered a "Mint" button that
  //    would mint a duplicate NFT of a frame already on-chain
  const photos = useMemo(() => allPhotos.filter((p) => !p.rollId && p.action !== 'minted'), [allPhotos])

  // Opening from the gallery lands on the tapped photo. Resolved by id rather
  // than a passed index, since this list and the gallery grid filter differently.
  const { photoId } = useLocalSearchParams<{ photoId?: string }>()
  const initialIndex = useMemo(() => {
    if (!photoId) return 0
    const i = photos.findIndex((p) => p.id === photoId)
    return i >= 0 ? i : 0
  }, [photoId, photos])

  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [isProcessing, setIsProcessing] = useState(false)

  const pendingCount = useMemo(() => photos.filter((p) => p.action === 'pending').length, [photos])

  const mintCount = useMemo(() => photos.filter((p) => p.action === 'mint').length, [photos])

  const allMarked = pendingCount === 0 && photos.length > 0

  const currentPhoto = photos[currentIndex]

  const handleBack = useCallback(() => {
    router.back()
  }, [router])

  const handleViewAll = useCallback(() => {
    router.push('/gallery')
  }, [router])

  const findNextPendingIndex = useCallback(
    (startIndex: number): number => {
      for (let i = startIndex + 1; i < photos.length; i++) {
        if (photos[i].action === 'pending') return i
      }
      for (let i = 0; i < startIndex; i++) {
        if (photos[i].action === 'pending') return i
      }
      return -1
    },
    [photos],
  )

  const scrollToIndex = useCallback((index: number) => {
    if (index >= 0 && flatListRef.current) {
      flatListRef.current.scrollToIndex({ index, animated: true })
    }
  }, [])

  // The photo store hydrates asynchronously, so the deep-linked photo often
  // isn't in the list on first render. Land on it once, the first time the
  // list is non-empty, and never fight the user's scrolling afterwards.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current || photos.length === 0) return
    didInitialScroll.current = true
    if (initialIndex > 0) {
      setCurrentIndex(initialIndex)
      setTimeout(() => scrollToIndex(initialIndex), 0)
    }
  }, [photos.length, initialIndex, scrollToIndex])

  // LomoKino burst reel playback settings & rotary shutter
  const playbackFps = useKinoSettingsStore((s) => s.playbackFps)
  const setPlaybackFps = useKinoSettingsStore((s) => s.setPlaybackFps)
  const shutterGap = useKinoSettingsStore((s) => s.shutterGap)
  const cycleShutterGap = useKinoSettingsStore((s) => s.cycleShutterGap)

  const [isPlayingKino, setIsPlayingKino] = useState(false)
  const lastKinoOriginalIdxRef = useRef(currentIndex)

  const kinoFrames = useMemo(() => {
    if (!currentPhoto?.kinoId) return []
    return photos
      .map((p, idx) => ({ ...p, originalIdx: idx }))
      .filter((p) => p.kinoId === currentPhoto.kinoId)
      .sort((a, b) => (a.kinoIndex ?? 0) - (b.kinoIndex ?? 0))
  }, [photos, currentPhoto?.kinoId])

  useEffect(() => {
    if (!isPlayingKino) {
      lastKinoOriginalIdxRef.current = currentIndex
    }
  }, [currentIndex, isPlayingKino])

  const handleKinoFrameChange = useCallback((_frameIdx: number, originalIdx: number) => {
    lastKinoOriginalIdxRef.current = originalIdx
  }, [])

  const handleStopKino = useCallback(() => {
    setIsPlayingKino(false)
    const targetIdx = lastKinoOriginalIdxRef.current
    if (targetIdx >= 0 && targetIdx < photos.length) {
      setCurrentIndex(targetIdx)
      flatListRef.current?.scrollToIndex({ index: targetIdx, animated: false })
    }
  }, [photos.length])

  const toggleKinoPlayback = useCallback(() => {
    if (isPlayingKino) {
      handleStopKino()
    } else {
      if (kinoFrames.length <= 1) return
      lastKinoOriginalIdxRef.current = currentIndex
      setIsPlayingKino(true)
    }
  }, [isPlayingKino, handleStopKino, kinoFrames.length, currentIndex])

  useEffect(() => {
    return () => {
      setIsPlayingKino(false)
    }
  }, [])

  useEffect(() => {
    if (isPlayingKino && kinoFrames.length <= 1) {
      setIsPlayingKino(false)
    }
  }, [isPlayingKino, kinoFrames.length])

  const saveToGallery = useCallback(async (uri: string): Promise<boolean> => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to save photos.')
        return false
      }
      await MediaLibrary.saveToLibraryAsync(uri)
      return true
    } catch (error) {
      console.error('Failed to save to gallery:', error)
      return false
    }
  }, [])

  const handleAction = useCallback(
    async (action: Photo['action']) => {
      if (!currentPhoto || isProcessing) return

      setIsProcessing(true)

      try {
        if (action === 'delete') {
          deleteCapture(currentPhoto.uri)
          removePhoto(currentPhoto.id)

          if (currentIndex >= photos.length - 1 && photos.length > 1) {
            setCurrentIndex(photos.length - 2)
          }
        } else if (action === 'save') {
          const saved = await saveToGallery(currentPhoto.uri)
          if (saved) {
            deleteCapture(currentPhoto.uri)
            removePhoto(currentPhoto.id)
            Alert.alert('Saved', 'Photo saved to your camera roll!')
          } else {
            setIsProcessing(false)
            return
          }
        } else {
          setAction(currentPhoto.id, action)
        }

        const nextPending = findNextPendingIndex(currentIndex)
        if (nextPending >= 0 && action !== 'delete') {
          setTimeout(() => scrollToIndex(nextPending), 300)
        }
      } catch (error) {
        console.error('Failed to process action:', error)
        Alert.alert('Error', 'Failed to process action')
      } finally {
        setIsProcessing(false)
      }
    },
    [
      currentPhoto,
      currentIndex,
      photos.length,
      isProcessing,
      setAction,
      removePhoto,
      saveToGallery,
      findNextPendingIndex,
      scrollToIndex,
    ],
  )

  const handleProceedToMint = useCallback(() => {
    if (mintCount === 0) {
      Alert.alert('No Photos for Minting', 'Please mark at least one photo for minting.')
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
  }, [mintCount, router, account, connect])

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setCurrentIndex(viewableItems[0].index)
    }
  }, [])

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current

  const renderItem = useCallback(
    ({ item }: { item: Photo }) => (
      <View style={{ width: screenWidth, height: screenHeight }}>
        <Image
          source={{ uri: item.uri }}
          style={{ width: screenWidth, height: screenHeight }}
          contentFit="cover"
          cachePolicy="memory"
        />

        <LinearGradient
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }}
        />

        {/* Kino sequence badge */}
        {item.kinoId && (
          <View
            style={{
              position: 'absolute',
              top: 80,
              left: 18,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: 'rgba(243, 156, 18, 0.9)',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.monoBold,
                fontSize: 10,
                letterSpacing: tracking(0.06, 10),
                color: colors.white,
              }}
            >
              🎞️ KINO #{item.kinoIndex !== undefined ? item.kinoIndex + 1 : ''}
            </Text>
          </View>
        )}

        {/* Marked-action badge */}
        {item.action !== 'pending' && (
          <View
            style={{
              position: 'absolute',
              top: 80,
              right: 18,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 11,
              borderRadius: 999,
              backgroundColor:
                item.action === 'mint' || item.action === 'minted'
                  ? 'rgba(125,123,240,0.9)'
                  : item.action === 'save'
                    ? 'rgba(58,208,122,0.9)'
                    : 'rgba(229,84,75,0.9)',
            }}
          >
            {(item.action === 'mint' || item.action === 'minted') && (
              <IconMint size={13} color={colors.white} strokeWidth={1.8} />
            )}
            {item.action === 'save' && <IconSave size={13} color={colors.white} strokeWidth={1.8} />}
            {item.action === 'delete' && <IconTrash size={13} color={colors.white} strokeWidth={1.8} />}
            <Text
              style={{
                fontFamily: fonts.monoBold,
                fontSize: 10,
                letterSpacing: tracking(0.06, 10),
                color: colors.white,
              }}
            >
              {item.action.toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    ),
    [],
  )

  if (photos.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary }}>No photos to review</Text>
        <Pressable
          onPress={handleBack}
          style={{
            marginTop: 16,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 14,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>Back to Camera</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />

      <FlatList
        ref={flatListRef}
        data={photos}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
      />

      {/* Active Kino frame high-speed projection player */}
      <KinoReelPlayer
        frames={kinoFrames}
        initialIndex={currentIndex}
        isPlaying={isPlayingKino}
        playbackFps={playbackFps}
        shutterGap={shutterGap}
        onTogglePlay={handleStopKino}
        onFrameChange={handleKinoFrameChange}
      />

      {/* Top bar */}
      <View
        style={{
          position: 'absolute',
          top: 20,
          left: 18,
          right: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 20,
        }}
      >
        <Pressable
          onPress={handleBack}
          style={[chip, { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }]}
        >
          <IconBack size={19} color={colors.text} strokeWidth={1.7} />
        </Pressable>

        <View style={[chip, { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 }]}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.text }}>
            {currentIndex + 1} / {photos.length}
          </Text>
        </View>

        <Pressable
          onPress={handleViewAll}
          style={[chip, { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 }]}
        >
          <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.text }}>View All</Text>
        </Pressable>
      </View>

      {/* Kino Reel Playback & Speed & Shutter Controls */}
      {kinoFrames.length > 1 && (
        <View
          style={{
            position: 'absolute',
            bottom: allMarked ? 84 : 148,
            left: 18,
            right: 18,
            alignItems: 'center',
            gap: 8,
            zIndex: 20,
          }}
        >
          {/* Speed & Shutter Gap Bar */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(15, 12, 8, 0.88)',
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(243, 156, 18, 0.35)',
            }}
          >
            {/* Speed pills */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {KINO_PLAYBACK_SPEEDS.map((fps) => {
                const selected = playbackFps === fps
                return (
                  <Pressable
                    key={fps}
                    onPress={() => setPlaybackFps(fps)}
                    style={{
                      paddingHorizontal: 7,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: selected ? '#f39c12' : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.monoBold,
                        fontSize: 9,
                        color: selected ? '#fff' : colors.textSoft,
                      }}
                    >
                      {fps} FPS
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={{ width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.2)' }} />

            {/* Shutter blackout gap pill */}
            <Pressable
              onPress={() => cycleShutterGap()}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: shutterGap === 'off' ? 'rgba(255,255,255,0.06)' : 'rgba(243,156,18,0.25)',
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 8.5,
                  letterSpacing: tracking(0.08, 8.5),
                  color: shutterGap === 'off' ? colors.textMuted : colors.accentSoft,
                }}
              >
                BLADE: {KINO_SHUTTER_GAP_LABELS[shutterGap]}
              </Text>
            </Pressable>
          </View>

          {/* Main Play / Pause Button */}
          <Pressable
            onPress={toggleKinoPlayback}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: isPlayingKino ? '#d35400' : 'rgba(25, 20, 10, 0.92)',
              borderWidth: 1,
              borderColor: '#f39c12',
              paddingHorizontal: 20,
              paddingVertical: 9,
              borderRadius: 999,
            }}
          >
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: '#fff' }}>
              {isPlayingKino ? '⏸ PAUSE KINO REEL' : `▶ PLAY KINO REEL (${playbackFps} FPS)`}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Bottom actions */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 26, paddingHorizontal: 18, zIndex: 20 }}>
        {allMarked ? (
          <Pressable
            onPress={handleProceedToMint}
            disabled={mintCount === 0}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: mintCount > 0 ? colors.accentTint : colors.surface,
              borderWidth: 1,
              borderColor: mintCount > 0 ? colors.accent : colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.sansBold,
                fontSize: 13.5,
                color: mintCount > 0 ? colors.accentSoft : colors.textMuted,
              }}
            >
              {mintCount > 0 ? `Proceed to Mint (${mintCount})` : 'No Photos to Mint'}
            </Text>
            {mintCount > 0 && <IconArrowRight size={16} color={colors.accentSoft} strokeWidth={1.8} />}
          </Pressable>
        ) : (
          <>
            {/* Remaining pill */}
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={[chip, { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999 }]}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textSoft }}>
                  {pendingCount} REMAINING
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => handleAction('delete')}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 7,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: colors.tileBg,
                  borderWidth: 1,
                  borderColor: colors.tileBorder,
                }}
              >
                <IconTrash size={21} color={colors.redSoft} />
                <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11, color: colors.redSoft }}>Delete</Text>
              </Pressable>

              <Pressable
                onPress={() => handleAction('save')}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 7,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: colors.tileBg,
                  borderWidth: 1,
                  borderColor: colors.tileBorder,
                }}
              >
                <IconSave size={21} color={colors.greenSoft} />
                <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11, color: colors.greenSoft }}>Save</Text>
              </Pressable>

              <Pressable
                onPress={() => handleAction('mint')}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 7,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: colors.accent,
                  borderWidth: 1,
                  borderColor: colors.accent,
                }}
              >
                <IconMint size={21} color={colors.white} />
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 11, color: colors.white }}>Mint</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  )
}

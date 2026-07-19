import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { View, Text, Pressable, FlatList, Image, Dimensions, Alert, StatusBar, ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { usePhotoStore, Photo } from '../store/photos'
import { useSessionStore } from '../store/session'
import { useMintQueue } from '../store/mintQueue'
import { useRollActions } from '../hooks/useRollActions'
import { useMintRoll } from '../hooks/useMintRoll'
import { colors, fonts, tracking } from '../theme'
import { IconBack, IconMint, IconTrash } from '../components/icons'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

const chip: ViewStyle = {
  backgroundColor: colors.chipBg,
  borderWidth: 1,
  borderColor: colors.chipBorder,
}

// Film sprocket strip — alternating dark blocks down each edge, like the
// perforations on a strip of 35mm.
const SPROCKET_STEP = 18
const SPROCKET_COUNT = Math.ceil(screenHeight / SPROCKET_STEP)

function SprocketEdge({ side }: { side: 'left' | 'right' }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        [side]: 0,
        top: 0,
        bottom: 0,
        width: 14,
        backgroundColor: 'rgba(0,0,0,0.35)',
      }}
    >
      {Array.from({ length: SPROCKET_COUNT }).map((_, i) => (
        <View key={i} style={{ height: 8, marginBottom: SPROCKET_STEP - 8, backgroundColor: 'rgba(0,0,0,0.72)' }} />
      ))}
    </View>
  )
}

export default function DevelopScreen() {
  const router = useRouter()
  const flatListRef = useRef<FlatList>(null)

  const photos = usePhotoStore((state) => state.photos)
  const activeRoll = useSessionStore((state) => state.activeRoll)
  const { deleteFrame, discardRoll } = useRollActions()
  const { mintRoll } = useMintRoll()

  const [currentIndex, setCurrentIndex] = useState(0)

  // The developed roll's frames, in capture order
  const frames = useMemo(() => {
    if (!activeRoll) return []
    const byId = new Map(photos.map((p) => [p.id, p]))
    return activeRoll.frameIds.map((fid) => byId.get(fid)).filter((p): p is Photo => p !== undefined)
  }, [activeRoll, photos])

  // Frames already on-chain never mint again — the button offers the rest.
  const mintHistory = useMintQueue((s) => s.mintHistory)
  const mintedIds = useMemo(() => {
    const ids = new Set(mintHistory.map((h) => h.id))
    for (const p of photos) {
      if (p.action === 'minted') ids.add(p.id)
    }
    return ids
  }, [mintHistory, photos])
  const remainingCount = frames.filter((f) => !mintedIds.has(f.id)).length

  // Keep the index in range as frames get culled
  useEffect(() => {
    if (currentIndex > frames.length - 1) {
      setCurrentIndex(Math.max(0, frames.length - 1))
    }
  }, [frames.length, currentIndex])

  const handleBack = useCallback(() => {
    router.back()
  }, [router])

  const handleDelete = useCallback(() => {
    const photo = frames[currentIndex]
    if (!photo) return
    Alert.alert('Delete frame', "Remove this frame? It won't be minted and can't be recovered.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteFrame(photo.id) },
    ])
  }, [frames, currentIndex, deleteFrame])

  const handleDiscardRoll = useCallback(() => {
    Alert.alert('Discard roll', 'Delete this roll and all its frames without minting?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          discardRoll()
          router.replace('/camera')
        },
      },
    ])
  }, [discardRoll, router])

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setCurrentIndex(viewableItems[0].index)
    }
  }).current

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current

  const renderItem = useCallback(
    ({ item }: { item: Photo }) => (
      <View style={{ width: screenWidth, height: screenHeight }}>
        <Image source={{ uri: item.uri }} style={{ width: screenWidth, height: screenHeight }} resizeMode="cover" />
        <LinearGradient
          colors={['rgba(0,0,0,0.68)', 'rgba(0,0,0,0)']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 130 }}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 210 }}
        />
        {mintedIds.has(item.id) && (
          <View
            style={{
              position: 'absolute',
              top: 88,
              right: 24,
              paddingVertical: 5,
              paddingHorizontal: 11,
              borderRadius: 999,
              backgroundColor: 'rgba(58,208,122,0.92)',
            }}
          >
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: tracking(0.08, 10), color: '#06210f' }}>
              MINTED
            </Text>
          </View>
        )}
      </View>
    ),
    [mintedIds],
  )

  if (!activeRoll || !activeRoll.developed) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <StatusBar barStyle="light-content" />
        <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary, textAlign: 'center' }}>
          No developed roll to review
        </Text>
        <Pressable
          onPress={() => router.replace('/camera')}
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

  if (frames.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <StatusBar barStyle="light-content" />
        <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary, textAlign: 'center' }}>
          All frames removed
        </Text>
        <Pressable
          onPress={handleDiscardRoll}
          style={{
            marginTop: 16,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 14,
            backgroundColor: colors.red,
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>Discard Roll</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />

      <FlatList
        ref={flatListRef}
        data={frames}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
      />

      {/* 35mm sprocket edges */}
      <SprocketEdge side="left" />
      <SprocketEdge side="right" />

      {/* Top bar */}
      <View
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          right: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={handleBack}
          style={[chip, { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }]}
        >
          <IconBack size={19} color={colors.text} strokeWidth={1.7} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>
            {activeRoll.name}
            {activeRoll.film.mode === 'bw' ? ' · B&W' : ''}
          </Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: tracking(0.14, 10),
              color: colors.textSoft,
              marginTop: 2,
            }}
          >
            FRAME {currentIndex + 1} / {frames.length}
          </Text>
        </View>
        <Pressable onPress={handleDiscardRoll} hitSlop={8}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.redSoft }}>DISCARD</Text>
        </Pressable>
      </View>

      {/* Bottom actions */}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 30 }}>
        {/* Hint pill */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View style={[chip, { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 }]}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10.5,
                letterSpacing: tracking(0.04, 10.5),
                color: colors.textSoft,
                textAlign: 'center',
              }}
            >
              Swipe to review · delete the ones you don&apos;t want
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable
            onPress={handleDelete}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingHorizontal: 20,
              borderRadius: 16,
              backgroundColor: colors.tileBg,
              borderWidth: 1,
              borderColor: colors.tileBorder,
            }}
          >
            <IconTrash size={19} color={colors.redSoft} />
            <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.redSoft }}>Delete</Text>
          </Pressable>

          <Pressable
            onPress={() => mintRoll()}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              paddingVertical: 16,
              borderRadius: 16,
              backgroundColor: colors.accent,
            }}
          >
            <IconMint size={18} color={colors.white} strokeWidth={1.7} />
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>
              {remainingCount === 0
                ? 'Finish Roll'
                : remainingCount < frames.length
                  ? `Mint Remaining (${remainingCount})`
                  : `Mint Roll (${frames.length})`}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { View, Text, Pressable, FlatList, Image, Dimensions, Alert, StatusBar, ViewStyle } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import * as MediaLibrary from 'expo-media-library'
import { File } from 'expo-file-system'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore, Photo } from '../store/photos'
import { colors, fonts, tracking } from '../theme'
import { IconArrowRight, IconBack, IconMint, IconSave, IconTrash } from '../components/icons'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

const chip: ViewStyle = {
  backgroundColor: colors.chipBg,
  borderWidth: 1,
  borderColor: colors.chipBorder,
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
  const photos = useMemo(
    () => allPhotos.filter((p) => !p.rollId && p.action !== 'minted'),
    [allPhotos],
  )

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
          const photoFile = new File(currentPhoto.uri)
          if (photoFile.exists) {
            photoFile.delete()
          }
          removePhoto(currentPhoto.id)

          if (currentIndex >= photos.length - 1 && photos.length > 1) {
            setCurrentIndex(photos.length - 2)
          }
        } else if (action === 'save') {
          const saved = await saveToGallery(currentPhoto.uri)
          if (saved) {
            setAction(currentPhoto.id, action)
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
        <Image source={{ uri: item.uri }} style={{ width: screenWidth, height: screenHeight }} resizeMode="cover" />

        <LinearGradient
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }}
        />

        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 230 }}
        />

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

      {/* Bottom actions */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 26, paddingHorizontal: 18 }}>
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

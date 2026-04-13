import { useState, useCallback, useRef, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  Dimensions,
  Alert,
  StatusBar,
} from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import * as MediaLibrary from 'expo-media-library'
import { File } from 'expo-file-system'
import { usePhotoStore, Photo } from '../store/photos'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

export default function ReviewScreen() {
  const router = useRouter()
  const flatListRef = useRef<FlatList>(null)

  const photos = usePhotoStore((state) => state.photos)
  const setAction = usePhotoStore((state) => state.setAction)
  const removePhoto = usePhotoStore((state) => state.removePhoto)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  const pendingCount = useMemo(
    () => photos.filter((p) => p.action === 'pending').length,
    [photos]
  )

  const mintCount = useMemo(
    () => photos.filter((p) => p.action === 'mint').length,
    [photos]
  )

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
    [photos]
  )

  const scrollToIndex = useCallback((index: number) => {
    if (index >= 0 && flatListRef.current) {
      flatListRef.current.scrollToIndex({ index, animated: true })
    }
  }, [])

  const saveToGallery = useCallback(async (uri: string): Promise<boolean> => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please grant photo library access to save photos.'
        )
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
    ]
  )

  const handleProceedToMint = useCallback(() => {
    if (mintCount === 0) {
      Alert.alert('No Photos for Minting', 'Please mark at least one photo for minting.')
      return
    }
    router.push('/mint/progress')
  }, [mintCount, router])

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index)
      }
    },
    []
  )

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current

  const getActionStyle = (action: Photo['action'], buttonAction: Photo['action']) => {
    if (action === buttonAction) {
      switch (buttonAction) {
        case 'delete':
          return 'bg-red-600 border-red-400'
        case 'save':
          return 'bg-green-600 border-green-400'
        case 'mint':
          return 'bg-purple-600 border-purple-400'
        default:
          return 'bg-gray-800/80 border-gray-600'
      }
    }
    return 'bg-gray-800/80 border-gray-600'
  }

  const renderItem = useCallback(
    ({ item, index }: { item: Photo; index: number }) => (
      <View style={{ width: screenWidth, height: screenHeight }}>
        <Image
          source={{ uri: item.uri }}
          style={{ width: screenWidth, height: screenHeight }}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent']}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 120,
          }}
        />

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 280,
          }}
        />

        {item.action !== 'pending' && (
          <View
            className={`absolute top-20 right-6 px-4 py-2 rounded-full ${
              item.action === 'mint'
                ? 'bg-purple-600'
                : item.action === 'save'
                ? 'bg-green-600'
                : 'bg-red-600'
            }`}
          >
            <Text className="text-white font-bold capitalize">{item.action}</Text>
          </View>
        )}
      </View>
    ),
    []
  )

  if (photos.length === 0) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <StatusBar barStyle="light-content" />
        <Text className="text-gray-400 text-lg">No photos to review</Text>
        <Pressable onPress={handleBack} className="mt-4 px-6 py-3 bg-purple-600 rounded-xl">
          <Text className="text-white font-bold">Back to Camera</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-black">
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

      <View className="absolute top-12 left-0 right-0 flex-row items-center justify-between px-6">
        <Pressable onPress={handleBack} className="p-2">
          <Text className="text-white text-2xl">←</Text>
        </Pressable>

        <Text className="text-white text-lg font-medium">
          {currentIndex + 1} of {photos.length}
        </Text>

        <Pressable onPress={handleViewAll} className="px-4 py-2 bg-gray-800/80 rounded-full">
          <Text className="text-white font-medium">View All</Text>
        </Pressable>
      </View>

      <View className="absolute bottom-0 left-0 right-0 pb-12 px-6">
        {allMarked ? (
          <View className="items-center">
            <View className="flex-row gap-4 mb-4">
              <View className="items-center">
                <Text className="text-purple-400 text-2xl font-bold">{mintCount}</Text>
                <Text className="text-gray-400 text-sm">Mint</Text>
              </View>
              <View className="items-center">
                <Text className="text-green-400 text-2xl font-bold">
                  {photos.filter((p) => p.action === 'save').length}
                </Text>
                <Text className="text-gray-400 text-sm">Save</Text>
              </View>
            </View>

            <Pressable
              onPress={handleProceedToMint}
              disabled={mintCount === 0}
              className={`w-full py-4 rounded-xl items-center ${
                mintCount > 0 ? 'bg-purple-600' : 'bg-gray-700'
              }`}
            >
              <Text className="text-white font-bold text-lg">
                {mintCount > 0 ? `Proceed to Mint (${mintCount})` : 'No Photos to Mint'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="flex-row justify-center mb-4">
              <View className="bg-gray-800/60 px-4 py-2 rounded-full">
                <Text className="text-gray-300 text-sm">
                  {pendingCount} photo{pendingCount !== 1 ? 's' : ''} remaining
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => handleAction('delete')}
                disabled={isProcessing}
                className={`flex-1 py-4 rounded-xl items-center border-2 ${getActionStyle(
                  currentPhoto?.action ?? 'pending',
                  'delete'
                )}`}
              >
                <Text className="text-white font-bold text-lg">🗑️ Delete</Text>
              </Pressable>

              <Pressable
                onPress={() => handleAction('save')}
                disabled={isProcessing}
                className={`flex-1 py-4 rounded-xl items-center border-2 ${getActionStyle(
                  currentPhoto?.action ?? 'pending',
                  'save'
                )}`}
              >
                <Text className="text-white font-bold text-lg">💾 Save</Text>
              </Pressable>

              <Pressable
                onPress={() => handleAction('mint')}
                disabled={isProcessing}
                className={`flex-1 py-4 rounded-xl items-center border-2 ${getActionStyle(
                  currentPhoto?.action ?? 'pending',
                  'mint'
                )}`}
              >
                <Text className="text-white font-bold text-lg">💎 Mint</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  )
}

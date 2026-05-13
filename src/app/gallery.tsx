import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  Dimensions,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as MediaLibrary from 'expo-media-library'
import { File } from 'expo-file-system'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore, Photo } from '../store/photos'

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 48) / 3

export default function GalleryScreen() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const photos = usePhotoStore((state) => state.photos)
  const setAction = usePhotoStore((state) => state.setAction)
  const setBulkAction = usePhotoStore((state) => state.setBulkAction)
  const removePhoto = usePhotoStore((state) => state.removePhoto)
  const removeBulkPhotos = usePhotoStore((state) => state.removeBulkPhotos)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isProcessing, setIsProcessing] = useState(false)

  const photosForMint = useMemo(
    () => photos.filter((p) => p.action === 'mint'),
    [photos]
  )

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
    setSelectedIds(new Set(photos.map((p) => p.id)))
  }, [photos])

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
          setBulkAction(ids, action)
          Alert.alert('Marked', `${ids.length} photo(s) marked for ${action}`)
        }
      } catch (error) {
        console.error('Bulk action failed:', error)
        Alert.alert('Error', 'Failed to complete bulk action')
      } finally {
        setIsProcessing(false)
        exitSelectMode()
      }
    },
    [selectedIds, photos, setBulkAction, removeBulkPhotos, setAction, saveToGallery, exitSelectMode]
  )

  const handlePhotoPress = useCallback(
    (photo: Photo) => {
      if (selectMode) {
        toggleSelect(photo.id)
      } else {
        const index = photos.findIndex((p) => p.id === photo.id)
        router.push(`/review?startIndex=${index}`)
      }
    },
    [selectMode, toggleSelect, photos, router]
  )

  const handleProceedToMint = useCallback(() => {
    if (photosForMint.length === 0) {
      Alert.alert(
        'No Photos Selected',
        'Please mark at least one photo for minting.'
      )
      return
    }
    if (!account) {
      Alert.alert(
        'Wallet Required',
        'Connect your Solana wallet to mint NFTs.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Connect', onPress: () => connect() },
        ]
      )
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

  const getActionIcon = (action: Photo['action']) => {
    switch (action) {
      case 'mint':
        return '💎'
      case 'save':
        return '💾'
      case 'delete':
        return '🗑️'
      default:
        return ''
    }
  }

  const getActionColor = (action: Photo['action']) => {
    switch (action) {
      case 'mint':
        return 'bg-purple-600'
      case 'save':
        return 'bg-green-600'
      case 'delete':
        return 'bg-red-600'
      default:
        return 'bg-gray-600'
    }
  }

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
          className="m-1 rounded-lg overflow-hidden"
          style={{ width: ITEM_SIZE, height: ITEM_SIZE }}
        >
          <Image
            source={{ uri: item.uri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />

          {selectMode && (
            <View
              className={`absolute top-1 left-1 w-7 h-7 rounded-full items-center justify-center border-2 ${
                isSelected ? 'bg-purple-600 border-purple-400' : 'bg-black/40 border-white/60'
              }`}
            >
              {isSelected && <Text className="text-white text-sm">✓</Text>}
            </View>
          )}

          {!selectMode && item.action !== 'pending' && (
            <View
              className={`absolute top-1 right-1 w-7 h-7 rounded-full items-center justify-center ${getActionColor(item.action)}`}
            >
              <Text className="text-sm">{getActionIcon(item.action)}</Text>
            </View>
          )}
        </Pressable>
      )
    },
    [selectMode, selectedIds, handlePhotoPress, toggleSelect]
  )

  const pendingCount = photos.filter((p) => p.action === 'pending').length
  const mintCount = photosForMint.length
  const saveCount = photos.filter((p) => p.action === 'save').length
  const deleteCount = photos.filter((p) => p.action === 'delete').length

  return (
    <View className="flex-1 bg-black">
      {/* Header */}
      <View className="pt-12 pb-4 px-6 flex-row items-center justify-between border-b border-gray-800">
        <Pressable onPress={handleBack} className="p-2">
          <Text className="text-white text-2xl">{selectMode ? '✕' : '←'}</Text>
        </Pressable>

        <Text className="text-white text-xl font-bold">
          {selectMode ? `${selectedIds.size} Selected` : 'All Photos'}
        </Text>

        {selectMode ? (
          <Pressable
            onPress={selectedIds.size === photos.length ? deselectAll : selectAll}
            className="p-2"
          >
            <Text className="text-purple-400 font-medium">
              {selectedIds.size === photos.length ? 'None' : 'All'}
            </Text>
          </Pressable>
        ) : (
          <View className="flex-row items-center gap-1">
            <Pressable onPress={() => router.push('/past-mints')} className="p-2">
              <Text className="text-gray-400 text-sm">History</Text>
            </Pressable>
            <Pressable onPress={() => setSelectMode(true)} className="p-2">
              <Text className="text-purple-400 font-medium">Select</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Stats - only in normal mode */}
      {!selectMode && (
        <View className="flex-row justify-center py-4 gap-4 border-b border-gray-800">
          <View className="items-center">
            <Text className="text-gray-400 text-xs">Pending</Text>
            <Text className="text-white text-lg font-bold">{pendingCount}</Text>
          </View>
          <View className="items-center">
            <Text className="text-purple-400 text-xs">Mint</Text>
            <Text className="text-purple-400 text-lg font-bold">{mintCount}</Text>
          </View>
          <View className="items-center">
            <Text className="text-green-400 text-xs">Save</Text>
            <Text className="text-green-400 text-lg font-bold">{saveCount}</Text>
          </View>
          <View className="items-center">
            <Text className="text-red-400 text-xs">Delete</Text>
            <Text className="text-red-400 text-lg font-bold">{deleteCount}</Text>
          </View>
        </View>
      )}

      {/* Photo Grid */}
      {photos.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-400 text-lg">No photos yet</Text>
          <Text className="text-gray-500 text-sm mt-2">
            Go back to camera to take some photos
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          renderItem={renderPhoto}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={{ padding: 12 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Bottom Action */}
      {photos.length > 0 && (
        <View className="p-6 border-t border-gray-800">
          {selectMode ? (
            <View>
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => handleBulkAction('delete')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  className={`flex-1 py-3 rounded-xl items-center ${
                    selectedIds.size > 0 ? 'bg-red-600' : 'bg-gray-700'
                  }`}
                >
                  <Text className="text-white font-bold">🗑️ Delete</Text>
                </Pressable>

                <Pressable
                  onPress={() => handleBulkAction('save')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  className={`flex-1 py-3 rounded-xl items-center ${
                    selectedIds.size > 0 ? 'bg-green-600' : 'bg-gray-700'
                  }`}
                >
                  <Text className="text-white font-bold">💾 Save</Text>
                </Pressable>

                <Pressable
                  onPress={() => handleBulkAction('mint')}
                  disabled={selectedIds.size === 0 || isProcessing}
                  className={`flex-1 py-3 rounded-xl items-center ${
                    selectedIds.size > 0 ? 'bg-purple-600' : 'bg-gray-700'
                  }`}
                >
                  <Text className="text-white font-bold">💎 Mint</Text>
                </Pressable>
              </View>
              <Text className="text-gray-400 text-center text-sm mt-2">
                Long press any photo to start selecting
              </Text>
            </View>
          ) : (
            <View>
              <Pressable
                onPress={handleProceedToMint}
                disabled={pendingCount > 0 || mintCount === 0}
                className={`py-4 rounded-xl items-center ${
                  pendingCount > 0 || mintCount === 0 ? 'bg-gray-700' : 'bg-purple-600'
                }`}
              >
                <Text className="text-white font-bold text-lg">
                  {pendingCount > 0
                    ? `Review remaining (${pendingCount} pending)`
                    : mintCount > 0
                    ? `Proceed to Mint (${mintCount} photos)`
                    : 'No photos to mint'}
                </Text>
              </Pressable>
              {pendingCount > 0 && (
                <Text className="text-gray-400 text-center text-sm mt-2">
                  Long press to select multiple photos
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

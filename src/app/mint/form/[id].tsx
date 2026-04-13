import { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  Image,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../../../store/photos'
import { useMintQueue } from '../../../store/mintQueue'

export default function MintFormScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { account, connect } = useMobileWallet()

  const photos = usePhotoStore((state) => state.photos)
  const photo = useMemo(() => photos.find((p) => p.id === id), [photos, id])

  const addToQueue = useMintQueue((state) => state.addToQueue)

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleMint = useCallback(async () => {
    if (!photo) return

    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your NFT.')
      return
    }

    if (!artist.trim()) {
      Alert.alert('Missing Artist', 'Please enter the artist name.')
      return
    }

    if (!account) {
      Alert.alert(
        'Wallet Required',
        'Please connect your wallet to mint NFTs.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Connect', onPress: connect },
        ]
      )
      return
    }

    setIsSubmitting(true)
    try {
      addToQueue({
        photoId: photo.id,
        photoUri: photo.uri,
        title: title.trim(),
        artist: artist.trim(),
        capturedAt: photo.capturedAt,
      })

      router.back()
    } catch (error) {
      console.error('Failed to add to mint queue:', error)
      Alert.alert('Error', 'Failed to queue NFT for minting.')
    } finally {
      setIsSubmitting(false)
    }
  }, [photo, title, artist, account, connect, addToQueue, router])

  const handleBack = useCallback(() => {
    router.back()
  }, [router])

  if (!photo) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <Text className="text-white text-xl">Photo not found</Text>
        <Pressable onPress={() => router.back()} className="mt-4 p-4">
          <Text className="text-purple-400 text-lg">Go Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-black"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="pt-12 pb-4 px-6 flex-row items-center justify-between">
          <Pressable onPress={handleBack} className="p-2">
            <Text className="text-white text-2xl">←</Text>
          </Pressable>
          <Text className="text-white text-xl font-bold">Mint NFT</Text>
          <View className="w-10" />
        </View>

        {/* Image Preview */}
        <View className="px-6 mb-6">
          <Image
            source={{ uri: photo.uri }}
            className="w-full aspect-square rounded-xl"
            resizeMode="cover"
          />
        </View>

        {/* Metadata Form */}
        <View className="px-6 gap-4">
          {/* Title */}
          <View>
            <Text className="text-gray-400 text-sm mb-2">Title *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter NFT title"
              placeholderTextColor="#6B7280"
              className="bg-gray-900 text-white px-4 py-3 rounded-xl text-lg"
              maxLength={50}
            />
          </View>

          {/* Artist */}
          <View>
            <Text className="text-gray-400 text-sm mb-2">Artist *</Text>
            <TextInput
              value={artist}
              onChangeText={setArtist}
              placeholder="Enter artist name"
              placeholderTextColor="#6B7280"
              className="bg-gray-900 text-white px-4 py-3 rounded-xl text-lg"
              maxLength={50}
            />
          </View>

          {/* Shot on Seeker Badge */}
          <View className="bg-gray-900 px-4 py-3 rounded-xl flex-row items-center">
            <Text className="text-purple-400 text-lg mr-2">📱</Text>
            <Text className="text-gray-300">Shot on Seeker</Text>
            <Text className="text-gray-500 ml-auto text-sm">Auto-added</Text>
          </View>

          {/* Wallet Status */}
          <View className="bg-gray-900 px-4 py-3 rounded-xl">
            <Text className="text-gray-400 text-sm mb-1">Wallet</Text>
            {account ? (
              <Text className="text-green-400">
                {account.address.toString().slice(0, 8)}...
                {account.address.toString().slice(-8)}
              </Text>
            ) : (
              <Pressable onPress={connect}>
                <Text className="text-purple-400">Tap to connect wallet</Text>
              </Pressable>
            )}
          </View>

          {/* Estimated Cost */}
          <View className="bg-gray-900 px-4 py-3 rounded-xl">
            <Text className="text-gray-400 text-sm mb-1">Estimated Cost</Text>
            <Text className="text-white text-lg">~0.01 SOL</Text>
            <Text className="text-gray-500 text-xs mt-1">
              Includes IPFS upload + on-chain mint
            </Text>
          </View>
        </View>

        {/* Mint Button */}
        <View className="p-6">
          <Pressable
            onPress={handleMint}
            disabled={isSubmitting || !account}
            className={`py-4 rounded-xl items-center ${
              isSubmitting || !account ? 'bg-gray-700' : 'bg-purple-600'
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">
                {account ? '💎 Add to Mint Queue' : 'Connect Wallet First'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

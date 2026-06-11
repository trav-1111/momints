import { useState, useEffect, useCallback } from 'react'
import { View, Text, Pressable, Image, ScrollView, ActivityIndicator, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../../store/photos'
import { useMintQueue } from '../../store/mintQueue'
import { useMint } from '../../hooks/useMint'
import { getSolscanUrl } from '../../services/mint'

type MintStatus = 'pending' | 'uploading' | 'signing' | 'confirming' | 'success' | 'failed'

interface MintProgress {
  photoId: string
  status: MintStatus
  txSignature?: string
  error?: string
}

export default function MintProgressScreen() {
  const router = useRouter()
  const { account } = useMobileWallet()

  const setAction = usePhotoStore((state) => state.setAction)
  const getPhotosForMint = usePhotoStore((state) => state.getPhotosForMint)

  const queue = useMintQueue((state) => state.queue)
  const clearQueue = useMintQueue((state) => state.clearQueue)
  const removeFromQueue = useMintQueue((state) => state.removeFromQueue)
  const addToHistory = useMintQueue((state) => state.addToHistory)

  const [progress, setProgress] = useState<MintProgress[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  const photosToMint = getPhotosForMint()

  useEffect(() => {
    const initialProgress: MintProgress[] = photosToMint.map((photo) => ({
      photoId: photo.id,
      status: 'pending',
    }))
    setProgress(initialProgress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateProgress = useCallback((photoId: string, update: Partial<MintProgress>) => {
    setProgress((prev) => prev.map((p) => (p.photoId === photoId ? { ...p, ...update } : p)))
  }, [])

  const { mint } = useMint()

  const processNextMint = useCallback(async () => {
    if (currentIndex >= photosToMint.length || !account) return

    const photo = photosToMint[currentIndex]
    const queueItem = queue.find((q) => q.photoId === photo.id)

    if (!queueItem) {
      router.push(`/mint/form/${photo.id}`)
      return
    }

    setIsProcessing(true)
    updateProgress(photo.id, { status: 'uploading' })

    try {
      const result = await mint({
        photoUri: photo.uri,
        title: queueItem.title,
        artist: queueItem.artist,
        capturedAt: queueItem.capturedAt,
        rollContext: queueItem.rollContext,
        captureMeta: queueItem.captureMeta,
        onMintPhase: (phase) => {
          if (phase === 'signing') updateProgress(photo.id, { status: 'signing' })
          if (phase === 'confirming') updateProgress(photo.id, { status: 'confirming' })
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Minting failed')
      }

      updateProgress(photo.id, { status: 'success', txSignature: result.signature })

      if (result.signature) {
        addToHistory({
          id: photo.id,
          photoUri: photo.uri,
          title: queueItem.title,
          artist: queueItem.artist,
          txSignature: result.signature,
          mintAddress: result.mintAddress,
          mintedAt: Date.now(),
        })
      }

      setAction(photo.id, 'mint')
      removeFromQueue(photo.id)

      setCurrentIndex((prev) => prev + 1)
    } catch (error) {
      console.error('Mint failed:', error)
      updateProgress(photo.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsProcessing(false)
    }
  }, [currentIndex, photosToMint, account, queue, updateProgress, setAction, removeFromQueue, router, mint])

  const handleRetry = useCallback(
    (photoId: string) => {
      const index = progress.findIndex((p) => p.photoId === photoId)
      if (index !== -1) {
        setCurrentIndex(index)
        updateProgress(photoId, { status: 'pending', error: undefined })
      }
    },
    [progress, updateProgress],
  )

  const handleViewOnSolscan = useCallback((signature: string) => {
    Linking.openURL(getSolscanUrl(signature))
  }, [])

  const handleFinish = useCallback(() => {
    clearQueue()
    router.replace('/camera')
  }, [clearQueue, router])

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

  const getStatusText = (status: MintStatus) => {
    switch (status) {
      case 'pending':
        return 'Waiting...'
      case 'uploading':
        return 'Uploading to IPFS...'
      case 'signing':
        return 'Sign in your wallet...'
      case 'confirming':
        return 'Confirming on-chain...'
      case 'success':
        return 'Minted successfully!'
      case 'failed':
        return 'Failed'
      default:
        return ''
    }
  }

  const getStatusColor = (status: MintStatus) => {
    switch (status) {
      case 'success':
        return 'text-green-400'
      case 'failed':
        return 'text-red-400'
      case 'pending':
        return 'text-gray-400'
      default:
        return 'text-purple-400'
    }
  }

  return (
    <View className="flex-1 bg-black">
      {/* Header */}
      <View className="pt-12 pb-4 px-6 flex-row items-center justify-between border-b border-gray-800">
        <Pressable onPress={handleBack} className="p-2">
          <Text className="text-white text-2xl">←</Text>
        </Pressable>
        <Text className="text-white text-xl font-bold">Minting Progress</Text>
        <View className="w-10" />
      </View>

      {/* Progress Summary */}
      <View className="px-6 py-4 flex-row justify-center gap-6 border-b border-gray-800">
        <View className="items-center">
          <Text className="text-green-400 text-2xl font-bold">{successCount}</Text>
          <Text className="text-gray-400 text-xs">Success</Text>
        </View>
        <View className="items-center">
          <Text className="text-red-400 text-2xl font-bold">{failedCount}</Text>
          <Text className="text-gray-400 text-xs">Failed</Text>
        </View>
        <View className="items-center">
          <Text className="text-gray-400 text-2xl font-bold">{pendingCount}</Text>
          <Text className="text-gray-400 text-xs">Pending</Text>
        </View>
      </View>

      {/* Mint List */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {progress.map((item, index) => {
          const photo = photosToMint.find((p) => p.id === item.photoId)
          const queueItem = queue.find((q) => q.photoId === item.photoId)

          if (!photo) return null

          return (
            <View key={item.photoId} className="flex-row items-center p-4 border-b border-gray-800">
              <Image source={{ uri: photo.uri }} className="w-16 h-16 rounded-lg" resizeMode="cover" />
              <View className="flex-1 ml-4">
                <Text className="text-white font-medium">{queueItem?.title || `Photo ${index + 1}`}</Text>
                <Text className={`text-sm ${getStatusColor(item.status)}`}>{getStatusText(item.status)}</Text>
                {item.error && <Text className="text-red-400 text-xs mt-1">{item.error}</Text>}
              </View>
              <View className="items-end">
                {item.status === 'success' && item.txSignature && (
                  <Pressable
                    onPress={() => handleViewOnSolscan(item.txSignature!)}
                    className="bg-purple-600/30 px-3 py-1 rounded-full"
                  >
                    <Text className="text-purple-400 text-sm">View</Text>
                  </Pressable>
                )}
                {item.status === 'failed' && (
                  <Pressable onPress={() => handleRetry(item.photoId)} className="bg-red-600/30 px-3 py-1 rounded-full">
                    <Text className="text-red-400 text-sm">Retry</Text>
                  </Pressable>
                )}
                {(item.status === 'uploading' || item.status === 'signing' || item.status === 'confirming') && (
                  <ActivityIndicator size="small" color="#8B5CF6" />
                )}
              </View>
            </View>
          )
        })}
      </ScrollView>

      {/* Action Button */}
      <View className="p-6 border-t border-gray-800">
        {allComplete ? (
          <Pressable onPress={handleFinish} className="py-4 bg-purple-600 rounded-xl items-center">
            <Text className="text-white font-bold text-lg">Return to Camera</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={processNextMint}
            disabled={isProcessing}
            className={`py-4 rounded-xl items-center ${isProcessing ? 'bg-gray-700' : 'bg-purple-600'}`}
          >
            {isProcessing ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="white" size="small" />
                <Text className="text-white font-bold text-lg">Processing...</Text>
              </View>
            ) : (
              <Text className="text-white font-bold text-lg">
                {currentIndex === 0 ? 'Start Minting' : 'Continue Minting'}
              </Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  )
}

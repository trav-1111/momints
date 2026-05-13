import { useCallback } from 'react'
import { View, Text, Pressable, FlatList, Image, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMintQueue, MintHistoryItem } from '../store/mintQueue'
import { getSolscanUrl, getSolscanNftUrl } from '../services/mint'

export default function PastMintsScreen() {
  const router = useRouter()
  const mintHistory = useMintQueue((state) => state.mintHistory)
  const clearHistory = useMintQueue((state) => state.clearHistory)

  const handleViewTx = useCallback((signature: string) => {
    Linking.openURL(getSolscanUrl(signature))
  }, [])

  const handleViewNft = useCallback((mintAddress: string) => {
    Linking.openURL(getSolscanNftUrl(mintAddress))
  }, [])

  const handleClearHistory = useCallback(() => {
    Alert.alert('Clear History', 'Remove all past mints from this list? This does not affect on-chain data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearHistory },
    ])
  }, [clearHistory])

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const renderItem = useCallback(
    ({ item }: { item: MintHistoryItem }) => (
      <View className="flex-row items-center p-4 border-b border-gray-800">
        <Image
          source={{ uri: item.photoUri }}
          style={{ width: 56, height: 56, borderRadius: 8 }}
          resizeMode="cover"
        />
        <View className="flex-1 ml-3">
          <Text className="text-white font-medium" numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="text-gray-400 text-xs mt-0.5">{item.artist}</Text>
          <Text className="text-gray-500 text-xs mt-0.5">{formatDate(item.mintedAt)}</Text>
        </View>
        <View className="items-end gap-1">
          {item.mintAddress && (
            <Pressable
              onPress={() => handleViewNft(item.mintAddress!)}
              className="bg-purple-600/30 px-3 py-1 rounded-full"
            >
              <Text className="text-purple-400 text-xs">NFT</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => handleViewTx(item.txSignature)}
            className="bg-gray-800 px-3 py-1 rounded-full"
          >
            <Text className="text-gray-300 text-xs">TX</Text>
          </Pressable>
        </View>
      </View>
    ),
    [handleViewTx, handleViewNft]
  )

  return (
    <View className="flex-1 bg-black">
      <View className="pt-12 pb-4 px-6 flex-row items-center justify-between border-b border-gray-800">
        <Pressable onPress={() => router.back()} className="p-2">
          <Text className="text-white text-2xl">←</Text>
        </Pressable>
        <Text className="text-white text-xl font-bold">Past Mints</Text>
        {mintHistory.length > 0 ? (
          <Pressable onPress={handleClearHistory} className="p-2">
            <Text className="text-red-400 text-sm">Clear</Text>
          </Pressable>
        ) : (
          <View className="w-10" />
        )}
      </View>

      {mintHistory.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-400 text-lg">No mints yet</Text>
          <Text className="text-gray-500 text-sm mt-2">Your minted NFTs will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={mintHistory}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

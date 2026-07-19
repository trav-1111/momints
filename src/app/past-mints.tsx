import { useCallback } from 'react'
import { View, Text, Pressable, FlatList, Image, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMintQueue, MintHistoryItem } from '../store/mintQueue'
import { getSolscanUrl, getSolscanNftUrl } from '../services/mint'
import { colors, fonts } from '../theme'
import { IconBack } from '../components/icons'

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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          borderRadius: 14,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 10,
        }}
      >
        <Image source={{ uri: item.photoUri }} style={{ width: 52, height: 52, borderRadius: 9 }} resizeMode="cover" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.text }}>
            {item.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textSecondary, marginTop: 2 }}
          >
            {item.artist}
          </Text>
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
            {formatDate(item.mintedAt)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {item.mintAddress && (
            <Pressable
              onPress={() => handleViewNft(item.mintAddress!)}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: colors.accentTint,
                borderWidth: 1,
                borderColor: colors.accent,
              }}
            >
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.accentSoft }}>NFT</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => handleViewTx(item.txSignature)}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft }}>TX</Text>
          </Pressable>
        </View>
      </View>
    ),
    [handleViewTx, handleViewNft],
  )

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
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <IconBack size={21} color={colors.text} strokeWidth={1.7} />
          </Pressable>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: colors.text }}>Past Mints</Text>
        </View>
        {mintHistory.length > 0 ? (
          <Pressable onPress={handleClearHistory} hitSlop={8}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.redSoft }}>CLEAR</Text>
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {mintHistory.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary }}>No mints yet</Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: 8 }}>
            Your minted NFTs will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={mintHistory}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

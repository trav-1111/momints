import { useCallback, useState } from 'react'
import { View, Text, Pressable, FlatList, Linking, Alert } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useMintQueue, MintHistoryItem } from '../store/mintQueue'
import { drainPendingFinalizes } from '../store/quickFinalize'
import { getSolscanUrl, getSolscanNftUrl } from '../services/mint'
import { reconcileActiveRollFrames } from '../services/rollReconciliation'
import { colors, fonts } from '../theme'
import { IconBack } from '../components/icons'

export default function PastMintsScreen() {
  const router = useRouter()
  const { account } = useMobileWallet()
  const mintHistory = useMintQueue((state) => state.mintHistory)
  const clearHistory = useMintQueue((state) => state.clearHistory)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage('Checking permanent mint status…')
    try {
      const [roll, quick] = await Promise.all([
        reconcileActiveRollFrames(account?.address?.toString() ?? null),
        drainPendingFinalizes(),
      ])
      const updated = roll.added + quick.finalized
      if (updated > 0) {
        setRefreshMessage(`${updated} minted ${updated === 1 ? 'image' : 'images'} added to history.`)
      } else if (roll.issues.length > 0) {
        setRefreshMessage(roll.issues[0])
      } else if (roll.state === 'awaiting-wallet') {
        setRefreshMessage('Frames are synced. Connect the roll wallet to verify and release the encrypted copy.')
      } else if (roll.state === 'pending') {
        setRefreshMessage(
          roll.reconciled === roll.expected
            ? 'Frames are synced. Independent roll verification is still finishing.'
            : `Roll finalizing — ${roll.reconciled} of ${roll.expected} frames are ready.`,
        )
      } else {
        setRefreshMessage('History is up to date.')
      }
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : 'Mint status could not be refreshed.')
    } finally {
      setRefreshing(false)
    }
  }, [account, refreshing])

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

  const formatDate = (ts: string) => {
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
        <Image
          source={{ uri: item.imageUri }}
          cachePolicy={'none'}
          contentFit={'cover'}
          style={{ width: 52, height: 52, borderRadius: 9 }}
        />
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
            onPress={() => handleViewTx(item.transactionSignature)}
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

      {refreshMessage && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            paddingHorizontal: 22,
            paddingBottom: 10,
            fontFamily: fonts.mono,
            fontSize: 10.5,
            color: colors.textSecondary,
          }}
        >
          {refreshMessage}
        </Text>
      )}
      <FlatList
        data={mintHistory}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingBottom: 26,
          ...(mintHistory.length === 0 ? { flexGrow: 1 } : null),
        }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.textSecondary }}>No mints yet</Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: 8 }}>
              Pull down to check permanent mint status
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

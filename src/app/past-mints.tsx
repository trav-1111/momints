import { useCallback, useState, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  FlatList,
  Linking,
  Alert,
  Share,
  ActivityIndicator,
  RefreshControl,
  ViewStyle,
} from 'react-native'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useMintQueue } from '../store/mintQueue'
import { drainPendingFinalizes } from '../store/quickFinalize'
import { getSolscanUrl, getSolscanNftUrl } from '../services/mint'
import { reconcileActiveRollFrames } from '../services/rollReconciliation'
import { fetchUserOnChainMints, mergeMintPortfolio, type UserMintAsset } from '../services/onChainPortfolio'
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'
import { colors, fonts, tracking } from '../theme'
import { IconBack, IconFilm, IconGallery } from '../components/icons'

type FilterType = 'ALL' | 'ROLLS' | 'QUICK'

const chip: ViewStyle = {
  backgroundColor: colors.chipBg,
  borderWidth: 1,
  borderColor: colors.chipBorder,
}

export default function PastMintsScreen() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const mintHistory = useMintQueue((state) => state.mintHistory)
  const clearHistory = useMintQueue((state) => state.clearHistory)

  const [onChainMints, setOnChainMints] = useState<UserMintAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterType>('ALL')

  // Load on-chain portfolio & reconcile local state
  const loadPortfolio = useCallback(
    async (isPullToRefresh = false) => {
      if (!walletAddress) {
        setOnChainMints([])
        return
      }

      if (isPullToRefresh) {
        setRefreshing(true)
        setRefreshMessage('Syncing on-chain photography portfolio…')
      } else {
        setLoading(true)
      }

      try {
        const [dasResult, roll, quick] = await Promise.all([
          fetchUserOnChainMints(walletAddress, { forceRefresh: true }),
          reconcileActiveRollFrames(walletAddress),
          drainPendingFinalizes(),
        ])

        setOnChainMints(dasResult.items)

        const localNew = roll.added + quick.finalized
        if (localNew > 0) {
          setRefreshMessage(`${localNew} newly verified ${localNew === 1 ? 'frame' : 'frames'} added to portfolio.`)
        } else if (dasResult.items.length > 0) {
          setRefreshMessage(`Loaded ${dasResult.items.length} permanent on-chain moments.`)
        } else if (roll.issues.length > 0) {
          setRefreshMessage(roll.issues[0])
        } else {
          setRefreshMessage(null)
        }
      } catch (error) {
        setRefreshMessage(error instanceof Error ? error.message : 'Could not refresh portfolio from chain.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [walletAddress],
  )

  const handleRefresh = useCallback(async () => {
    await loadPortfolio(true)
  }, [loadPortfolio])

  useFocusEffect(
    useCallback(() => {
      void loadPortfolio(false)
    }, [loadPortfolio]),
  )

  // Merge on-chain assets with local pending history
  const mergedItems = useMemo(() => {
    return mergeMintPortfolio(onChainMints, mintHistory)
  }, [onChainMints, mintHistory])

  // Filter items by category
  const filteredItems = useMemo(() => {
    if (activeFilter === 'ROLLS') {
      return mergedItems.filter((i) => Boolean(i.rollName || i.frameNumber))
    }
    if (activeFilter === 'QUICK') {
      return mergedItems.filter((i) => !i.rollName && !i.frameNumber)
    }
    return mergedItems
  }, [mergedItems, activeFilter])

  const handleViewTx = useCallback((signature?: string) => {
    if (!signature) return
    Linking.openURL(getSolscanUrl(signature))
  }, [])

  const handleViewNft = useCallback((mintAddress: string) => {
    Linking.openURL(getSolscanNftUrl(mintAddress))
  }, [])

  const handleShare = useCallback(async (item: UserMintAsset) => {
    const shareUrl = item.arweaveUri || item.imageUri
    const message = `${item.name} — permanent photographic moment on Solana Seeker\n${shareUrl}`
    try {
      await Share.share({ message, url: shareUrl })
    } catch {
      // User cancelled share
    }
  }, [])

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      'Clear Local Cache',
      'Remove cached local history items? Your on-chain minted NFTs remain permanent on Solana.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearHistory()
            void loadPortfolio(true)
          },
        },
      ],
    )
  }, [clearHistory, loadPortfolio])

  const formatDate = (ts: string) => {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts || 'Date unavailable'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const renderItem = useCallback(
    ({ item }: { item: UserMintAsset }) => (
      <View
        style={{
          borderRadius: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 14,
          overflow: 'hidden',
        }}
      >
        {/* Top: Photo & Info */}
        <View style={{ flexDirection: 'row', padding: 13, gap: 14 }}>
          {/* High-res Image Thumbnail */}
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: '#0a0a0f',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            {item.imageUri ? (
              <Image
                source={{ uri: item.imageUri }}
                cachePolicy="memory-disk"
                contentFit="cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <IconGallery size={24} color={colors.textMuted} />
              </View>
            )}
          </View>

          {/* Details */}
          <View style={{ flex: 1, justifyContent: 'center', minWidth: 0 }}>
            {/* Badges row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
              {item.filmStock && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: colors.accentTint,
                    borderWidth: 1,
                    borderColor: colors.accent,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.monoBold,
                      fontSize: 8.5,
                      letterSpacing: tracking(0.08, 8.5),
                      color: colors.accentSoft,
                    }}
                  >
                    {item.filmStock.toUpperCase()}
                  </Text>
                </View>
              )}

              {item.rollName && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.12)',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 8.5,
                      color: colors.textSecondary,
                    }}
                  >
                    {item.frameNumber ? `FRAME ${item.frameNumber}` : 'ROLL'}
                  </Text>
                </View>
              )}

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 5,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: item.source === 'chain' ? 'rgba(58,208,122,0.1)' : 'rgba(250,204,21,0.1)',
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: item.source === 'chain' ? colors.green : colors.yellow,
                  }}
                />
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 8,
                    color: item.source === 'chain' ? colors.greenSoft : colors.yellow,
                  }}
                >
                  {item.source === 'chain' ? 'ON-CHAIN' : 'LOCAL'}
                </Text>
              </View>
            </View>

            {/* Title */}
            <Text numberOfLines={1} style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>
              {item.name}
            </Text>

            {/* Subtitle / Metadata */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>
                {formatDate(item.mintedAt)}
              </Text>
              {item.artist && (
                <>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>·</Text>
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontFamily: fonts.sans, fontSize: 11, color: colors.textSecondary }}
                  >
                    {item.artist}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Bottom Actions Row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: 'rgba(20,21,30,0.6)',
          }}
        >
          {item.id && (
            <Pressable
              onPress={() => handleViewNft(item.id)}
              accessibilityRole="button"
              accessibilityLabel="View NFT on Solscan"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: colors.accentTint,
                borderWidth: 1,
                borderColor: colors.accent,
              }}
            >
              <Text style={{ fontFamily: fonts.monoBold, fontSize: 9.5, color: colors.accentSoft }}>NFT</Text>
            </Pressable>
          )}

          {item.transactionSignature && (
            <Pressable
              onPress={() => handleViewTx(item.transactionSignature)}
              accessibilityRole="button"
              accessibilityLabel="View Transaction on Solscan"
              style={{
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textSoft }}>TX</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => void handleShare(item)}
            accessibilityRole="button"
            accessibilityLabel="Share permanent photo link"
            style={{
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textSecondary }}>SHARE</Text>
          </Pressable>
        </View>
      </View>
    ),
    [handleViewNft, handleViewTx, handleShare],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top Header */}
      <View
        style={{
          paddingTop: 54,
          paddingBottom: 16,
          paddingHorizontal: 22,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back to camera"
          >
            <IconBack size={22} color={colors.text} strokeWidth={1.8} />
          </Pressable>
          <View>
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 19, color: colors.text }}>Past Mints</Text>
            {walletAddress ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }} />
                <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSecondary }}>
                  {formatWalletDisplay(walletAddress, domain)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* Total Counter Badge */}
          {mergedItems.length > 0 && (
            <View
              style={[
                chip,
                {
                  paddingVertical: 5,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: fonts.monoBold,
                  fontSize: 10,
                  letterSpacing: tracking(0.08, 10),
                  color: colors.textSoft,
                }}
              >
                {`${mergedItems.length} ${mergedItems.length === 1 ? 'MOMINT' : 'MOMINTS'}`}
              </Text>
            </View>
          )}

          {mintHistory.length > 0 && (
            <Pressable onPress={handleClearHistory} hitSlop={8}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.redSoft }}>CLEAR</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Filter Chips Row */}
      {mergedItems.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 22,
            paddingBottom: 14,
          }}
        >
          {(['ALL', 'ROLLS', 'QUICK'] as const).map((filter) => {
            const isSelected = activeFilter === filter
            return (
              <Pressable
                key={filter}
                onPress={() => setActiveFilter(filter)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: isSelected ? colors.accentTint : colors.surface,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.accent : colors.border,
                }}
              >
                <Text
                  style={{
                    fontFamily: isSelected ? fonts.monoBold : fonts.mono,
                    fontSize: 10,
                    letterSpacing: tracking(0.08, 10),
                    color: isSelected ? colors.accentSoft : colors.textMuted,
                  }}
                >
                  {filter}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {/* Status banner */}
      {refreshMessage && (
        <View
          style={{
            marginHorizontal: 22,
            marginBottom: 12,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              color: colors.textSecondary,
            }}
          >
            {refreshMessage}
          </Text>
        </View>
      )}

      {/* Main Content List */}
      {loading && mergedItems.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accentSoft} size="small" />
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 12 }}>
            Querying Solana DAS portfolio…
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accentSoft}
              colors={[colors.accent]}
            />
          }
          contentContainerStyle={{
            paddingHorizontal: 22,
            paddingBottom: 32,
            ...(filteredItems.length === 0 ? { flexGrow: 1 } : null),
          }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              {!walletAddress ? (
                <>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <IconFilm size={26} color={colors.textSecondary} />
                  </View>
                  <Text
                    style={{
                      fontFamily: fonts.sansBold,
                      fontSize: 16,
                      color: colors.text,
                      textAlign: 'center',
                    }}
                  >
                    Wallet Disconnected
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.sans,
                      fontSize: 13,
                      lineHeight: 18,
                      color: colors.textMuted,
                      textAlign: 'center',
                      marginTop: 8,
                      marginBottom: 20,
                    }}
                  >
                    Connect your wallet to browse your collection of minted film exposures.
                  </Text>
                  <Pressable
                    onPress={connect}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 20,
                      borderRadius: 999,
                      backgroundColor: colors.accent,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.white }}>
                      CONNECT WALLET
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <IconFilm size={26} color={colors.textSecondary} />
                  </View>
                  <Text
                    style={{
                      fontFamily: fonts.sansBold,
                      fontSize: 16,
                      color: colors.text,
                      textAlign: 'center',
                    }}
                  >
                    No minted moments yet
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.sans,
                      fontSize: 13,
                      lineHeight: 18,
                      color: colors.textMuted,
                      textAlign: 'center',
                      marginTop: 8,
                      marginBottom: 20,
                    }}
                  >
                    Load a roll of film and capture your first frame!
                  </Text>
                  <Pressable
                    onPress={() => router.push('/camera')}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 20,
                      borderRadius: 999,
                      backgroundColor: colors.accentTint,
                      borderWidth: 1,
                      borderColor: colors.accent,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.accentSoft }}>
                      SHOOT NOW
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

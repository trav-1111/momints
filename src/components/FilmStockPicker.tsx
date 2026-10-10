import { Image } from 'expo-image'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  FILMSTOCK_ENGINE_VERSION,
  currentlyStocked,
  isFilmStockDownloaded,
  type FilmStockCatalogueItem,
} from '../services/filmstocks'
import {
  authoritativeFilmStockTime,
  hasRecentCatalogue,
  quickEligible,
  rollEligible,
  unlockedIds,
  useFilmStockStore,
} from '../store/filmstocks'
import { colors, fonts, tracking } from '../theme'

interface Props {
  purpose: 'roll' | 'quick'
  selectedId: string
  onSelect: (stock: FilmStockCatalogueItem) => void
}

function formatAvailabilityWindow(
  stock: FilmStockCatalogueItem,
  now: number,
): { text: string; isClosingSoon: boolean } | null {
  if (stock.evergreen) return null
  if (!stock.availableUntil) return { text: 'LIMITED DROP', isClosingSoon: false }
  const remainingDays = Math.ceil((Date.parse(stock.availableUntil) - now) / 86_400_000)
  if (remainingDays <= 0) return { text: 'VAULTED • SEASON CLOSED', isClosingSoon: false }
  const dateStr = new Date(stock.availableUntil)
    .toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    .toUpperCase()
  if (remainingDays <= 7) {
    return { text: `DROP ACTIVE • CLOSES IN ${remainingDays}D (${dateStr})`, isClosingSoon: true }
  }
  return { text: `DROP ACTIVE • CLOSES IN ${remainingDays}D (${dateStr})`, isClosingSoon: false }
}

function FilmCard({
  stock,
  selected,
  locked,
  isUnlocked,
  serverTimeMs,
  purpose,
  onPress,
  favourite,
  onToggleFavourite,
}: {
  stock: FilmStockCatalogueItem
  selected: boolean
  locked?: boolean
  isUnlocked?: boolean
  serverTimeMs: number
  purpose: 'roll' | 'quick'
  onPress: () => void
  favourite: boolean
  onToggleFavourite: () => void
}) {
  const isStocked = currentlyStocked(stock, serverTimeMs)
  const windowInfo = formatAvailabilityWindow(stock, serverTimeMs)
  const downloaded = isFilmStockDownloaded(stock.filmStockId)
  const incompatible = stock.minimumEngineVersion > FILMSTOCK_ENGINE_VERSION
  const image = stock.previewImageUrls[0]

  // Status pill badge styling
  let statusBadge: { label: string; bg: string; border: string; color: string }
  if (stock.evergreen) {
    statusBadge = {
      label: 'HOUSE STOCK',
      bg: 'rgba(255,255,255,0.06)',
      border: colors.border,
      color: colors.textMuted,
    }
  } else if (isUnlocked) {
    statusBadge = {
      label: 'COLLECTED ✓',
      bg: 'rgba(58,208,122,0.12)',
      border: 'rgba(58,208,122,0.4)',
      color: colors.green,
    }
  } else if (isStocked) {
    statusBadge = {
      label: 'COLLECTIBLE DROP',
      bg: 'rgba(250,204,21,0.14)',
      border: 'rgba(250,204,21,0.4)',
      color: colors.yellow,
    }
  } else {
    statusBadge = {
      label: 'VAULTED DROP',
      bg: 'rgba(255,255,255,0.04)',
      border: 'rgba(255,255,255,0.12)',
      color: colors.textMuted,
    }
  }

  const isVaultedLocked = !stock.evergreen && !isStocked && !isUnlocked
  const isQuickLocked = purpose === 'quick' && !stock.evergreen && !isUnlocked
  const isDisabled = Boolean(locked || incompatible || isVaultedLocked || isQuickLocked)

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: isDisabled }}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: selected ? colors.accent : !stock.evergreen && isStocked ? 'rgba(250,204,21,0.25)' : colors.border,
        backgroundColor: selected ? colors.accentTint : colors.surface,
        opacity: isDisabled ? 0.52 : 1,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', minHeight: 96 }}>
        {/* Preview Thumbnail */}
        <View
          style={{
            width: 86,
            backgroundColor: stock.baseMode === 'bw' ? '#c7c8ca' : '#403567',
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          {image ? <Image source={{ uri: image }} cachePolicy="memory" contentFit="cover" style={{ flex: 1 }} /> : null}
          <View
            style={{
              position: 'absolute',
              left: 7,
              bottom: 7,
              paddingHorizontal: 6,
              paddingVertical: 3,
              borderRadius: 4,
              backgroundColor: 'rgba(0,0,0,0.72)',
            }}
          >
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 8, color: colors.white }}>
              {stock.baseMode === 'bw' ? 'B&W' : 'C-41'}
            </Text>
          </View>
        </View>

        {/* Info Column */}
        <View style={{ flex: 1, paddingHorizontal: 13, paddingVertical: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ flex: 1, fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }} numberOfLines={1}>
              {stock.displayName}
            </Text>

            {/* Collectible / House Pill Badge */}
            <View
              style={{
                backgroundColor: statusBadge.bg,
                borderColor: statusBadge.border,
                borderWidth: 1,
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ fontFamily: fonts.monoBold, fontSize: 7.5, color: statusBadge.color }}>
                {statusBadge.label}
              </Text>
            </View>

            {selected ? (
              <Text style={{ fontFamily: fonts.monoBold, fontSize: 9, color: colors.accentSoft }}>LOADED</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                favourite ? `Remove ${stock.displayName} from favourites` : `Favourite ${stock.displayName}`
              }
              onPress={(event) => {
                event.stopPropagation()
                onToggleFavourite()
              }}
              hitSlop={10}
            >
              <Text
                style={{
                  fontFamily: fonts.sansBold,
                  fontSize: 16,
                  color: favourite ? colors.yellow : colors.textMuted,
                  marginLeft: 2,
                }}
              >
                {favourite ? '★' : '☆'}
              </Text>
            </Pressable>
          </View>

          {/* Availability Countdown / Scarcity info for collectibles */}
          {!stock.evergreen && (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text
                style={{
                  fontFamily: fonts.monoBold,
                  fontSize: 8.5,
                  color: isUnlocked ? colors.green : isStocked ? colors.yellow : colors.textMuted,
                }}
              >
                {isUnlocked
                  ? 'COLLECTED ON-CHAIN • PERMANENT ACCESS'
                  : windowInfo
                    ? windowInfo.text
                    : 'COLLECTIBLE RELEASE'}
              </Text>
            </View>
          )}

          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 11.5,
              lineHeight: 16,
              color: colors.textSecondary,
              marginTop: 4,
            }}
            numberOfLines={2}
          >
            {stock.shortDescription}
          </Text>

          {/* Status footer tag */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.textMuted }}>
              {incompatible
                ? 'UPDATE APP'
                : isVaultedLocked
                  ? 'VAULTED • SEASON CLOSED'
                  : isQuickLocked
                    ? 'LOAD A ROLL TO UNLOCK'
                    : downloaded
                      ? 'OFFLINE READY'
                      : 'DOWNLOAD ON LOAD'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 9,
          letterSpacing: tracking(0.16, 9),
          color: colors.textMuted,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  )
}

export function FilmStockPicker({ purpose, selectedId, onSelect }: Props) {
  const state = useFilmStockStore()
  const unlocked = unlockedIds(state)
  const authoritativeNow = authoritativeFilmStockTime(state)
  const catalogueIsRecent = hasRecentCatalogue(state)

  const [activeTab, setActiveTab] = useState<'all' | 'drops' | 'house'>('all')

  const { houseStocks, collectibleStocks } = useMemo(() => {
    const recentRank = (stock: FilmStockCatalogueItem) => {
      const index = state.recentlyUsed.indexOf(stock.filmStockId)
      return index < 0 ? Number.MAX_SAFE_INTEGER : index
    }
    const sortStocks = (a: FilmStockCatalogueItem, b: FilmStockCatalogueItem) => {
      const fav = Number(state.favourites.includes(b.filmStockId)) - Number(state.favourites.includes(a.filmStockId))
      return fav || recentRank(a) - recentRank(b) || a.displayName.localeCompare(b.displayName)
    }

    const house = state.catalogue.filter((stock) => stock.evergreen).sort(sortStocks)
    const collectible = state.catalogue.filter((stock) => !stock.evergreen).sort(sortStocks)

    return { houseStocks: house, collectibleStocks: collectible }
  }, [state.catalogue, state.recentlyUsed, state.favourites])

  const renderCard = (stock: FilmStockCatalogueItem, locked = false) => {
    const isUnlocked = unlocked.includes(stock.filmStockId)
    return (
      <FilmCard
        key={stock.filmStockId}
        stock={stock}
        selected={selectedId === stock.filmStockId}
        locked={locked}
        isUnlocked={isUnlocked}
        serverTimeMs={authoritativeNow}
        purpose={purpose}
        onPress={() => onSelect(stock)}
        favourite={state.favourites.includes(stock.filmStockId)}
        onToggleFavourite={() => state.toggleFavourite(stock.filmStockId)}
      />
    )
  }

  const showCollectibleSection = activeTab === 'all' || activeTab === 'drops'
  const showHouseSection = activeTab === 'all' || activeTab === 'house'

  return (
    <View>
      {/* Category Tabs */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {(
          [
            { id: 'all', label: 'ALL FILMS' },
            { id: 'drops', label: `COLLECTIBLE DROPS (${collectibleStocks.length})` },
            { id: 'house', label: `HOUSE STOCKS (${houseStocks.length})` },
          ] as const
        ).map((tab) => {
          const isTabActive = activeTab === tab.id
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 11,
                borderRadius: 999,
                backgroundColor: isTabActive ? colors.surface : 'transparent',
                borderWidth: 1,
                borderColor: isTabActive ? colors.accent : colors.border,
              }}
            >
              <Text
                style={{
                  fontFamily: isTabActive ? fonts.monoBold : fonts.mono,
                  fontSize: 9,
                  color: isTabActive ? colors.text : colors.textMuted,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* Collectible Ownership & Drop Explainer Callout */}
      {showCollectibleSection && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            backgroundColor: 'rgba(250,204,21,0.07)',
            borderWidth: 1,
            borderColor: 'rgba(250,204,21,0.22)',
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 14,
          }}
        >
          <Text style={{ fontSize: 13, color: colors.yellow, marginTop: 1 }}>✦</Text>
          <Text
            style={{
              flex: 1,
              fontFamily: fonts.sans,
              fontSize: 11,
              lineHeight: 15.5,
              color: colors.textSecondary,
            }}
          >
            Mint a roll to keep the filmstock before it’s gone.
          </Text>
        </View>
      )}

      {state.error ? (
        <Text style={{ fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, color: colors.yellow, marginBottom: 10 }}>
          Offline films only · Connect to refresh the shelf and missing recipes.
        </Text>
      ) : null}

      {/* Collectible Drops Section */}
      {showCollectibleSection && collectibleStocks.length > 0 && (
        <Section title="COLLECTIBLE DROPS · LIMITED SEASONS">
          {collectibleStocks.map((stock) => {
            const isUnlocked = unlocked.includes(stock.filmStockId)
            const isStocked = currentlyStocked(stock, authoritativeNow)
            const eligible = purpose === 'roll' ? rollEligible(stock, state) : quickEligible(stock, state)
            const locked = !eligible && !isUnlocked && (!isStocked || !catalogueIsRecent)
            return renderCard(stock, locked)
          })}
        </Section>
      )}

      {/* House Stocks Section */}
      {showHouseSection && houseStocks.length > 0 && (
        <Section title="HOUSE STOCKS · ALWAYS AVAILABLE">
          {houseStocks
            .filter((stock) => (purpose === 'roll' ? rollEligible(stock, state) : quickEligible(stock, state)))
            .map((stock) => renderCard(stock, false))}
        </Section>
      )}

      {purpose === 'roll' ? (
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: 11.5,
            lineHeight: 16,
            color: colors.textSecondary,
            marginBottom: 16,
          }}
        >
          Loaded rolls remain available to finish even after a film leaves the shelf.
        </Text>
      ) : null}
    </View>
  )
}

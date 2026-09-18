import { Image } from 'expo-image'
import { useMemo } from 'react'
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

function formatLeaving(iso: string | null, now: number): string | null {
  if (!iso) return null
  const remainingDays = Math.ceil((Date.parse(iso) - now) / 86_400_000)
  if (remainingDays < 0) return null
  if (remainingDays <= 7) return `LEAVING IN ${remainingDays}D`
  return `UNTIL ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase()}`
}

function FilmCard({
  stock,
  selected,
  locked,
  serverTimeMs,
  onPress,
  favourite,
  onToggleFavourite,
}: {
  stock: FilmStockCatalogueItem
  selected: boolean
  locked?: boolean
  serverTimeMs: number
  onPress: () => void
  favourite: boolean
  onToggleFavourite: () => void
}) {
  const leaving =
    !stock.evergreen && currentlyStocked(stock, serverTimeMs) ? formatLeaving(stock.availableUntil, serverTimeMs) : null
  const downloaded = isFilmStockDownloaded(stock.filmStockId)
  const incompatible = stock.minimumEngineVersion > FILMSTOCK_ENGINE_VERSION
  const image = stock.previewImageUrls[0]

  return (
    <Pressable
      onPress={onPress}
      disabled={locked || incompatible}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: Boolean(locked || incompatible) }}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentTint : colors.surface,
        opacity: locked || incompatible ? 0.55 : 1,
        marginBottom: 9,
      }}
    >
      <View style={{ flexDirection: 'row', minHeight: 92 }}>
        <View
          style={{
            width: 82,
            backgroundColor: stock.baseMode === 'bw' ? '#c7c8ca' : '#403567',
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          {image ? <Image source={{ uri: image }} cachePolicy="memory" contentFit="cover" style={{ flex: 1 }} /> : null}
          <View
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
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
        <View style={{ flex: 1, paddingHorizontal: 13, paddingVertical: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text style={{ flex: 1, fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>
              {stock.displayName}
            </Text>
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
                  fontSize: 17,
                  color: favourite ? colors.yellow : colors.textMuted,
                }}
              >
                {favourite ? '★' : '☆'}
              </Text>
            </Pressable>
          </View>
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 11.5,
              lineHeight: 16,
              color: colors.textSecondary,
              marginTop: 3,
            }}
          >
            {stock.shortDescription}
          </Text>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 7 }}>
            {leaving ? (
              <Text style={{ fontFamily: fonts.monoBold, fontSize: 8, color: colors.yellow }}>{leaving}</Text>
            ) : null}
            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.textMuted }}>
              {incompatible ? 'UPDATE APP' : downloaded ? 'OFFLINE' : locked ? 'LOAD A ROLL TO UNLOCK' : 'DOWNLOAD'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 13 }}>
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
  const sections = useMemo(() => {
    const recentRank = (stock: FilmStockCatalogueItem) => {
      const index = state.recentlyUsed.indexOf(stock.filmStockId)
      return index < 0 ? Number.MAX_SAFE_INTEGER : index
    }
    const sortCabinet = (a: FilmStockCatalogueItem, b: FilmStockCatalogueItem) => {
      const fav = Number(state.favourites.includes(b.filmStockId)) - Number(state.favourites.includes(a.filmStockId))
      return fav || recentRank(a) - recentRank(b) || a.displayName.localeCompare(b.displayName)
    }
    const house = state.catalogue.filter((stock) => stock.evergreen)
    const cabinet = state.catalogue
      .filter((stock) => !stock.evergreen && unlocked.includes(stock.filmStockId))
      .sort(sortCabinet)
    const shelf = state.catalogue.filter(
      (stock) =>
        catalogueIsRecent &&
        !stock.evergreen &&
        currentlyStocked(stock, authoritativeNow) &&
        !unlocked.includes(stock.filmStockId),
    )
    return { house, cabinet, shelf }
  }, [state.catalogue, state.recentlyUsed, state.favourites, unlocked, catalogueIsRecent, authoritativeNow])

  const render = (stock: FilmStockCatalogueItem, locked = false) => (
    <FilmCard
      key={stock.filmStockId}
      stock={stock}
      selected={selectedId === stock.filmStockId}
      locked={locked}
      serverTimeMs={authoritativeNow}
      onPress={() => onSelect(stock)}
      favourite={state.favourites.includes(stock.filmStockId)}
      onToggleFavourite={() => state.toggleFavourite(stock.filmStockId)}
    />
  )

  return (
    <View>
      {state.error ? (
        <Text style={{ fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, color: colors.yellow, marginBottom: 10 }}>
          Offline films only · Connect to refresh the shelf and missing recipes.
        </Text>
      ) : null}
      {purpose === 'roll' && sections.shelf.length > 0 ? (
        <Section title="ON THE SHELF">
          {sections.shelf.filter((stock) => rollEligible(stock, state)).map((stock) => render(stock))}
        </Section>
      ) : null}
      {sections.cabinet.length > 0 ? (
        <Section title="YOUR FILM CABINET">{sections.cabinet.map((stock) => render(stock))}</Section>
      ) : null}
      <Section title="HOUSE FILMS">
        {sections.house
          .filter((stock) => (purpose === 'roll' ? rollEligible(stock, state) : quickEligible(stock, state)))
          .map((stock) => render(stock))}
      </Section>
      {purpose === 'quick' && sections.shelf.length > 0 ? (
        <Section title="ON THE SHELF · ROLL ONLY">{sections.shelf.map((stock) => render(stock, true))}</Section>
      ) : null}
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

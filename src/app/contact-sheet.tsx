import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { Asset } from 'expo-asset'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconBack, IconCheck, IconFilm, IconGallery, IconSave } from '../components/icons'
import {
  renderContactSheet,
  type ContactSheetAspect,
  type ContactSheetFilm,
  type ContactSheetFrame,
  type ContactSheetRenderResult,
} from '../services/contactSheet'
import { useMintQueue, type MintFilmUsed, type MintHistoryItem } from '../store/mintQueue'
import { usePhotoStore } from '../store/photos'
import { useRollRegistry } from '../store/rollRegistry'
import { useSessionStore } from '../store/session'
import type { AspectRatio } from '../store/session'
import { colors, fonts, tracking } from '../theme'

type SelectionPath = 'roll' | 'quick'

interface SheetFrame extends ContactSheetFrame {
  order: number
  artist: string
  filmUsed: MintFilmUsed
  aspect?: AspectRatio
}

interface RollChoice {
  id: string
  name: string
  frames: SheetFrame[]
  expectedFrames: number
  mintedAt: number
  artist: string
  filmUsed: ContactSheetFilm
  aspect?: ContactSheetAspect
}

interface PreviewState {
  render: ContactSheetRenderResult
  artist: string
  date: string
  filmUsed: ContactSheetFilm
  aspect: ContactSheetAspect
}

const MIN_QUICK_MINTS = 6
const MAX_FRAMES = 24
const MOMINTS_LOGO = require('../../assets/adaptive-icon.png')
let logoUriPromise: Promise<string> | null = null

function uniqueOrMixed(values: string[], mixed: string): string {
  const unique = [...new Set(values.filter(Boolean))]
  if (unique.length === 0) return 'Unknown'
  return unique.length === 1 ? unique[0] : mixed
}

function filmFor(frames: SheetFrame[]): ContactSheetFilm {
  return uniqueOrMixed(
    frames.map((frame) => frame.filmUsed),
    'Mixed',
  ) as ContactSheetFilm
}

function generationDate(): string {
  return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function dateFromRollName(rollName: string, frames: SheetFrame[]): string {
  for (const value of [frames[0]?.name, rollName]) {
    const match = value?.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
  }
  return generationDate()
}

function aspectFor(frames: SheetFrame[]): ContactSheetAspect | undefined {
  if (frames.some((frame) => frame.aspect === undefined)) return undefined
  const labels = new Set(frames.map((frame) => (frame.aspect === 'full' ? 'Original' : frame.aspect)))
  return labels.size === 1 ? ([...labels][0] as ContactSheetAspect) : 'Mixed'
}

async function momintsLogoUri(): Promise<string> {
  if (!logoUriPromise) {
    logoUriPromise = Asset.loadAsync(MOMINTS_LOGO).then(([asset]) => asset.localUri ?? asset.uri)
  }
  return logoUriPromise
}

function asFrame(item: MintHistoryItem, order: number, filmUsed: MintFilmUsed, aspect?: AspectRatio): SheetFrame {
  return {
    imageUri: item.photoUri,
    name: item.title,
    order,
    artist: item.artist,
    filmUsed,
    aspect,
  }
}

function SelectionTick() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accent,
        borderWidth: 2,
        borderColor: colors.white,
      }}
    >
      <IconCheck size={14} color={colors.white} strokeWidth={2.5} />
    </View>
  )
}

export default function ContactSheetScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const mintHistory = useMintQueue((state) => state.mintHistory)
  const photos = usePhotoStore((state) => state.photos)
  const registry = useRollRegistry((state) => state.rolls)
  const activeRoll = useSessionStore((state) => state.activeRoll)

  const [path, setPath] = useState<SelectionPath | null>(null)
  const [selectedRollId, setSelectedRollId] = useState<string | null>(null)
  const [selectedQuickIds, setSelectedQuickIds] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos])
  const registryByCollection = useMemo(
    () => new Map(registry.map((roll) => [roll.collectionAddress, roll])),
    [registry],
  )
  const registryByName = useMemo(() => new Map(registry.map((roll) => [roll.name, roll])), [registry])

  const rollChoices = useMemo(() => {
    const groups = new Map<string, RollChoice>()
    const sortedHistory = [...mintHistory].sort((a, b) => a.mintedAt - b.mintedAt)

    for (const item of sortedHistory) {
      const photo = photoById.get(item.id)
      const rollId = item.rollContext?.rollId ?? photo?.rollId
      if (!rollId) continue

      const name = item.rollContext?.rollName ?? photo?.rollName ?? 'Roll'
      const registryRoll = item.rollContext?.collectionAddress
        ? registryByCollection.get(item.rollContext.collectionAddress)
        : registryByName.get(name)
      const activeFilm = activeRoll?.id === rollId ? activeRoll.film.mode : undefined
      const filmUsed = item.filmUsed ?? (registryRoll?.film === 'bw' || activeFilm === 'bw' ? 'B&W' : 'Color')
      const frameAspect =
        item.aspect ??
        photo?.aspect ??
        registryRoll?.aspect ??
        (activeRoll?.id === rollId ? activeRoll.aspect : undefined)
      const order = photo?.capturedAt ?? item.rollContext?.frameNumber ?? item.capturedAt ?? item.mintedAt
      const expectedFrames =
        item.rollContext?.totalFrames ?? photos.filter((candidate) => candidate.rollId === rollId).length
      const existing = groups.get(rollId) ?? {
        id: rollId,
        name,
        frames: [],
        expectedFrames,
        mintedAt: item.mintedAt,
        artist: item.artist,
        filmUsed,
        aspect: undefined,
      }
      existing.frames.push(asFrame(item, order, filmUsed, frameAspect))
      existing.expectedFrames = Math.max(existing.expectedFrames, expectedFrames, existing.frames.length)
      existing.mintedAt = Math.max(existing.mintedAt, item.mintedAt)
      groups.set(rollId, existing)
    }

    return [...groups.values()]
      .map((roll) => {
        const frames = [...roll.frames].sort((a, b) => a.order - b.order)
        return {
          ...roll,
          frames,
          artist: uniqueOrMixed(
            frames.map((frame) => frame.artist),
            'Various Artists',
          ),
          filmUsed: filmFor(frames),
          aspect: aspectFor(frames),
        }
      })
      .filter((roll) => roll.frames.length === roll.expectedFrames && roll.frames.length <= MAX_FRAMES)
      .sort((a, b) => b.mintedAt - a.mintedAt)
  }, [activeRoll, mintHistory, photoById, photos, registryByCollection, registryByName])

  const quickMintsInMintOrder = useMemo(
    () =>
      [...mintHistory]
        .filter((item) => !item.rollContext && !photoById.get(item.id)?.rollId)
        .sort((a, b) => a.mintedAt - b.mintedAt),
    [mintHistory, photoById],
  )
  const quickMintsForDisplay = useMemo(() => [...quickMintsInMintOrder].reverse(), [quickMintsInMintOrder])
  const selectedRoll = rollChoices.find((roll) => roll.id === selectedRollId)
  const quickCount = selectedQuickIds.size
  const quickCanGenerate = quickCount >= MIN_QUICK_MINTS && quickCount <= MAX_FRAMES
  const tileWidth = Math.floor((width - 36 - 16) / 3)

  const handleBack = useCallback(() => {
    if (preview) {
      setPreview(null)
    } else if (path) {
      setPath(null)
      setSelectedRollId(null)
      setSelectedQuickIds(new Set())
    } else {
      router.back()
    }
  }, [path, preview, router])

  const toggleQuickMint = useCallback((id: string) => {
    setSelectedQuickIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
        return next
      }
      if (next.size >= MAX_FRAMES) {
        Alert.alert('24 frame maximum', 'Contact sheets can include up to 24 quick mints.')
        return current
      }
      next.add(id)
      return next
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    let frames: SheetFrame[] = []
    let title = 'Quick Shot Momints'
    let artist = 'Unknown'
    let filmUsed: ContactSheetFilm = 'Color'
    let aspect: ContactSheetAspect | undefined
    let date = generationDate()

    if (path === 'roll' && selectedRoll) {
      frames = selectedRoll.frames
      title = selectedRoll.name
      artist = selectedRoll.artist
      filmUsed = selectedRoll.filmUsed
      aspect = selectedRoll.aspect
      date = dateFromRollName(selectedRoll.name, frames)
    } else if (path === 'quick') {
      if (!quickCanGenerate) {
        Alert.alert('Choose 6–24 quick mints', 'Select at least 6 and no more than 24 minted shots.')
        return
      }
      frames = quickMintsInMintOrder
        .filter((item) => selectedQuickIds.has(item.id))
        .map((item, index) =>
          asFrame(item, index, item.filmUsed ?? 'Color', item.aspect ?? photoById.get(item.id)?.aspect),
        )
      artist = uniqueOrMixed(
        frames.map((frame) => frame.artist),
        'Various Artists',
      )
      filmUsed = filmFor(frames)
      aspect = aspectFor(frames)
    } else {
      return
    }

    setIsGenerating(true)
    try {
      const logoUri = await momintsLogoUri()
      const render = await renderContactSheet(frames, { title, artist, date, filmUsed, aspect, logoUri })
      setPreview({ render, artist, date, filmUsed, aspect: render.aspectUsed })
    } catch (error) {
      Alert.alert('Couldn’t create sheet', error instanceof Error ? error.message : 'The image could not be rendered.')
    } finally {
      setIsGenerating(false)
    }
  }, [path, photoById, quickCanGenerate, quickMintsInMintOrder, selectedQuickIds, selectedRoll])

  const handleShare = useCallback(async () => {
    if (!preview) return
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'Save the image to your photo library instead.')
        return
      }
      await Sharing.shareAsync(preview.render.uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share contact sheet',
        UTI: 'public.png',
      })
    } catch (error) {
      Alert.alert('Couldn’t share', error instanceof Error ? error.message : 'The share sheet could not be opened.')
    }
  }, [preview])

  const handleSave = useCallback(async () => {
    if (!preview || isSaving) return
    setIsSaving(true)
    try {
      const permission = await MediaLibrary.requestPermissionsAsync()
      if (permission.status !== 'granted') {
        Alert.alert('Photo access required', 'Allow photo-library access to save the contact sheet.')
        return
      }
      await MediaLibrary.saveToLibraryAsync(preview.render.uri)
      Alert.alert('Saved', 'The contact sheet was saved to your photo library.')
    } catch (error) {
      Alert.alert('Couldn’t save', error instanceof Error ? error.message : 'The image could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, preview])

  const footerLabel =
    path === 'quick'
      ? quickCount < MIN_QUICK_MINTS
        ? `Select ${MIN_QUICK_MINTS - quickCount} more`
        : `Generate with ${quickCount} frames`
      : selectedRoll
        ? `Generate ${selectedRoll.frames.length}-frame sheet`
        : 'Choose a roll'
  const generateEnabled = path === 'roll' ? Boolean(selectedRoll) : quickCanGenerate

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View
        style={{
          minHeight: 58,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <IconBack size={21} color={colors.text} strokeWidth={1.7} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.text }}>Contact Sheet</Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 9,
              letterSpacing: tracking(0.12, 9),
              color: colors.textMuted,
              marginTop: 2,
            }}
          >
            {preview ? 'PREVIEW' : path === 'roll' ? 'MINTED ROLL' : path === 'quick' ? 'QUICK MINTS' : 'NEW EXPORT'}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {preview ? (
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <View
            style={{
              padding: 10,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Image
              source={{ uri: preview.render.uri }}
              resizeMode="contain"
              style={{ width: '100%', aspectRatio: preview.render.width / preview.render.height, borderRadius: 9 }}
              accessibilityLabel={`Contact sheet preview with ${preview.render.frameCount} frames`}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.textMuted }}>ARTIST</Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: colors.text, marginTop: 3 }}
              >
                {preview.artist}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.textMuted }}>DATE · FILM · ASPECT</Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: colors.text, marginTop: 3 }}
              >
                {preview.date} · {preview.filmUsed} · {preview.aspect}
              </Text>
            </View>
          </View>
          <Text
            style={{ fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.textMuted, marginTop: 18 }}
          >
            Export only — this image is not minted and the stored frame images are not reprocessed.
          </Text>
        </ScrollView>
      ) : path === null ? (
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 28, paddingBottom: 30 }}>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 26, lineHeight: 31, color: colors.text }}>
            Make a sheet from your minted frames.
          </Text>
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              lineHeight: 21,
              color: colors.textSecondary,
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            Choose a complete roll or hand-pick 6–24 quick mints. The result is a shareable image, never an NFT.
          </Text>

          {[
            {
              key: 'roll' as const,
              title: 'Minted roll',
              copy: 'Use every frame in its original roll order.',
              detail: `${rollChoices.length} available`,
              icon: <IconFilm size={22} color={colors.accentSoft} />,
            },
            {
              key: 'quick' as const,
              title: 'Quick mints',
              copy: 'Choose 6–24 shots. The sheet keeps mint order.',
              detail: `${quickMintsInMintOrder.length} available · mixed stocks label as Mixed`,
              icon: <IconGallery size={22} color={colors.accentSoft} />,
            },
          ].map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setPath(option.key)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 132,
                padding: 18,
                borderRadius: 18,
                backgroundColor: pressed ? colors.accentTint : colors.surface,
                borderWidth: 1,
                borderColor: pressed ? colors.accent : colors.border,
                marginBottom: 14,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accentTint,
                  }}
                >
                  {option.icon}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: colors.text }}>{option.title}</Text>
                  <Text
                    style={{
                      fontFamily: fonts.sans,
                      fontSize: 13,
                      lineHeight: 19,
                      color: colors.textSecondary,
                      marginTop: 3,
                    }}
                  >
                    {option.copy}
                  </Text>
                </View>
              </View>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, marginTop: 16 }}>
                {option.detail.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : path === 'roll' ? (
        <FlatList
          data={rollChoices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 18, paddingBottom: 118 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>Choose a roll</Text>
              <Text
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 13,
                  lineHeight: 19,
                  color: colors.textSecondary,
                  marginTop: 5,
                }}
              >
                Every minted frame is included in frame order.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 64 }}>
              <IconFilm size={28} color={colors.textMuted} />
              <Text
                style={{ fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.textSecondary, marginTop: 14 }}
              >
                No complete minted rolls yet
              </Text>
              <Text
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  color: colors.textMuted,
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                Finish minting a roll and it will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const selected = item.id === selectedRollId
            return (
              <Pressable
                onPress={() => setSelectedRollId(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: pressed || selected ? colors.accentTint : colors.surface,
                  borderWidth: selected ? 1.5 : 1,
                  borderColor: selected ? colors.accent : colors.border,
                  marginBottom: 12,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.sansBold, fontSize: 15, color: colors.text }}>
                      {item.name}
                    </Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.textMuted, marginTop: 3 }}>
                      {item.frames.length} FRAMES · {item.filmUsed.toUpperCase()} ·{' '}
                      {(item.aspect ?? 'FROM IMAGE').toUpperCase()}
                    </Text>
                  </View>
                  {selected && (
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: colors.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <IconCheck size={15} color={colors.white} strokeWidth={2.5} />
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {item.frames.slice(0, 5).map((frame) => (
                    <Image
                      key={`${item.id}-${frame.order}`}
                      source={{ uri: frame.imageUri }}
                      style={{ flex: 1, aspectRatio: 1, borderRadius: 7, backgroundColor: colors.bg }}
                      resizeMode="cover"
                    />
                  ))}
                </View>
              </Pressable>
            )
          }}
        />
      ) : (
        <FlatList
          data={quickMintsForDisplay}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 118 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ paddingTop: 18, paddingBottom: 16 }}>
              <Text style={{ fontFamily: fonts.sansBold, fontSize: 22, color: colors.text }}>Choose quick mints</Text>
              <Text
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 13,
                  lineHeight: 19,
                  color: colors.textSecondary,
                  marginTop: 5,
                }}
              >
                Select 6–24. Output order follows mint time, oldest to newest.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={{ width: width - 36, alignItems: 'center', paddingVertical: 64 }}>
              <IconGallery size={28} color={colors.textMuted} />
              <Text
                style={{ fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.textSecondary, marginTop: 14 }}
              >
                No minted quick shots yet
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const selected = selectedQuickIds.has(item.id)
            return (
              <Pressable
                onPress={() => toggleQuickMint(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${item.title}, minted quick shot`}
                style={({ pressed }) => ({ width: tileWidth, marginBottom: 13, opacity: pressed ? 0.72 : 1 })}
              >
                <View
                  style={{
                    width: tileWidth,
                    height: tileWidth,
                    borderRadius: 10,
                    overflow: 'hidden',
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Image source={{ uri: item.photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  {selected && <SelectionTick />}
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 9.5,
                    color: selected ? colors.text : colors.textSecondary,
                    marginTop: 6,
                  }}
                >
                  {item.title}
                </Text>
              </Pressable>
            )
          }}
        />
      )}

      {preview ? (
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 14),
            flexDirection: 'row',
            gap: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 50,
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed || isSaving ? 0.7 : 1,
            })}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <IconSave size={17} color={colors.text} />
            )}
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: colors.text }}>Save</Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 50,
              flex: 1.45,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: colors.white }}>Share image</Text>
          </Pressable>
        </View>
      ) : path ? (
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 14),
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <Pressable
            onPress={handleGenerate}
            disabled={!generateEnabled || isGenerating}
            accessibilityRole="button"
            accessibilityState={{ disabled: !generateEnabled || isGenerating }}
            style={({ pressed }) => ({
              minHeight: 50,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              backgroundColor: generateEnabled ? colors.accent : colors.surface,
              borderWidth: 1,
              borderColor: generateEnabled ? colors.accent : colors.border,
              opacity: pressed || isGenerating ? 0.72 : 1,
            })}
          >
            {isGenerating ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <ActivityIndicator size="small" color={colors.white} />
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: colors.white }}>Rendering image…</Text>
              </View>
            ) : (
              <Text
                style={{
                  fontFamily: fonts.sansBold,
                  fontSize: 13,
                  color: generateEnabled ? colors.white : colors.textMuted,
                }}
              >
                {footerLabel}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

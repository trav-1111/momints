import { useState, useCallback, useEffect } from 'react'
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSessionStore } from '../store/session'
import type { AppMode, AspectRatio } from '../store/session'
import { useWalletDomain } from '../hooks/useWalletDomain'
import { useCreateRoll, SKR_UNAVAILABLE_MESSAGE, type CreateRollPhase } from '../hooks/useCreateRoll'
import { useMintRoll } from '../hooks/useMintRoll'
import { useRollActions } from '../hooks/useRollActions'
import { PREPAID_ROLL_SIZES, getRollFeeLamports, formatSol, type PrepaidRollSize } from '../config/roll'
import { formatSkr } from '../config/skr'
import { isWorkerRollEnabled } from '../config/rollApi'
import {
  completeWorkerRoll,
  ensureWorkerRollAuthorization,
  getOpenWorkerRoll,
  getWorkerFees,
  type OpenRollSummary,
} from '../services/rollApi'
import { isSkrQuoteUnavailable, quoteSkrFee } from '../services/skrApi'
import { ARTIST_NAME_MAX_LENGTH } from '../services/rollIdentity'
import { colors, fonts, tracking } from '../theme'
import { IconCamera, IconFilm } from '../components/icons'
import { FilmStockPicker } from '../components/FilmStockPicker'
import { DEFAULT_COLOR_FILM_ID, ensureFilmStockRecipe, type FilmStockCatalogueItem } from '../services/filmstocks'
import { quickEligible, useFilmStockStore } from '../store/filmstocks'

const CREATE_PHASE_LABEL: Record<CreateRollPhase, string> = {
  cover: 'Rendering cover…',
  uploading: 'Uploading cover…',
  signing: 'Sign in your wallet…',
  confirming: 'Confirming on-chain…',
  creating: 'Creating roll…',
}
const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
]

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 10,
        letterSpacing: tracking(0.16, 10),
        color: colors.textMuted,
        marginBottom: 9,
      }}
    >
      {children}
    </Text>
  )
}

interface PillProps {
  label: string
  selected: boolean
  onPress: () => void
  mono?: boolean
}

function Pill({ label, selected, onPress, mono = false }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: selected ? colors.accent : 'transparent',
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
      }}
    >
      <Text
        style={{
          fontFamily: mono ? (selected ? fonts.monoBold : fonts.mono) : selected ? fonts.sansBold : fonts.sans,
          fontSize: mono ? 13 : 12,
          color: selected ? colors.white : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export default function ModeSelectScreen() {
  const router = useRouter()
  const selectQuickMode = useSessionStore((s) => s.selectQuickMode)
  const resumeRoll = useSessionStore((s) => s.resumeRoll)
  const activeRoll = useSessionStore((s) => s.activeRoll)

  const { account, connect, signMessage } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)
  const { createRoll, phase, error: createError, isCreating } = useCreateRoll()
  const { mintRoll } = useMintRoll()
  const { discardRoll } = useRollActions()

  const [selectedMode, setSelectedMode] = useState<AppMode>('quick')
  const [artist, setArtist] = useState('')
  const [rollSize, setRollSize] = useState<PrepaidRollSize>(12)
  const [rollFilmStockId, setRollFilmStockId] = useState(DEFAULT_COLOR_FILM_ID)
  const [aspect, setAspect] = useState<AspectRatio>('full')
  const filmState = useFilmStockStore()

  const selectFilm = useCallback(async (stock: FilmStockCatalogueItem, purpose: 'roll' | 'quick') => {
    try {
      await ensureFilmStockRecipe(stock)
      if (purpose === 'roll') setRollFilmStockId(stock.filmStockId)
      else useFilmStockStore.getState().selectQuickFilm(stock.filmStockId)
    } catch (err) {
      Alert.alert('Film unavailable', err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Prefill artist from the resolved SKR handle as soon as it lands — the
  // field stays editable (vanity name); provenance uses the handle itself.
  useEffect(() => {
    if (domain) {
      setArtist((prev) => (prev ? prev : domain))
    }
  }, [domain])

  // One roll at a time — while a roll is in progress you can't start a new one.
  const hasRoll = activeRoll !== null

  const handleResumeRoll = useCallback(() => {
    if (!activeRoll) return
    resumeRoll()
    // A fully shot roll has nothing left to shoot — it goes straight to the
    // mint queue instead of back to the camera.
    if (activeRoll.developed) {
      mintRoll()
      return
    }
    router.replace('/camera')
  }, [activeRoll, resumeRoll, mintRoll, router])

  const handleDiscardRoll = useCallback(() => {
    if (!activeRoll) return
    Alert.alert(
      'Discard roll',
      `Delete "${activeRoll.name}" and its ${activeRoll.frameIds.length} frame(s) without minting?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void discardRoll()
          },
        },
      ],
    )
  }, [activeRoll, discardRoll])

  // A roll the backend still has open that this device knows nothing about —
  // e.g. its frames were minted but the roll never reached its purchased size,
  // or the app's session was cleared. It silently blocks every new roll, so
  // surface it with a way out.
  const [strandedRoll, setStrandedRoll] = useState<OpenRollSummary | null>(null)
  const [isClosingStranded, setIsClosingStranded] = useState(false)

  const refreshStrandedRoll = useCallback(async () => {
    if (!isWorkerRollEnabled() || !walletAddress) {
      setStrandedRoll(null)
      return
    }
    try {
      const open = await getOpenWorkerRoll(walletAddress)
      setStrandedRoll(open && open.collectionAddress !== activeRoll?.collectionAddress ? open : null)
    } catch {
      // Offline or backend down — nothing actionable to show.
      setStrandedRoll(null)
    }
  }, [walletAddress, activeRoll?.collectionAddress])

  useEffect(() => {
    refreshStrandedRoll()
  }, [refreshStrandedRoll])

  // Roll fees are cost-plus and recompute every 3h (worker/src/fees/compute.ts)
  // — fetched here so what's shown before paying tracks the same number
  // payRollFee will actually pay (it re-fetches at that moment too). Falls
  // back to the static constants below while this is in flight or if the
  // Worker is unreachable; never blocks the screen on it.
  const [liveRollFees, setLiveRollFees] = useState<{ rollFee12Lamports: number; rollFee24Lamports: number } | null>(
    null,
  )
  useEffect(() => {
    if (!isWorkerRollEnabled()) return
    let cancelled = false
    getWorkerFees()
      .then((fees) => {
        if (!cancelled) setLiveRollFees(fees)
      })
      .catch(() => {
        // Offline or backend down — the static fallback below still renders a fee.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const rollFeeLamports = liveRollFees
    ? rollSize === 12
      ? liveRollFees.rollFee12Lamports
      : liveRollFees.rollFee24Lamports
    : getRollFeeLamports(rollSize)

  // "Pay with $SKR" — this quote is DISPLAY ONLY. paySkrRollFee re-quotes
  // fresh at the moment of actual payment (see its own doc comment), so an
  // expired display quote here is never a correctness problem, only a stale
  // number on screen until the next fetch below lands.
  const [payWithSkr, setPayWithSkr] = useState(false)
  const [skrQuoteAmount, setSkrQuoteAmount] = useState<number | null>(null)
  const [skrUnavailableMessage, setSkrUnavailableMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!payWithSkr || !walletAddress) {
      setSkrQuoteAmount(null)
      return
    }
    let cancelled = false
    setSkrQuoteAmount(null)
    quoteSkrFee({ context: 'roll', wallet: walletAddress, size: rollSize })
      .then((result) => {
        if (cancelled) return
        if (isSkrQuoteUnavailable(result)) {
          setSkrUnavailableMessage(SKR_UNAVAILABLE_MESSAGE)
          setPayWithSkr(false)
          return
        }
        setSkrQuoteAmount(result.skrAmount)
      })
      .catch(() => {
        if (!cancelled) {
          setSkrUnavailableMessage(SKR_UNAVAILABLE_MESSAGE)
          setPayWithSkr(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [payWithSkr, walletAddress, rollSize])

  const handleFinishStranded = useCallback(async () => {
    if (!strandedRoll || isClosingStranded) return
    setIsClosingStranded(true)
    try {
      if (!walletAddress) throw new Error('Connect the roll wallet first.')
      await ensureWorkerRollAuthorization(strandedRoll.collectionAddress, walletAddress, signMessage)
      await completeWorkerRoll(strandedRoll.collectionAddress)
      setStrandedRoll(null)
    } catch (err) {
      Alert.alert('Could not finish roll', err instanceof Error ? err.message : String(err))
    } finally {
      setIsClosingStranded(false)
    }
  }, [strandedRoll, isClosingStranded, walletAddress, signMessage])

  const handleLoadCamera = useCallback(async () => {
    if (selectedMode === 'quick') {
      const currentFilmState = useFilmStockStore.getState()
      const stock = currentFilmState.catalogue.find((item) => item.filmStockId === currentFilmState.quickFilmStockId)
      if (!stock || !quickEligible(stock, currentFilmState)) {
        Alert.alert('Choose a film', 'Choose a House film or an unlocked film from your cabinet.')
        return
      }
      try {
        await ensureFilmStockRecipe(stock)
      } catch (err) {
        Alert.alert('Film unavailable', err instanceof Error ? err.message : String(err))
        return
      }
      selectQuickMode()
      router.replace('/camera')
      return
    }

    if (isCreating) return
    if (!account) {
      Alert.alert('Wallet Required', 'Connect your Solana wallet to pay for and create a roll.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Connect', onPress: () => connect() },
      ])
      return
    }

    const stock = useFilmStockStore.getState().catalogue.find((item) => item.filmStockId === rollFilmStockId)
    if (!stock) {
      Alert.alert('Choose a film', 'Refresh the Film Shelf and choose a stock before loading this roll.')
      return
    }
    const created = await createRoll({
      size: rollSize,
      artist,
      skrHandle: domain,
      film: { mode: stock.baseMode, filmStockId: stock.filmStockId },
      aspect,
      payment: payWithSkr && skrQuoteAmount !== null ? 'SKR' : 'SOL',
    })
    if (created) router.replace('/camera')
  }, [
    selectedMode,
    isCreating,
    account,
    connect,
    createRoll,
    rollSize,
    artist,
    domain,
    rollFilmStockId,
    aspect,
    payWithSkr,
    skrQuoteAmount,
    selectQuickMode,
    router,
  ])

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 52, paddingBottom: 40 }}
    >
      {/* Eyebrow + title */}
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 11,
          letterSpacing: tracking(0.24, 11),
          color: colors.accent,
          marginBottom: 10,
        }}
      >
        MOMINTS
      </Text>
      <Text
        style={{
          fontFamily: fonts.sansBold,
          fontSize: 26,
          letterSpacing: tracking(-0.02, 26),
          color: colors.text,
          marginBottom: 4,
        }}
      >
        Choose your mode
      </Text>
      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginBottom: 18 }}>
        Shoot freely, or load a roll and develop it.
      </Text>

      {/* Roll in progress — resume it (one roll at a time) */}
      {hasRoll && activeRoll && (
        <View style={{ marginBottom: 16 }}>
          <Pressable
            onPress={handleResumeRoll}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                backgroundColor: colors.accentTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconFilm size={17} color={colors.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.text }}>
                {activeRoll.name}
              </Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textSecondary }}>
                {activeRoll.frameIds.length} / {activeRoll.size} exposures
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.accent }}>
              {activeRoll.developed ? 'MINT →' : 'RESUME →'}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 }}>
            <Pressable
              onPress={handleDiscardRoll}
              hitSlop={8}
              style={{ paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.redSoft }}>
                Discard roll
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Unfinished roll held open by the backend but absent from this device —
          blocks new rolls until it's closed. */}
      {strandedRoll && (
        <View
          style={{
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.yellow,
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.yellow,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconFilm size={17} color={colors.yellow} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.text }}>
                {strandedRoll.name}
              </Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textSecondary }}>
                {strandedRoll.mintedCount} / {strandedRoll.size} minted · not on this device
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: fonts.sans, fontSize: 11.5, color: colors.textSecondary, marginTop: 10 }}>
            This roll is still open and blocks new ones. Finishing it keeps every frame already minted.
          </Text>
          <Pressable
            onPress={handleFinishStranded}
            disabled={isClosingStranded}
            style={{
              marginTop: 12,
              paddingVertical: 11,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: isClosingStranded ? colors.surface : colors.yellow,
              borderWidth: 1,
              borderColor: colors.yellow,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.monoBold,
                fontSize: 11,
                letterSpacing: tracking(0.08, 11),
                color: isClosingStranded ? colors.textMuted : colors.bg,
              }}
            >
              {isClosingStranded ? 'FINISHING…' : 'FINISH ROLL'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Mode cards */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
        <Pressable
          onPress={() => setSelectedMode('quick')}
          style={{
            flex: 1,
            padding: 16,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: selectedMode === 'quick' ? colors.accentTint : colors.surface,
            borderWidth: 1,
            borderColor: selectedMode === 'quick' ? colors.accent : colors.border,
          }}
        >
          {selectedMode === 'quick' && (
            <View
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.accent,
              }}
            />
          )}
          <View style={{ marginBottom: 26 }}>
            <IconCamera size={22} color={selectedMode === 'quick' ? colors.text : colors.textSecondary} />
          </View>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>Quick Mint</Text>
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 11.5,
              lineHeight: 16,
              color: selectedMode === 'quick' ? colors.textSoft : colors.textSecondary,
            }}
          >
            Individual shots
          </Text>
        </Pressable>

        <Pressable
          onPress={() => !hasRoll && setSelectedMode('roll')}
          disabled={hasRoll}
          style={{
            flex: 1,
            padding: 16,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: selectedMode === 'roll' ? colors.accentTint : colors.surface,
            borderWidth: 1,
            borderColor: selectedMode === 'roll' ? colors.accent : colors.border,
            opacity: hasRoll ? 0.4 : 1,
          }}
        >
          {selectedMode === 'roll' && (
            <View
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.accent,
              }}
            />
          )}
          <View style={{ marginBottom: 26 }}>
            <IconFilm size={22} color={selectedMode === 'roll' ? colors.text : colors.textSecondary} />
          </View>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>New Roll</Text>
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: 11.5,
              lineHeight: 16,
              color: selectedMode === 'roll' ? colors.textSoft : colors.textSecondary,
            }}
          >
            {hasRoll ? 'Finish current roll first' : 'Shoot & develop'}
          </Text>
        </Pressable>
      </View>

      {/* Roll options — revealed when New Roll is selected */}
      {selectedMode === 'quick' && (
        <View style={{ marginTop: 20 }}>
          <FieldLabel>QUICK SHOOT FILM</FieldLabel>
          <FilmStockPicker
            purpose="quick"
            selectedId={filmState.quickFilmStockId}
            onSelect={(stock) => void selectFilm(stock, 'quick')}
          />
        </View>
      )}

      {selectedMode === 'roll' && !hasRoll && (
        <View>
          <FieldLabel>EXPOSURES</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {PREPAID_ROLL_SIZES.map((size) => (
              <Pill
                key={size}
                label={String(size)}
                mono
                selected={rollSize === size}
                onPress={() => setRollSize(size)}
              />
            ))}
          </View>

          <FieldLabel>ARTIST NAME</FieldLabel>
          <TextInput
            value={artist}
            onChangeText={setArtist}
            placeholder={domain ?? 'Shown on the roll & every frame'}
            placeholderTextColor={colors.textMuted}
            maxLength={ARTIST_NAME_MAX_LENGTH}
            returnKeyType="done"
            style={{
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 11,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              fontFamily: fonts.sans,
              fontSize: 14,
              color: colors.text,
              marginBottom: 16,
            }}
          />

          <FieldLabel>FILM</FieldLabel>
          <FilmStockPicker
            purpose="roll"
            selectedId={rollFilmStockId}
            onSelect={(stock) => void selectFilm(stock, 'roll')}
          />

          <FieldLabel>ASPECT RATIO</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {ASPECTS.map(({ value, label }) => (
              <Pill key={value} label={label} selected={aspect === value} onPress={() => setAspect(value)} />
            ))}
          </View>

          {/* Prepaid fee — one payment covers the whole roll */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 13,
              paddingHorizontal: 15,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.text }}>Roll fee</Text>
              <Text style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                Prepaid — covers {rollSize} frames + the roll cover
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 13, color: colors.accentSoft }}>
              {payWithSkr && skrQuoteAmount !== null ? formatSkr(skrQuoteAmount) : formatSol(rollFeeLamports)}
            </Text>
          </View>

          {/* Pay with $SKR — a 15% discount off the SOL fee, worker-quoted. */}
          <Pressable
            onPress={() => {
              setSkrUnavailableMessage(null)
              setPayWithSkr((v) => !v)
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 11,
              paddingHorizontal: 15,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: payWithSkr ? colors.accent : colors.border,
              marginTop: 10,
            }}
          >
            <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.text }}>Pay with $SKR</Text>
            {payWithSkr && skrQuoteAmount === null ? (
              <ActivityIndicator color={colors.accentSoft} size="small" />
            ) : (
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: payWithSkr ? colors.accent : 'transparent',
                  borderWidth: 1,
                  borderColor: payWithSkr ? colors.accent : colors.border,
                }}
              />
            )}
          </Pressable>

          {skrUnavailableMessage && (
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textSecondary, marginTop: 10 }}>
              {skrUnavailableMessage}
            </Text>
          )}

          {createError && (
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.redSoft, marginTop: 10 }}>
              {createError}
            </Text>
          )}
        </View>
      )}

      <View style={{ height: 26 }} />

      {/* Load Camera / Pay & Load Roll */}
      {(() => {
        const awaitingSkrQuote = selectedMode === 'roll' && payWithSkr && skrQuoteAmount === null
        const buttonDisabled = isCreating || awaitingSkrQuote
        return (
          <Pressable
            onPress={handleLoadCamera}
            disabled={buttonDisabled}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: buttonDisabled ? colors.surface : colors.accent,
              borderWidth: 1,
              borderColor: buttonDisabled ? colors.border : colors.accent,
            }}
          >
            {isCreating && phase ? (
              <>
                <ActivityIndicator color={colors.accentSoft} size="small" />
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.accentSoft }}>
                  {CREATE_PHASE_LABEL[phase]}
                </Text>
              </>
            ) : (
              <>
                <IconCamera size={18} color={colors.white} strokeWidth={1.7} />
                <Text
                  style={{
                    fontFamily: fonts.sansBold,
                    fontSize: 14,
                    letterSpacing: tracking(0.04, 14),
                    color: colors.white,
                  }}
                >
                  {selectedMode === 'roll' && !hasRoll
                    ? `Pay ${
                        payWithSkr && skrQuoteAmount !== null ? formatSkr(skrQuoteAmount) : formatSol(rollFeeLamports)
                      } & Load Roll`
                    : 'Load Camera'}
                </Text>
              </>
            )}
          </Pressable>
        )
      })()}
    </ScrollView>
  )
}

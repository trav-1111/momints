import { useState, useCallback, useEffect } from 'react'
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSessionStore } from '../store/session'
import type { AppMode, FilmMode, AspectRatio } from '../store/session'
import { useWalletDomain } from '../hooks/useWalletDomain'
import { useCreateRoll, type CreateRollPhase } from '../hooks/useCreateRoll'
import { useMintRoll } from '../hooks/useMintRoll'
import { PREPAID_ROLL_SIZES, getRollFeeLamports, formatSol, type PrepaidRollSize } from '../config/roll'
import { isWorkerRollEnabled } from '../config/rollApi'
import { completeWorkerRoll, getOpenWorkerRoll, type OpenRollSummary } from '../services/rollApi'
import { ARTIST_NAME_MAX_LENGTH } from '../services/rollIdentity'
import { colors, fonts, tracking } from '../theme'
import { IconCamera, IconFilm } from '../components/icons'

const CREATE_PHASE_LABEL: Record<CreateRollPhase, string> = {
  cover: 'Rendering cover…',
  uploading: 'Uploading cover…',
  signing: 'Sign in your wallet…',
  confirming: 'Confirming on-chain…',
  creating: 'Creating roll…',
}
const FILM_MODES: { value: FilmMode; label: string }[] = [
  { value: 'color', label: 'Color' },
  { value: 'bw', label: 'B&W' },
]
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

  const { account, connect } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)
  const { createRoll, phase, error: createError, isCreating } = useCreateRoll()
  const { mintRoll } = useMintRoll()

  const [selectedMode, setSelectedMode] = useState<AppMode>('quick')
  const [artist, setArtist] = useState('')
  const [rollSize, setRollSize] = useState<PrepaidRollSize>(12)
  const [filmMode, setFilmMode] = useState<FilmMode>('color')
  const [aspect, setAspect] = useState<AspectRatio>('full')

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

  const handleFinishStranded = useCallback(async () => {
    if (!strandedRoll || isClosingStranded) return
    setIsClosingStranded(true)
    try {
      await completeWorkerRoll(strandedRoll.collectionAddress)
      setStrandedRoll(null)
    } catch (err) {
      Alert.alert('Could not finish roll', err instanceof Error ? err.message : String(err))
    } finally {
      setIsClosingStranded(false)
    }
  }, [strandedRoll, isClosingStranded])

  const handleLoadCamera = useCallback(async () => {
    if (selectedMode === 'quick') {
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

    const created = await createRoll({
      size: rollSize,
      artist,
      skrHandle: domain,
      film: { mode: filmMode },
      aspect,
    })
    if (created) router.replace('/camera')
  }, [selectedMode, isCreating, account, connect, createRoll, rollSize, artist, domain, filmMode, aspect, selectQuickMode, router])

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
            marginBottom: 16,
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
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {FILM_MODES.map(({ value, label }) => (
              <Pill key={value} label={label} selected={filmMode === value} onPress={() => setFilmMode(value)} />
            ))}
          </View>

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
              {formatSol(getRollFeeLamports(rollSize))}
            </Text>
          </View>

          {createError && (
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.redSoft, marginTop: 10 }}>
              {createError}
            </Text>
          )}
        </View>
      )}

      <View style={{ height: 26 }} />

      {/* Load Camera / Pay & Load Roll */}
      <Pressable
        onPress={handleLoadCamera}
        disabled={isCreating}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          paddingVertical: 15,
          borderRadius: 14,
          backgroundColor: isCreating ? colors.surface : colors.accent,
          borderWidth: 1,
          borderColor: isCreating ? colors.border : colors.accent,
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
                ? `Pay ${formatSol(getRollFeeLamports(rollSize))} & Load Roll`
                : 'Load Camera'}
            </Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  )
}

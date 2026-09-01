import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  Image,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../../../store/photos'
import { useMintQueue } from '../../../store/mintQueue'
import { useSessionStore } from '../../../store/session'
import { useWalletDomain } from '../../../hooks/useWalletDomain'
import { resolveLocation } from '../../../services/captureMetadata'
import { colors, fonts, tracking } from '../../../theme'
import { IconBack, IconFilm, IconMint, IconPhone, IconPin } from '../../../components/icons'

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 10,
        letterSpacing: tracking(0.16, 10),
        color: colors.textMuted,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  )
}

function MetaBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {icon}
      <Text style={{ fontFamily: fonts.sans, fontSize: 11.5, color: colors.textSoft }}>{label}</Text>
    </View>
  )
}

export default function MintFormScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { account, connect } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const photos = usePhotoStore((state) => state.photos)
  const photo = useMemo(() => photos.find((p) => p.id === id), [photos, id])

  const addToQueue = useMintQueue((state) => state.addToQueue)

  const activeRoll = useSessionStore((s) => s.activeRoll)

  // Derive roll context for this specific frame
  const rollContext = useMemo(() => {
    if (!activeRoll || !photo) return null
    const frameIndex = activeRoll.frameIds.indexOf(photo.id)
    if (frameIndex === -1) return null
    return {
      rollId: activeRoll.id,
      rollName: activeRoll.name,
      frameNumber: frameIndex + 1,
      totalFrames: activeRoll.size,
    }
  }, [activeRoll, photo])

  // The queue entry this photo already has, if it is being edited rather than
  // filled in for the first time. Read once via getState() rather than
  // subscribed: it is a seed for the inputs, and a live subscription would
  // fight the user's own typing.
  const existing = useMemo(() => useMintQueue.getState().queue.find((q) => q.photoId === id), [id])

  const [title, setTitle] = useState(existing?.title ?? '')
  const [artist, setArtist] = useState(existing?.artist ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [focusedField, setFocusedField] = useState<'title' | 'artist' | null>(null)

  // Pre-populate title from roll on first mount — but never over a title the
  // user already saved, or re-opening a queued frame would silently discard it.
  useEffect(() => {
    if (rollContext && !existing) {
      setTitle(`${rollContext.rollName} — Frame ${rollContext.frameNumber}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-populate artist from wallet domain as soon as it resolves
  useEffect(() => {
    if (domain) {
      setArtist((prev) => (prev ? prev : domain))
    }
  }, [domain])

  const handleMint = useCallback(async () => {
    if (!photo) return

    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your NFT.')
      return
    }

    if (!artist.trim()) {
      Alert.alert('Missing Artist', 'Please enter the artist name.')
      return
    }

    if (!account) {
      Alert.alert('Wallet Required', 'Please connect your wallet to mint NFTs.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: connect },
      ])
      return
    }

    setIsSubmitting(true)
    try {
      addToQueue({
        photoId: photo.id,
        photoUri: photo.uri,
        title: title.trim(),
        artist: artist.trim(),
        capturedAt: photo.capturedAt,
        rollContext: rollContext ?? undefined,
        captureMeta: photo.meta,
      })

      router.back()
    } catch (error) {
      console.error('Failed to add to mint queue:', error)
      Alert.alert('Error', 'Failed to queue NFT for minting.')
    } finally {
      setIsSubmitting(false)
    }
  }, [photo, title, artist, account, connect, addToQueue, router, rollContext])

  const handleBack = useCallback(() => {
    router.back()
  }, [router])

  const inputStyle = (focused: boolean) => ({
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: focused ? colors.accent : colors.border,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.text,
  })

  if (!photo) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.text }}>Photo not found</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 16 }}>
          <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.accentSoft }}>Go Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View
          style={{
            paddingTop: 52,
            paddingBottom: 18,
            paddingHorizontal: 22,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable onPress={handleBack} hitSlop={8}>
            <IconBack size={21} color={colors.text} strokeWidth={1.7} />
          </Pressable>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: colors.text }}>Mint NFT</Text>
        </View>

        {/* Image Preview */}
        <View style={{ paddingHorizontal: 22, marginBottom: 18 }}>
          <Image
            source={{ uri: photo.uri }}
            style={{ width: '100%', aspectRatio: 1, borderRadius: 16 }}
            resizeMode="cover"
          />
        </View>

        {/* Metadata Form */}
        <View style={{ paddingHorizontal: 22 }}>
          <FieldLabel>TITLE *</FieldLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Enter NFT title"
            placeholderTextColor={colors.textMuted}
            maxLength={50}
            onFocus={() => setFocusedField('title')}
            onBlur={() => setFocusedField(null)}
            style={[inputStyle(focusedField === 'title'), { marginBottom: 14 }]}
          />

          <FieldLabel>ARTIST *</FieldLabel>
          <TextInput
            value={artist}
            onChangeText={setArtist}
            placeholder="Enter artist name"
            placeholderTextColor={colors.textMuted}
            maxLength={50}
            onFocus={() => setFocusedField('artist')}
            onBlur={() => setFocusedField(null)}
            style={[inputStyle(focusedField === 'artist'), { marginBottom: 18 }]}
          />

          {/* Auto-added metadata badges */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 20 }}>
            {rollContext && (
              <MetaBadge
                icon={<IconFilm size={13} color={colors.accent} strokeWidth={1.7} />}
                label={rollContext.rollName}
              />
            )}
            <MetaBadge icon={<IconPhone size={13} color={colors.accent} strokeWidth={1.7} />} label="Shot on Seeker" />
            <MetaBadge
              icon={<IconPin size={13} color={colors.accent} strokeWidth={1.7} />}
              label={resolveLocation(photo.meta)}
            />
          </View>

          {/* Wallet + cost row */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 13,
              paddingHorizontal: 15,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 20,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: account ? colors.green : colors.textMuted,
              }}
            />
            {account && walletAddress ? (
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12, color: colors.text }}>
                {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
              </Text>
            ) : (
              <Pressable onPress={connect} style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.accentSoft }}>
                  TAP TO CONNECT WALLET
                </Text>
              </Pressable>
            )}
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textSecondary }}>~0.01 SOL</Text>
          </View>
        </View>

        {/* Mint Button */}
        <View style={{ padding: 22, paddingTop: 0 }}>
          <Pressable
            onPress={handleMint}
            disabled={isSubmitting || !account}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              paddingVertical: 15,
              borderRadius: 14,
              backgroundColor: isSubmitting || !account ? colors.surface : colors.accent,
              borderWidth: 1,
              borderColor: isSubmitting || !account ? colors.border : colors.accent,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.accentSoft} />
            ) : (
              <>
                <IconMint size={18} color={account ? colors.white : colors.textMuted} strokeWidth={1.7} />
                <Text
                  style={{
                    fontFamily: fonts.sansBold,
                    fontSize: 14,
                    color: account ? colors.white : colors.textMuted,
                  }}
                >
                  {account ? 'Add to Mint Queue' : 'Connect Wallet First'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Linking,
  Animated,
  Vibration,
  GestureResponderEvent,
  Modal,
  AppState,
  useWindowDimensions,
  ViewStyle,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Camera, useCameraDevice, useCameraPermission, PhotoFile } from 'react-native-vision-camera'
import {
  Gesture,
  GestureDetector,
  GestureUpdateEvent,
  PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import { Paths, File, Directory } from 'expo-file-system'
import { usePhotoStore } from '../store/photos'
import { captureMetadata } from '../services/captureMetadata'
import { applyFilm } from '../services/filmProcessor'
import { cropToAspect } from '../services/cropImage'
import { ensureUnderCeiling } from '../services/compressImage'
import { AspectFramingOverlay } from '../components/AspectFramingOverlay'
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'
import { useMintRoll } from '../hooks/useMintRoll'
import { useSessionStore } from '../store/session'
import type { AspectRatio } from '../store/session'
import { useLocationSettingsStore } from '../store/locationSettings'
import type { LocationGranularity } from '../store/locationSettings'
import { colors, fonts, tracking } from '../theme'
import {
  IconBolt,
  IconBoltOff,
  IconCamera,
  IconCheck,
  IconFilm,
  IconFlip,
  IconMint,
  IconPin,
} from '../components/icons'

const QUICK_ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: 'full', label: 'FULL' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
]

const LOCATION_OPTIONS: { value: LocationGranularity; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'No location is captured' },
  { value: 'country', label: 'Country', description: 'e.g. "United States"' },
  { value: 'state', label: 'State', description: 'e.g. "Texas"' },
  { value: 'city', label: 'City', description: 'e.g. "Austin, Texas"' },
]

// Translucent over-preview chrome — hairline border on rgba(0,0,0,.5)
const chip: ViewStyle = {
  backgroundColor: colors.chipBg,
  borderWidth: 1,
  borderColor: colors.chipBorder,
}

const roundChip = (size: number): ViewStyle => ({
  ...chip,
  width: size,
  height: size,
  borderRadius: size / 2,
  alignItems: 'center',
  justifyContent: 'center',
})

export default function CameraScreen() {
  const router = useRouter()
  const { account, connect, disconnect } = useMobileWallet()
  const { hasPermission, requestPermission } = useCameraPermission()
  const cameraRef = useRef<Camera>(null)

  const [flash, setFlash] = useState<'off' | 'on'>('off')
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back')
  const [zoom, setZoom] = useState(1)
  const baseZoomRef = useRef(1)
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null)
  const focusOpacity = useRef(new Animated.Value(0)).current
  const shutterFlashAnim = useRef(new Animated.Value(0)).current
  const [walletMenuVisible, setWalletMenuVisible] = useState(false)
  const [locationMenuVisible, setLocationMenuVisible] = useState(false)

  // Release the camera when the screen loses focus or the app is backgrounded
  // (e.g. wallet handoff) — Android throws camera-is-restricted otherwise
  const isFocused = useIsFocused()
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'))
    return () => sub.remove()
  }, [])

  const photos = usePhotoStore((state) => state.photos)
  const addPhoto = usePhotoStore((state) => state.addPhoto)
  const setAction = usePhotoStore((state) => state.setAction)
  const setPhotoMeta = usePhotoStore((state) => state.setPhotoMeta)
  const updatePhotoUri = usePhotoStore((state) => state.updatePhotoUri)

  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const locationGranularity = useLocationSettingsStore((s) => s.granularity)
  const setLocationGranularity = useLocationSettingsStore((s) => s.setGranularity)

  const activeMode = useSessionStore((s) => s.activeMode)
  const rollInProgress = useSessionStore((s) => s.activeRoll)
  const addFrameToRoll = useSessionStore((s) => s.addFrameToRoll)
  const developRoll = useSessionStore((s) => s.developRoll)
  // Queues every frame of the finished roll and routes to the mint queue.
  const { mintRoll } = useMintRoll()

  // The roll the camera shoots into — only relevant while in roll mode.
  const activeRoll = activeMode === 'roll' ? rollInProgress : null

  // Quick mode picks aspect live on the camera; roll mode uses the roll's fixed aspect.
  const [quickAspect, setQuickAspect] = useState<AspectRatio>('full')
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false)
  const quickAspectLabel = QUICK_ASPECTS.find((a) => a.value === quickAspect)?.label ?? 'FULL'
  const effectiveAspect: AspectRatio = activeMode === 'roll' ? (activeRoll?.aspect ?? 'full') : quickAspect
  const { width: screenW, height: screenH } = useWindowDimensions()

  const rollIsFull = activeRoll !== null && activeRoll.frameIds.length >= activeRoll.size
  const remainingExp = activeRoll ? activeRoll.size - activeRoll.frameIds.length : 0

  // The quick-mint button only concerns photos outside any roll — a roll's
  // frames go straight to the mint queue, not this screen's review flow.
  // Keyed off the photo's own rollId, so frames of a *finished* roll stay
  // excluded once the session's activeRoll is cleared.
  const quickPhotos = useMemo(() => photos.filter((p) => !p.rollId), [photos])
  // Already-minted photos are terminal — they shouldn't inflate the "needs a
  // mint decision" badge.
  const quickMintBadgeCount = useMemo(
    () => quickPhotos.filter((p) => p.action !== 'minted').length,
    [quickPhotos],
  )

  const frontDevice = useCameraDevice('front')
  const backDevice = useCameraDevice('back')
  const activeDevice = cameraPosition === 'front' ? frontDevice : backDevice

  const supportsFlash = activeDevice?.hasFlash && cameraPosition === 'back'
  const minZoom = activeDevice?.minZoom ?? 1
  const maxZoom = Math.min(activeDevice?.maxZoom ?? 5, 10)

  useEffect(() => {
    if (!hasPermission) {
      requestPermission()
    }
  }, [hasPermission, requestPermission])

  useEffect(() => {
    setZoom(1)
    baseZoomRef.current = 1
  }, [cameraPosition])

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return

    // A fully shot roll is closed to further frames — the only way on is to
    // mint it (or discard it from the gallery).
    if (activeRoll?.developed || rollIsFull) {
      Alert.alert('Roll Complete', 'Every frame on this roll is shot. Mint the roll to see them.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Mint Roll', onPress: () => mintRoll() },
      ])
      return
    }

    setIsCapturing(true)
    try {
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        flash: supportsFlash ? flash : 'off',
        enableShutterSound: true,
      })

      // Shutter flash + haptic feedback
      Vibration.vibrate(80)
      shutterFlashAnim.setValue(1)
      Animated.timing(shutterFlashAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start()

      const photosDir = new Directory(Paths.document, 'photos')
      if (!photosDir.exists) {
        photosDir.create()
      }

      const fileName = `photo_${Date.now()}.jpg`
      const sourceFile = new File(`file://${photo.path}`)
      const destFile = new File(photosDir, fileName)

      sourceFile.move(destFile)

      // Stamp roll membership at creation so it outlives the session's
      // activeRoll — completeRoll() clears that, and frames must stay grouped
      // as a roll (and out of the quick-photo flows) forever after.
      const photoId = addPhoto(
        destFile.uri,
        activeMode === 'roll' && activeRoll !== null
          ? { id: activeRoll.id, name: activeRoll.name }
          : undefined,
      )

      // Post-capture processing: crop to the aspect ratio first, then apply the
      // roll's film emulation (B&W), then fit quick shots under the upload
      // ceiling. Each no-ops where not needed and falls back to the original on
      // failure, so a capture is never lost.
      let processedUri = destFile.uri
      if (effectiveAspect !== 'full') {
        processedUri = await cropToAspect(processedUri, effectiveAspect)
      }
      if (activeMode === 'roll' && activeRoll !== null && activeRoll.film.mode !== 'color') {
        processedUri = await applyFilm(processedUri, activeRoll.film)
      }
      // Quick shots only. Roll frames have no server-side size ceiling, so they
      // keep full capture quality. This is the same predicate addPhoto uses to
      // stamp rollId above, which is exactly what the gallery filters on to
      // decide what mints through the quick path — so the two cannot disagree.
      //
      // Must come after applyFilm: film re-encodes at quality 95 and would
      // otherwise be free to push an already-fitted image back over.
      if (activeMode !== 'roll' || activeRoll === null) {
        processedUri = await ensureUnderCeiling(processedUri)
      }
      if (processedUri !== destFile.uri) updatePhotoUri(photoId, processedUri)

      // Best-effort location — fire-and-forget, never blocks capture. 'off'
      // short-circuits inside captureMetadata before touching GPS at all.
      captureMetadata(locationGranularity)
        .then((meta) => {
          if (meta.location) setPhotoMeta(photoId, meta)
        })
        .catch(() => {})

      // In roll mode: register frame and auto-mark for minting
      if (activeMode === 'roll' && activeRoll !== null) {
        addFrameToRoll(photoId)
        setAction(photoId, 'mint')

        // That capture finished the roll. A roll is always shot to the end, so
        // it develops itself here — there is no manual develop action — and
        // the frames are first seen in the mint queue.
        if (activeRoll.frameIds.length + 1 >= activeRoll.size) {
          developRoll()
          Alert.alert('Roll Complete! 🎞️', `All ${activeRoll.size} frames are shot. Mint the roll?`, [
            { text: 'Later', style: 'cancel' },
            { text: 'Mint Roll', onPress: () => mintRoll() },
          ])
        }
      }
    } catch (error) {
      console.error('Failed to capture photo:', error)
      Alert.alert('Error', 'Failed to capture photo. Please try again.')
    } finally {
      setIsCapturing(false)
    }
  }, [
    flash,
    isCapturing,
    addPhoto,
    supportsFlash,
    activeMode,
    activeRoll,
    addFrameToRoll,
    setAction,
    setPhotoMeta,
    updatePhotoUri,
    effectiveAspect,
    shutterFlashAnim,
    rollIsFull,
    developRoll,
    mintRoll,
    locationGranularity,
  ])

  const toggleFlash = useCallback(() => {
    if (!supportsFlash) return
    setFlash((prev) => (prev === 'off' ? 'on' : 'off'))
  }, [supportsFlash])

  const toggleCamera = useCallback(() => {
    setCameraPosition((prev) => (prev === 'back' ? 'front' : 'back'))
    if (flash === 'on') {
      setFlash('off')
    }
  }, [flash])

  const handleFocus = useCallback(
    async (event: GestureResponderEvent) => {
      if (!cameraRef.current || !activeDevice?.supportsFocus) return

      const { locationX, locationY } = event.nativeEvent

      setFocusPoint({ x: locationX, y: locationY })

      focusOpacity.setValue(1)
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(focusOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setFocusPoint(null))

      try {
        await cameraRef.current.focus({ x: locationX, y: locationY })
      } catch (error) {
        console.log('Focus not supported or failed:', error)
      }
    },
    [activeDevice, focusOpacity],
  )

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      baseZoomRef.current = zoom
    })
    .onUpdate((event: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
      const newZoom = Math.min(Math.max(baseZoomRef.current * event.scale, minZoom), maxZoom)
      setZoom(newZoom)
    })
    .runOnJS(true)

  const handleReview = useCallback(() => {
    if (quickPhotos.length === 0) {
      Alert.alert('No Photos', 'Take some photos first before reviewing.')
      return
    }
    router.push('/review')
  }, [quickPhotos.length, router])

  const handleConnectWallet = useCallback(async () => {
    try {
      await connect()
    } catch (error) {
      console.error('Failed to connect wallet:', error)
    }
  }, [connect])

  const handleDisconnect = useCallback(async () => {
    setWalletMenuVisible(false)
    try {
      await disconnect()
    } catch (error) {
      console.error('Failed to disconnect wallet:', error)
    }
  }, [disconnect])

  const handleSelectGranularity = useCallback(
    (next: LocationGranularity) => {
      // Turning it on for the first time (off -> anything else) is the one
      // moment that needs an explicit heads-up: everything after this is
      // permanently attached to the photo once minted.
      if (locationGranularity === 'off' && next !== 'off') {
        const label = LOCATION_OPTIONS.find((o) => o.value === next)?.label ?? next
        Alert.alert(
          'Location Will Be Stored',
          `Your ${label.toLowerCase()}-level location will be saved with every photo you capture from now on. Once a photo is minted, its location can't be changed or removed.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Enable',
              onPress: () => {
                setLocationGranularity(next)
                setLocationMenuVisible(false)
              },
            },
          ],
        )
        return
      }
      setLocationGranularity(next)
      setLocationMenuVisible(false)
    },
    [locationGranularity, setLocationGranularity],
  )

  if (!hasPermission) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.sansSemiBold,
            fontSize: 18,
            color: colors.text,
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          Camera permission is required
        </Text>
        <Pressable
          onPress={() => Linking.openSettings()}
          style={{
            backgroundColor: colors.accent,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 14,
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.white }}>Open Settings</Text>
        </Pressable>
      </View>
    )
  }

  if (!activeDevice) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.text }}>No camera device found</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GestureDetector gesture={pinchGesture}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleFocus}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={activeDevice}
            isActive={isFocused && appActive}
            photo={true}
            zoom={zoom}
          />

          {/* Aspect-ratio framing guide */}
          <AspectFramingOverlay aspect={effectiveAspect} width={screenW} height={screenH} />

          {/* Legibility scrims — controls float above these */}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 150 }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 190 }}
          />

          {/* Shutter Flash Overlay */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: shutterFlashAnim }]}
          />

          {/* Focus Indicator */}
          {focusPoint && (
            <Animated.View
              style={{
                position: 'absolute',
                left: focusPoint.x - 40,
                top: focusPoint.y - 40,
                width: 80,
                height: 80,
                borderWidth: 1.5,
                borderColor: colors.accentSoft,
                borderRadius: 10,
                opacity: focusOpacity,
              }}
            />
          )}
        </Pressable>
      </GestureDetector>

      {/* Zoom Indicator */}
      {zoom > 1.1 && (
        <View
          style={[
            chip,
            {
              position: 'absolute',
              top: '50%',
              right: 16,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
            },
          ]}
        >
          <Text style={{ fontFamily: fonts.monoBold, fontSize: 12, color: colors.text }}>{zoom.toFixed(1)}×</Text>
        </View>
      )}

      {/* Top row — flash · wallet */}
      <View
        style={{
          position: 'absolute',
          top: 20,
          left: 18,
          right: 18,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={toggleFlash}
            disabled={!supportsFlash}
            style={[roundChip(42), { opacity: supportsFlash ? 1 : 0.4 }]}
          >
            {flash === 'on' && supportsFlash ? (
              <IconBolt size={19} color={colors.text} />
            ) : (
              <IconBoltOff size={19} color={colors.text} />
            )}
          </Pressable>

          <Pressable
            onPress={() => setLocationMenuVisible(true)}
            style={[roundChip(42), { opacity: locationGranularity === 'off' ? 0.4 : 1 }]}
          >
            <IconPin size={19} color={locationGranularity === 'off' ? colors.text : colors.accent} />
          </Pressable>
        </View>

        {account && walletAddress ? (
          <Pressable
            onPress={() => setWalletMenuVisible(true)}
            style={[
              chip,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
              },
            ]}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green }} />
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.text }}>
              {formatWalletDisplay(walletAddress, domain)}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConnectWallet}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: colors.accentTint,
              borderWidth: 1,
              borderColor: colors.accent,
            }}
          >
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.accentSoft }}>CONNECT</Text>
          </Pressable>
        )}
      </View>

      {/* Second row — mode chip · EXP dial */}
      <Pressable
        onPress={() => router.push('/mode-select')}
        style={[
          chip,
          {
            position: 'absolute',
            top: 74,
            left: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 7,
            paddingHorizontal: 11,
            borderRadius: 10,
          },
        ]}
      >
        {activeMode === 'roll' ? (
          <IconFilm size={15} color={colors.text} />
        ) : (
          <IconCamera size={15} color={colors.text} />
        )}
        <Text
          style={{
            fontFamily: fonts.sansBold,
            fontSize: 11,
            letterSpacing: tracking(0.1, 11),
            color: colors.text,
          }}
        >
          {activeMode === 'roll' ? 'FILM' : 'QUICK'}
        </Text>
        {activeMode === 'roll' && activeRoll !== null && (
          <>
            <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            {activeRoll.film.mode === 'bw' && (
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft }}>B&W</Text>
            )}
            {activeRoll.aspect !== 'full' && (
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft }}>{activeRoll.aspect}</Text>
            )}
            {activeRoll.film.mode !== 'bw' && activeRoll.aspect === 'full' && (
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft }}>COLOR</Text>
            )}
          </>
        )}
      </Pressable>

      {/* EXP dial — frames remaining, counts down like a film counter */}
      {activeMode === 'roll' && activeRoll !== null && (
        <View
          style={[roundChip(52), { position: 'absolute', top: 74, right: 18, borderColor: 'rgba(255,255,255,0.16)' }]}
        >
          <Text style={{ fontFamily: fonts.monoBold, fontSize: 18, lineHeight: 20, color: colors.text }}>
            {remainingExp}
          </Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 7,
              letterSpacing: tracking(0.18, 7),
              color: colors.accentSoft,
              marginTop: 1,
            }}
          >
            EXP
          </Text>
        </View>
      )}

      {/* Quick-mode aspect dropdown — collapsed shows the current ratio */}
      {activeMode === 'quick' && (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 74, left: 0, right: 0, alignItems: 'center' }}
        >
          <Pressable
            onPress={() => setAspectMenuOpen((o) => !o)}
            style={[
              chip,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
              },
            ]}
          >
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.text }}>{quickAspectLabel}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.textSoft }}>
              {aspectMenuOpen ? '▲' : '▼'}
            </Text>
          </Pressable>
          {aspectMenuOpen && (
            <View
              style={{
                marginTop: 6,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: 'rgba(0,0,0,0.8)',
                borderWidth: 1,
                borderColor: colors.chipBorder,
              }}
            >
              {QUICK_ASPECTS.filter((a) => a.value !== quickAspect).map(({ value, label }) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    setQuickAspect(value)
                    setAspectMenuOpen(false)
                  }}
                  style={{ paddingHorizontal: 30, paddingVertical: 10 }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 11,
                      color: colors.textSoft,
                      textAlign: 'center',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Bottom row — flip · shutter · mint */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 150,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 26,
        }}
      >
        <Pressable onPress={toggleCamera} style={roundChip(44)}>
          <IconFlip size={20} color={colors.text} />
        </Pressable>

        <Pressable
          onPress={handleCapture}
          disabled={isCapturing}
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            borderWidth: 2,
            borderColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isCapturing || rollIsFull || activeRoll?.developed ? 0.5 : 1,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: colors.text,
              borderWidth: 4,
              borderColor: 'rgba(12,13,22,0.35)',
            }}
          />
        </Pressable>

        {/* Quick mode only — a roll's frames mint as a whole roll, not here */}
        {activeMode === 'roll' ? (
          <View style={{ width: 44, height: 44 }} />
        ) : (
          <View style={{ alignItems: 'center', gap: 5 }}>
            <Pressable onPress={handleReview} style={roundChip(44)}>
              <IconMint size={20} color={colors.text} strokeWidth={1.5} />
              {quickMintBadgeCount > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.monoBold, fontSize: 10, color: colors.white }}>
                    {quickMintBadgeCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 9,
                letterSpacing: tracking(0.14, 9),
                color: colors.textSoft,
              }}
            >
              MINT
            </Text>
          </View>
        )}
      </View>

      {/* Wallet Menu Modal */}
      <Modal
        visible={walletMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWalletMenuVisible(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
          onPress={() => setWalletMenuVisible(false)}
        />
        <View
          style={{
            position: 'absolute',
            top: '30%',
            left: 24,
            right: 24,
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {/* Wallet Address */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: tracking(0.16, 10),
                color: colors.textMuted,
                marginBottom: 6,
              }}
            >
              CONNECTED WALLET
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.text }}>
              {walletAddress}
            </Text>
          </View>

          {/* Disconnect */}
          <Pressable
            onPress={handleDisconnect}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.sansSemiBold,
                fontSize: 14,
                color: colors.redSoft,
                textAlign: 'center',
              }}
            >
              Disconnect Wallet
            </Text>
          </Pressable>

          {/* Close */}
          <Pressable onPress={() => setWalletMenuVisible(false)} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
            <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </Modal>

      {/* Location Settings Modal */}
      <Modal
        visible={locationMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationMenuVisible(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
          onPress={() => setLocationMenuVisible(false)}
        />
        <View
          style={{
            position: 'absolute',
            top: '30%',
            left: 24,
            right: 24,
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {/* Explanation */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: tracking(0.16, 10),
                color: colors.textMuted,
                marginBottom: 6,
              }}
            >
              LOCATION METADATA
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary }}>
              Off by default — nothing is captured unless you choose a level below.
            </Text>
          </View>

          {/* Granularity options */}
          {LOCATION_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => handleSelectGranularity(option.value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View>
                <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.text }}>
                  {option.label}
                </Text>
                <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {option.description}
                </Text>
              </View>
              {locationGranularity === option.value && <IconCheck size={18} color={colors.accent} />}
            </Pressable>
          ))}

          {/* Close */}
          <Pressable
            onPress={() => setLocationMenuVisible(false)}
            style={{ paddingHorizontal: 20, paddingVertical: 16 }}
          >
            <Text style={{ fontFamily: fonts.sans, fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

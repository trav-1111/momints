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
  Easing,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Camera, useCameraDevice, useCameraPermission, PhotoFile, type Orientation } from 'react-native-vision-camera'
import {
  Gesture,
  GestureDetector,
  GestureUpdateEvent,
  PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { usePhotoStore } from '../store/photos'
import { captureMetadata } from '../services/captureMetadata'
import { adoptTemporaryCapture, deleteCapture } from '../services/imagePrivacy'
import { persistRollFrame, updateStoredRollFrameMeta } from '../services/rollVault'
import { processFilm } from '../services/filmProcessor'
import { verifyCompressedFilmOutput } from '../services/filmOutput'
import { cropToAspect } from '../services/cropImage'
import { ensureUnderCeiling } from '../services/compressImage'
import { AspectFramingOverlay } from '../components/AspectFramingOverlay'
import { CompositionGridOverlay, type GridMode } from '../components/CompositionGridOverlay'
import { FocusReticle } from '../components/FocusReticle'
import ManualControls from '../components/ManualControls'
import { useManualCameraState } from '../hooks/useManualCameraState'
import { useCameraReadiness } from '../hooks/useCameraReadiness'
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'
import { useMintRoll } from '../hooks/useMintRoll'
import { useSessionStore } from '../store/session'
import type { AspectRatio } from '../store/session'
import { useLocationSettingsStore } from '../store/locationSettings'
import type { LocationGranularity } from '../store/locationSettings'
import { useContactSheetDiscovery } from '../store/contactSheetDiscovery'
import { useKinoSettingsStore, CAPTURE_CADENCE_MS } from '../store/kinoSettings'
import { PERMANENT_IMAGE_MAX_LONG_EDGE, PERMANENT_IMAGE_MAX_PIXELS } from '../config/imageArtifact'
import { colors, fonts, tracking } from '../theme'
import { DEFAULT_COLOR_FILM_ID, ensureFilmStockRecipe, isFilmStockDownloaded } from '../services/filmstocks'
import { useFilmStockStore } from '../store/filmstocks'
import {
  IconBolt,
  IconBoltOff,
  IconCamera,
  IconCheck,
  IconFilm,
  IconFlip,
  IconGallery,
  IconGrid,
  IconMint,
  IconPin,
} from '../components/icons'

const QUICK_ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: 'full', label: 'FULL' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
]

// Tier 2 (manual ISO/shutter/focus/white balance via Camera2Interop) is
// additive on top of Tier 1 (EV bias/tap-focus/zoom, all vision-camera-native
// and proven). Flip to false to hide the manual-controls panel entirely
// without touching Tier 1 — the hackathon-cutoff fallback if Tier 2 isn't
// solid in time.
const TIER2_ENABLED = true

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

  const [flash, setFlash] = useState<'off' | 'on'>('off')
  const [torchActive, setTorchActive] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back')
  const [zoom, setZoom] = useState(1)
  const baseZoomRef = useRef(1)
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null)
  const [exposurePoint, setExposurePoint] = useState<{ x: number; y: number } | null>(null)
  const [isSeparated, setIsSeparated] = useState(false)
  const [hasPlacedAe, setHasPlacedAe] = useState(false)
  const [isHoldingFocus, setIsHoldingFocus] = useState(false)
  const holdProgress = useRef(new Animated.Value(0)).current
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdAnimRef = useRef<Animated.CompositeAnimation | null>(null)
  const isLockedRef = useRef(false)
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearFadeTimer = useCallback(() => {
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current)
      fadeTimeoutRef.current = null
    }
  }, [])
  const focusOpacity = useRef(new Animated.Value(0)).current
  const shutterFlashAnim = useRef(new Animated.Value(0)).current
  const [walletMenuVisible, setWalletMenuVisible] = useState(false)
  const [locationMenuVisible, setLocationMenuVisible] = useState(false)
  const showContactSheetNudge = useContactSheetDiscovery((state) => state.hydrated && !state.acknowledged)
  const acknowledgeContactSheet = useContactSheetDiscovery((state) => state.acknowledge)

  // LomoKino burst state
  const [isCranking, setIsCranking] = useState(false)
  const [crankCount, setCrankCount] = useState(0)
  const [kinoDevelopingCount, setKinoDevelopingCount] = useState<number | null>(null)
  const isCrankingRef = useRef(false)
  const crankHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didCrankRef = useRef(false)
  const crankAnim = useRef(new Animated.Value(0)).current

  const captureFps = useKinoSettingsStore((s) => s.captureFps)
  const cycleCaptureFps = useKinoSettingsStore((s) => s.cycleCaptureFps)

  useEffect(() => {
    if (isCranking) {
      const loop = Animated.loop(
        Animated.timing(crankAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      )
      loop.start()
      return () => loop.stop()
    } else {
      crankAnim.setValue(0)
    }
  }, [isCranking, crankAnim])

  // Pro mode — Tier 1 (EV bias, metering) is always available here; Tier 2
  // (manual ISO/shutter/focus/WB) mounts underneath, gated by TIER2_ENABLED.
  const [proOpen, setProOpen] = useState(false)
  const [ev, setEv] = useState(0)

  // Release the camera when the screen loses focus or the app is backgrounded
  // (e.g. wallet handoff) — Android throws camera-is-restricted otherwise
  const isFocused = useIsFocused()
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')

  const photos = usePhotoStore((state) => state.photos)
  const addPhoto = usePhotoStore((state) => state.addPhoto)
  const setAction = usePhotoStore((state) => state.setAction)
  const setPhotoMeta = usePhotoStore((state) => state.setPhotoMeta)
  const updatePhotoUri = usePhotoStore((state) => state.updatePhotoUri)
  const removePhoto = usePhotoStore((state) => state.removePhoto)

  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)
  useEffect(() => {
    if (!account || !walletAddress) return
    if (__DEV__)
      console.log('[wallet] authorization completed', {
        address: walletAddress.slice(0, 4) + '...' + walletAddress.slice(-4),
        label: account.label ? '[present]' : '[absent]',
      })
  }, [account, walletAddress])

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
  const quickFilmStockId = useFilmStockStore((state) => state.quickFilmStockId)
  const filmCatalogue = useFilmStockStore((state) => state.catalogue)
  const quickFilmStock = filmCatalogue.find((stock) => stock.filmStockId === quickFilmStockId)
  const effectiveFilm = useMemo(
    () =>
      activeMode === 'roll' && activeRoll
        ? activeRoll.film
        : {
            mode: quickFilmStock?.baseMode ?? ('color' as const),
            filmStockId: quickFilmStock?.filmStockId ?? DEFAULT_COLOR_FILM_ID,
          },
    [activeMode, activeRoll, quickFilmStock],
  )
  const effectiveFilmName =
    filmCatalogue.find((stock) => stock.filmStockId === effectiveFilm.filmStockId)?.displayName ??
    (effectiveFilm.mode === 'bw' ? 'B&W' : 'Color')

  // Quick mode picks aspect live on the camera; roll mode uses the roll's fixed aspect.
  const [quickAspect, setQuickAspect] = useState<AspectRatio>('full')
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false)
  const quickAspectLabel = QUICK_ASPECTS.find((a) => a.value === quickAspect)?.label ?? 'FULL'
  const effectiveAspect: AspectRatio = activeMode === 'roll' ? (activeRoll?.aspect ?? 'full') : quickAspect
  const { width: screenW, height: screenH } = useWindowDimensions()

  // Target orientation & UI rotation for landscape / portrait layout adaptation
  const uiRotationAnim = useRef(new Animated.Value(0)).current
  const [uiRotation, setUiRotation] = useState(0)

  const handleUIRotationChanged = useCallback(
    (degrees: number) => {
      setUiRotation(degrees)
      Animated.spring(uiRotationAnim, {
        toValue: degrees,
        useNativeDriver: true,
        damping: 18,
        stiffness: 140,
        mass: 0.8,
      }).start()
    },
    [uiRotationAnim],
  )

  const handleOutputOrientationChanged = useCallback((_outputOrientation: Orientation) => {
    // VisionCamera updates uiRotation automatically
  }, [])

  const uiRotationDeg = uiRotationAnim.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  })
  const hudRotateStyle = { transform: [{ rotate: uiRotationDeg }] }

  // Composition Grid mode: 'off' | '3x3' | 'cross'
  const [gridMode, setGridMode] = useState<GridMode>('off')

  const toggleGrid = useCallback(() => {
    Haptics.selectionAsync()
    setGridMode((prev) => {
      if (prev === 'off') return '3x3'
      if (prev === '3x3') return 'cross'
      return 'off'
    })
  }, [])

  const rollIsFull = activeRoll !== null && activeRoll.frameIds.length >= activeRoll.size
  const remainingExp = activeRoll ? activeRoll.size - activeRoll.frameIds.length : 0

  // The quick-mint button only concerns photos outside any roll — a roll's
  // frames go straight to the mint queue, not this screen's review flow.
  // Keyed off the photo's own rollId, so frames of a *finished* roll stay
  // excluded once the session's activeRoll is cleared.
  const quickPhotos = useMemo(() => photos.filter((p) => !p.rollId), [photos])
  // Already-minted photos are terminal — they shouldn't inflate the "needs a
  // mint decision" badge.
  const quickMintBadgeCount = useMemo(() => quickPhotos.filter((p) => p.action !== 'minted').length, [quickPhotos])

  const frontDevice = useCameraDevice('front')
  const backDevice = useCameraDevice('back')
  const activeDevice = cameraPosition === 'front' ? frontDevice : backDevice
  const captureFormat = useMemo(() => {
    if (!activeDevice) return undefined
    return [...activeDevice.formats]
      .filter(
        (format) =>
          format.photoWidth * format.photoHeight <= PERMANENT_IMAGE_MAX_PIXELS &&
          Math.max(format.photoWidth, format.photoHeight) <= PERMANENT_IMAGE_MAX_LONG_EDGE,
      )
      .sort((left, right) => right.photoWidth * right.photoHeight - left.photoWidth * left.photoHeight)[0]
  }, [activeDevice])

  const supportsFlash = activeDevice?.hasFlash && cameraPosition === 'back'
  const supportsTorch = activeDevice?.hasTorch && cameraPosition === 'back'
  const minZoom = activeDevice?.minZoom ?? 1
  const maxZoom = Math.min(activeDevice?.maxZoom ?? 5, 10)
  const minExposure = activeDevice?.minExposure ?? -2
  const maxExposure = activeDevice?.maxExposure ?? 2
  // vision-camera reports minFocusDistance in cm (0 = unknown/fixed-focus);
  // Camera2's LENS_FOCUS_DISTANCE is diopters (1/meters) — 100/cm converts.
  // MANUAL_FOCUS_HEADROOM_DIOPTERS: LENS_INFO_MINIMUM_FOCUS_DISTANCE is
  // documented by Android as a "guaranteed sharp" floor, not a hard
  // mechanical limit — the lens can be racked past it, sharp result not
  // guaranteed. On this Seeker's main camera (reported min: 2 diopters /
  // 50cm) autofocus visibly focuses much closer than that, which the old
  // manual range couldn't reach. Verified on-device by manually pushing
  // LENS_FOCUS_DISTANCE well past the declared max and confirming sharp,
  // readable macro detail (mm ruler markings in focus) all the way past
  // 20 diopters (~5cm) — so this headroom is empirical, not a spec value,
  // and is specific to this camera module.
  const MANUAL_FOCUS_HEADROOM_DIOPTERS = 20
  const maxFocusDiopters =
    activeDevice && activeDevice.minFocusDistance > 0
      ? 100 / activeDevice.minFocusDistance + MANUAL_FOCUS_HEADROOM_DIOPTERS
      : null

  const cameraReadiness = useCameraReadiness(activeDevice?.id ?? null, isFocused && appActive)
  const { cameraRef, invalidate: invalidateCamera } = cameraReadiness
  const manualCamera = useManualCameraState(
    cameraReadiness.session,
    activeDevice?.id ?? null,
    maxFocusDiopters,
    cameraReadiness.isCurrent,
  )
  const { canCapture, controlsReady, controlsError, retry: retryCameraControls } = manualCamera
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') invalidateCamera()
      setAppActive(state === 'active')
    })
    return () => sub.remove()
  }, [invalidateCamera])
  useEffect(() => {
    if (!controlsError) return
    console.error('Camera settings could not be confirmed:', controlsError)
    Alert.alert(
      'Camera controls unavailable',
      'Capture is paused because your settings could not be confirmed. Please retry.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: retryCameraControls },
      ],
    )
  }, [controlsError, retryCameraControls])
  useEffect(() => {
    if (!cameraReadiness.error) return
    console.error('Camera session failed:', cameraReadiness.error)
    Alert.alert('Camera unavailable', 'The camera could not start. Return to the camera screen to try again.')
  }, [cameraReadiness.error])

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
    if (!cameraRef.current || isCapturing || !canCapture()) return

    if (!isFilmStockDownloaded(effectiveFilm.filmStockId)) {
      const stock = filmCatalogue.find((item) => item.filmStockId === effectiveFilm.filmStockId)
      if (!stock) {
        Alert.alert('Film recipe missing', 'Reconnect and refresh the Film Shelf before shooting this film.')
        return
      }
      try {
        await ensureFilmStockRecipe(stock)
      } catch {
        Alert.alert('Connect to download', `${stock.displayName} must be downloaded before this shot can be processed.`)
        return
      }
    }

    // A fully shot roll is closed to further frames — the only way on is to
    // mint it (or discard it from the gallery).
    if (activeRoll?.developed || rollIsFull) {
      Alert.alert('Roll Complete', 'Every frame on this roll is shot. Mint the roll to see them.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Mint Roll', onPress: () => mintRoll() },
      ])
      return
    }

    // Recipe downloads can take long enough for a lens/focus/app transition.
    if (!canCapture()) return
    setIsCapturing(true)
    // takePhoto's own flash:'on' (CameraX's AE-precapture-driven still
    // flash) silently doesn't fire on this hardware — confirmed via EXIF
    // (Flash tag came back "did not fire") and matches a long-standing,
    // still-unresolved class of react-native-vision-camera/CameraX bugs on
    // Android (mrousavy/react-native-vision-camera#2663, #2464). Torch is a
    // much more primitive Camera2 mechanism (a plain repeating-request flag,
    // no AE handshake) and reliably lights up, so when the user has flash
    // toggled on we drive the torch for the capture instead and request
    // flash:'off' from takePhoto so it doesn't also try its broken path.
    const usingTorchForFlash = supportsFlash && flash === 'on' && supportsTorch
    if (usingTorchForFlash) {
      setTorchActive(true)
      // Give the LED time to actually turn on and the preview to re-expose
      // under it before the still capture reads the sensor.
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    let captureUri: string | null = null
    let createdPhotoId: string | null = null
    try {
      // Also recheck after the torch delay. Never shoot with unconfirmed controls.
      if (!cameraRef.current || !canCapture()) return
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        flash: usingTorchForFlash ? 'off' : supportsFlash ? flash : 'off',
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

      captureUri = adoptTemporaryCapture(`file://${photo.path}`)

      // Originals are session-only. No photo enters the store/queue until the
      // selected immutable package has rendered and its output is verified.
      if (effectiveAspect !== 'full') {
        captureUri = await cropToAspect(captureUri, effectiveAspect)
      }
      let receipt = await processFilm(captureUri, effectiveFilm)
      captureUri = receipt.outputUri
      // Quick Shots and prepaid frames share one permanent artifact contract.
      // Fit after film rendering, then bind the exact encoded bytes into the
      // receipt before store/vault registration or exposure advancement.
      captureUri = await ensureUnderCeiling(captureUri)
      receipt = await verifyCompressedFilmOutput(receipt, captureUri)
      const photoId = addPhoto(
        receipt.outputUri,
        activeMode === 'roll' && activeRoll !== null
          ? { id: activeRoll.id, name: activeRoll.name, frameNumber: activeRoll.frameIds.length + 1 }
          : undefined,
        effectiveAspect,
        receipt.filmStockId,
        {
          mime: receipt.mime,
          byteLength: receipt.byteLength,
          width: receipt.width,
          height: receipt.height,
          imageHash: receipt.outputSha256,
          renderer: receipt.renderer,
          recipeSha256: receipt.recipeSha256,
          lutSha256: receipt.lutSha256,
        },
      )
      createdPhotoId = photoId

      // Best-effort location — fire-and-forget, never blocks capture. 'off'
      // short-circuits inside captureMetadata before touching GPS at all.
      // In roll mode: register frame and auto-mark for minting
      if (activeMode === 'roll' && activeRoll !== null) {
        setAction(photoId, 'mint')
        const storedPhoto = usePhotoStore.getState().photos.find((candidate) => candidate.id === photoId)
        if (!storedPhoto) throw new Error('The captured roll frame could not be registered.')

        // Commit the encrypted durable copy before advancing the roll counter.
        // A crash between these operations remains recoverable from the vault
        // manifest; the opposite order could lose a prepaid exposure.
        const vaultUri = await persistRollFrame(storedPhoto, activeRoll.frameIds.length + 1)
        updatePhotoUri(photoId, vaultUri)
        captureUri = null
        addFrameToRoll(photoId)

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

      captureMetadata(locationGranularity)
        .then(async (meta) => {
          if (!meta.location) return
          setPhotoMeta(photoId, meta)
          if (activeMode === 'roll' && activeRoll !== null) {
            await updateStoredRollFrameMeta(activeRoll.id, photoId, meta)
          }
        })
        .catch(() => {})
    } catch (error) {
      deleteCapture(captureUri)
      if (createdPhotoId) removePhoto(createdPhotoId)
      console.error('Failed to capture photo:', error)
      Alert.alert(
        'Photo not added',
        'Capture or film processing could not be verified. No frame was queued. Please try again.',
      )
    } finally {
      if (usingTorchForFlash) setTorchActive(false)
      setIsCapturing(false)
    }
  }, [
    flash,
    isCapturing,
    addPhoto,
    supportsFlash,
    supportsTorch,
    activeMode,
    activeRoll,
    addFrameToRoll,
    setAction,
    setPhotoMeta,
    updatePhotoUri,
    removePhoto,
    effectiveAspect,
    shutterFlashAnim,
    rollIsFull,
    developRoll,
    mintRoll,
    locationGranularity,
    effectiveFilm,
    filmCatalogue,
    canCapture,
    cameraRef,
  ])

  const toggleFlash = useCallback(() => {
    if (!supportsFlash) return
    setFlash((prev) => (prev === 'off' ? 'on' : 'off'))
  }, [supportsFlash])

  const toggleCamera = useCallback(() => {
    invalidateCamera()
    setCameraPosition((prev) => (prev === 'back' ? 'front' : 'back'))
    if (flash === 'on') {
      setFlash('off')
    }
  }, [flash, invalidateCamera])

  // Manual ISO+shutter together (fullyManual, i.e. AE_MODE_OFF) dominates the
  // visual result — leaving EV bias "active" underneath it is a confusing
  // extra dial with no visible effect, so zero it out the moment both go
  // manual. EV bias and metering both still function during a single-axis
  // priority mode (ISO-priority or shutter-priority), since AE_MODE stays ON
  // in those states — only disabled here for the fully-manual case.
  useEffect(() => {
    if (manualCamera.fullyManual) setEv(0)
  }, [manualCamera.fullyManual])

  const handleStartCrank = useCallback(async () => {
    if (!cameraRef.current || isCapturing || isCrankingRef.current || !canCapture()) return

    if (!isFilmStockDownloaded(effectiveFilm.filmStockId)) {
      const stock = filmCatalogue.find((item) => item.filmStockId === effectiveFilm.filmStockId)
      if (!stock) {
        Alert.alert('Film recipe missing', 'Reconnect and refresh the Film Shelf before shooting this film.')
        return
      }
      try {
        await ensureFilmStockRecipe(stock)
      } catch {
        Alert.alert('Connect to download', `${stock.displayName} must be downloaded before this shot can be processed.`)
        return
      }
    }

    if (activeRoll?.developed || rollIsFull) {
      Alert.alert('Roll Complete', 'Every frame on this roll is shot. Mint the roll to see them.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Mint Roll', onPress: () => mintRoll() },
      ])
      return
    }

    isCrankingRef.current = true
    didCrankRef.current = true
    setIsCranking(true)
    setCrankCount(0)

    const rawSnapshots: string[] = []
    const isRoll = activeMode === 'roll' && activeRoll !== null
    const maxRollFrames = activeRoll ? activeRoll.size - activeRoll.frameIds.length : 36
    const kinoSeqId = `kino-${Date.now()}`

    // Initial mechanical crank pulse
    Vibration.vibrate(30)

    const targetIntervalMs = CAPTURE_CADENCE_MS[captureFps] ?? 0

    try {
      while (isCrankingRef.current) {
        if (isRoll && rawSnapshots.length >= maxRollFrames) {
          break
        }
        if (rawSnapshots.length >= 36) {
          break
        }

        const frameStart = performance.now()
        const photo = await cameraRef.current.takeSnapshot({ quality: 85 })
        rawSnapshots.push(photo.path)
        setCrankCount(rawSnapshots.length)
        // Mechanical gear-tooth tactile feedback
        Vibration.vibrate(20)

        if (targetIntervalMs > 0) {
          const snapElapsed = performance.now() - frameStart
          const remainingDelay = Math.max(0, targetIntervalMs - snapElapsed)
          if (remainingDelay > 0 && isCrankingRef.current) {
            await new Promise((r) => setTimeout(r, remainingDelay))
          }
        } else {
          // Yield briefly for React batching and gesture polling
          await new Promise((r) => setTimeout(r, 10))
        }
      }
    } catch (err) {
      console.error('[Kino] burst capture error:', err)
    } finally {
      isCrankingRef.current = false
      setIsCranking(false)
    }

    // Develop captured Kino frames sequentially through verified film processor
    if (rawSnapshots.length > 0) {
      setKinoDevelopingCount(rawSnapshots.length)
      setIsCapturing(true)
      try {
        for (let i = 0; i < rawSnapshots.length; i++) {
          const rawPath = rawSnapshots[i]
          let captureUri: string | null = adoptTemporaryCapture(`file://${rawPath}`)

          if (effectiveAspect !== 'full') {
            captureUri = await cropToAspect(captureUri, effectiveAspect)
          }
          let receipt = await processFilm(captureUri, effectiveFilm)
          captureUri = receipt.outputUri
          captureUri = await ensureUnderCeiling(captureUri)
          receipt = await verifyCompressedFilmOutput(receipt, captureUri)

          const photoId = addPhoto(
            receipt.outputUri,
            isRoll && activeRoll !== null
              ? { id: activeRoll.id, name: activeRoll.name, frameNumber: activeRoll.frameIds.length + 1 }
              : undefined,
            effectiveAspect,
            receipt.filmStockId,
            {
              mime: receipt.mime,
              byteLength: receipt.byteLength,
              width: receipt.width,
              height: receipt.height,
              imageHash: receipt.outputSha256,
              renderer: receipt.renderer,
              recipeSha256: receipt.recipeSha256,
              lutSha256: receipt.lutSha256,
            },
            { id: kinoSeqId, index: i },
          )

          if (isRoll && activeRoll !== null) {
            setAction(photoId, 'mint')
            const storedPhoto = usePhotoStore.getState().photos.find((candidate) => candidate.id === photoId)
            if (!storedPhoto) throw new Error('The captured roll frame could not be registered.')

            const vaultUri = await persistRollFrame(storedPhoto, activeRoll.frameIds.length + 1)
            updatePhotoUri(photoId, vaultUri)
            addFrameToRoll(photoId)
          }
        }

        if (isRoll && activeRoll && activeRoll.frameIds.length >= activeRoll.size) {
          developRoll()
          Alert.alert('Roll Complete! 🎞️', `All ${activeRoll.size} frames are shot. Mint the roll?`, [
            { text: 'Later', style: 'cancel' },
            { text: 'Mint Roll', onPress: () => mintRoll() },
          ])
        }
      } catch (err) {
        console.error('[Kino] failed to develop frames:', err)
        Alert.alert('Error', 'Failed to develop some Kino frames.')
      } finally {
        setKinoDevelopingCount(null)
        setIsCapturing(false)
      }
    }
  }, [
    activeMode,
    activeRoll,
    addFrameToRoll,
    addPhoto,
    canCapture,
    cameraRef,
    captureFps,
    developRoll,
    effectiveAspect,
    effectiveFilm,
    filmCatalogue,
    isCapturing,
    mintRoll,
    rollIsFull,
    setAction,
    updatePhotoUri,
  ])

  const handleShutterPressIn = useCallback(() => {
    if (isCapturing || !controlsReady || rollIsFull || activeRoll?.developed || kinoDevelopingCount !== null) return
    didCrankRef.current = false
    crankHoldTimer.current = setTimeout(() => {
      handleStartCrank()
    }, 280)
  }, [isCapturing, controlsReady, rollIsFull, activeRoll?.developed, kinoDevelopingCount, handleStartCrank])

  const handleShutterPressOut = useCallback(() => {
    if (crankHoldTimer.current) {
      clearTimeout(crankHoldTimer.current)
      crankHoldTimer.current = null
    }
    if (isCrankingRef.current) {
      isCrankingRef.current = false
    }
  }, [])

  const handleShutterPress = useCallback(() => {
    if (didCrankRef.current) {
      didCrankRef.current = false
      return
    }
    handleCapture()
  }, [handleCapture])

  // Viewfinder Touch & Reticle Handlers
  const handleViewfinderPressIn = useCallback(
    (event: GestureResponderEvent) => {
      // If already locked or separate AE mode is active, do not start hold-to-lock timer
      if (manualCamera.lockMode !== 'none' || isSeparated) return

      const touchX = typeof event.nativeEvent.pageX === 'number' ? event.nativeEvent.pageX : event.nativeEvent.locationX
      const touchY = typeof event.nativeEvent.pageY === 'number' ? event.nativeEvent.pageY : event.nativeEvent.locationY
      clearFadeTimer()
      setFocusPoint({ x: touchX, y: touchY })
      setExposurePoint({ x: touchX, y: touchY })
      focusOpacity.setValue(1)
      holdProgress.setValue(0)
      setIsHoldingFocus(true)
      isLockedRef.current = false

      // Animate hold progress bar over 1200ms
      holdAnimRef.current = Animated.timing(holdProgress, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: false,
      })
      holdAnimRef.current.start()

      // Set lock timer for 1200ms
      holdTimerRef.current = setTimeout(() => {
        isLockedRef.current = true
        setIsHoldingFocus(false)
        manualCamera.lock(
          'AF/AE',
          { x: touchX / screenW, y: touchY / screenH },
          { x: touchX / screenW, y: touchY / screenH },
        )
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        if (cameraRef.current && activeDevice?.supportsFocus) {
          cameraRef.current.focus({ x: touchX, y: touchY }).catch(() => {})
        }
      }, 1200)
    },
    [manualCamera, isSeparated, clearFadeTimer, focusOpacity, holdProgress, screenW, screenH, activeDevice, cameraRef],
  )

  const handleViewfinderPressOut = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdAnimRef.current) {
      holdAnimRef.current.stop()
    }
    holdProgress.setValue(0)
    setIsHoldingFocus(false)
  }, [holdProgress])

  const handleViewfinderPress = useCallback(
    async (event: GestureResponderEvent) => {
      if (isLockedRef.current) {
        isLockedRef.current = false
        return
      }

      const touchX = typeof event.nativeEvent.pageX === 'number' ? event.nativeEvent.pageX : event.nativeEvent.locationX
      const touchY = typeof event.nativeEvent.pageY === 'number' ? event.nativeEvent.pageY : event.nativeEvent.locationY

      if (isSeparated) {
        const normX = Math.max(0, Math.min(1, touchX / screenW))
        const normY = Math.max(0, Math.min(1, touchY / screenH))
        setExposurePoint({ x: touchX, y: touchY })
        manualCamera.setExposurePoint({ x: normX, y: normY })
        setHasPlacedAe(true)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        clearFadeTimer()
        focusOpacity.setValue(1)
        return
      }

      if (manualCamera.lockMode !== 'none') {
        manualCamera.unlock()
        setIsSeparated(false)
        setHasPlacedAe(false)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        clearFadeTimer()
        Animated.timing(focusOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setFocusPoint(null)
          setExposurePoint(null)
        })
        return
      }

      // Quick tap: focus & meter at target point with 1.5s auto fade
      setFocusPoint({ x: touchX, y: touchY })
      setExposurePoint({ x: touchX, y: touchY })
      setIsSeparated(false)
      setHasPlacedAe(false)
      manualCamera.setMeteringPoint({ x: touchX / screenW, y: touchY / screenH })

      clearFadeTimer()
      focusOpacity.setValue(1)

      fadeTimeoutRef.current = setTimeout(() => {
        Animated.timing(focusOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setFocusPoint(null)
          setExposurePoint(null)
        })
      }, 1500)

      if (cameraRef.current && activeDevice?.supportsFocus) {
        try {
          await cameraRef.current.focus({ x: touchX, y: touchY })
        } catch {
          // Ignore focus canceled
        }
      }
    },
    [manualCamera, isSeparated, screenW, screenH, clearFadeTimer, focusOpacity, activeDevice, cameraRef],
  )

  const handleCycleLock = useCallback(() => {
    manualCamera.cycleLockMode()
    Haptics.selectionAsync()
  }, [manualCamera])

  const handleToggleSeparate = useCallback(() => {
    setIsSeparated((prev) => {
      const next = !prev
      if (next && focusPoint) {
        setHasPlacedAe(false)
        if (manualCamera.lockMode === 'none') {
          manualCamera.lock(
            'AF/AE',
            { x: focusPoint.x / screenW, y: focusPoint.y / screenH },
            { x: focusPoint.x / screenW, y: focusPoint.y / screenH },
          )
        }
        setExposurePoint(focusPoint)
        manualCamera.setExposurePoint({ x: focusPoint.x / screenW, y: focusPoint.y / screenH })
      } else if (!next && focusPoint) {
        setExposurePoint(focusPoint)
        manualCamera.setExposurePoint(null)
        setHasPlacedAe(false)
      }
      return next
    })
    Haptics.selectionAsync()
  }, [focusPoint, screenW, screenH, manualCamera])

  const handleFocusPointChange = useCallback(
    (pt: { x: number; y: number }) => {
      setFocusPoint(pt)
      manualCamera.setLockPoint({ x: pt.x / screenW, y: pt.y / screenH })
      if (!isSeparated) {
        setExposurePoint(pt)
        manualCamera.setExposurePoint(null)
      }
      clearFadeTimer()
      focusOpacity.setValue(1)
    },
    [manualCamera, screenW, screenH, isSeparated, clearFadeTimer, focusOpacity],
  )

  const handleExposurePointChange = useCallback(
    (pt: { x: number; y: number }) => {
      setExposurePoint(pt)
      manualCamera.setExposurePoint({ x: pt.x / screenW, y: pt.y / screenH })
      setHasPlacedAe(true)
      clearFadeTimer()
      focusOpacity.setValue(1)
    },
    [manualCamera, screenW, screenH, clearFadeTimer, focusOpacity],
  )

  const handleUnlock = useCallback(() => {
    manualCamera.unlock()
    setIsSeparated(false)
    setHasPlacedAe(false)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    clearFadeTimer()
    Animated.timing(focusOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setFocusPoint(null)
      setExposurePoint(null)
    })
  }, [manualCamera, clearFadeTimer, focusOpacity])

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
      if (__DEV__) console.log('[wallet] authorization completed; awaiting stable account state')
    } catch (error) {
      console.error('Failed to connect wallet:', error)
    }
  }, [connect])

  // Opening the dropdown is the acknowledgement: the feature is visible in
  // the menu at that point, so the ambient dot clears immediately and forever.
  const handleOpenWalletMenu = useCallback(() => {
    setWalletMenuVisible(true)
    acknowledgeContactSheet()
  }, [acknowledgeContactSheet])

  const handleOpenHistory = useCallback(() => {
    setWalletMenuVisible(false)
    router.push('/past-mints')
  }, [router])

  const handleOpenContactSheet = useCallback(() => {
    setWalletMenuVisible(false)
    router.push('/contact-sheet')
  }, [router])

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

  if (!captureFormat) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}
      >
        <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.text, textAlign: 'center' }}>
          This camera has no photo format inside the supported 12 MP processing envelope.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GestureDetector gesture={pinchGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={handleViewfinderPressIn}
            onPressOut={handleViewfinderPressOut}
            onPress={handleViewfinderPress}
          >
            <Camera
              ref={cameraReadiness.ref}
              style={StyleSheet.absoluteFill}
              device={activeDevice}
              format={captureFormat}
              isActive={isFocused && appActive}
              onInitialized={cameraReadiness.onInitialized}
              onStarted={cameraReadiness.onStarted}
              onStopped={cameraReadiness.onStopped}
              onError={cameraReadiness.onError}
              photo={true}
              photoHdr={false}
              zoom={zoom}
              exposure={ev}
              torch={torchActive ? 'on' : 'off'}
              outputOrientation="device"
              onUIRotationChanged={handleUIRotationChanged}
              onOutputOrientationChanged={handleOutputOrientationChanged}
            />

            {/* Aspect-ratio framing guide */}
            <AspectFramingOverlay aspect={effectiveAspect} width={screenW} height={screenH} />

            {/* Composition grid overlay */}
            <CompositionGridOverlay mode={gridMode} aspect={effectiveAspect} width={screenW} height={screenH} />

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
          </Pressable>

          {/* Focus and Separated Exposure Reticles */}
          {focusPoint && (
            <FocusReticle
              focusPoint={focusPoint}
              exposurePoint={exposurePoint}
              isSeparated={isSeparated}
              isAePlaced={hasPlacedAe}
              lockMode={manualCamera.lockMode}
              isHolding={isHoldingFocus}
              holdProgress={holdProgress}
              ev={ev}
              minExposure={minExposure}
              maxExposure={maxExposure}
              onEvChange={(newEv) => {
                setEv(newEv)
                clearFadeTimer()
                focusOpacity.setValue(1)
                if (manualCamera.lockMode === 'none') {
                  fadeTimeoutRef.current = setTimeout(() => {
                    Animated.timing(focusOpacity, {
                      toValue: 0,
                      duration: 300,
                      useNativeDriver: true,
                    }).start(() => {
                      setFocusPoint(null)
                      setExposurePoint(null)
                    })
                  }, 2000)
                }
              }}
              onCycleLock={handleCycleLock}
              onToggleSeparate={handleToggleSeparate}
              onUnlock={handleUnlock}
              onFocusPointChange={handleFocusPointChange}
              onExposurePointChange={handleExposurePointChange}
              opacity={focusOpacity}
              screenW={screenW}
              screenH={screenH}
              uiRotationAnim={uiRotationAnim}
            />
          )}
        </View>
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
        pointerEvents="box-none"
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
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={toggleFlash}
            disabled={!supportsFlash}
            style={[roundChip(42), { opacity: supportsFlash ? 1 : 0.4 }]}
          >
            <Animated.View style={hudRotateStyle}>
              {flash === 'on' && supportsFlash ? (
                <IconBolt size={19} color={colors.text} />
              ) : (
                <IconBoltOff size={19} color={colors.text} />
              )}
            </Animated.View>
          </Pressable>

          <Pressable
            onPress={() => setLocationMenuVisible(true)}
            style={[roundChip(42), { opacity: locationGranularity === 'off' ? 0.4 : 1 }]}
          >
            <Animated.View style={hudRotateStyle}>
              <IconPin size={19} color={locationGranularity === 'off' ? colors.text : colors.accent} />
            </Animated.View>
          </Pressable>

          <Pressable
            onPress={toggleGrid}
            accessibilityRole="button"
            accessibilityLabel={`Composition Grid: ${gridMode}`}
            style={[
              roundChip(42),
              {
                borderColor: gridMode !== 'off' ? colors.accent : colors.chipBorder,
                backgroundColor: gridMode !== 'off' ? colors.accentTint : colors.chipBg,
              },
            ]}
          >
            <Animated.View style={hudRotateStyle}>
              <IconGrid size={18} color={gridMode !== 'off' ? colors.accentSoft : colors.text} />
            </Animated.View>
          </Pressable>

          <Pressable
            onPress={() => setProOpen((o) => !o)}
            style={[
              chip,
              {
                height: 42,
                paddingHorizontal: 14,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
                borderColor: proOpen ? colors.accent : colors.chipBorder,
                backgroundColor: proOpen ? colors.accentTint : colors.chipBg,
              },
            ]}
          >
            <Animated.View style={hudRotateStyle}>
              <Text
                style={{
                  fontFamily: fonts.sansBold,
                  fontSize: 11,
                  letterSpacing: tracking(0.1, 11),
                  color: proOpen ? colors.accentSoft : colors.text,
                }}
              >
                PRO
              </Text>
            </Animated.View>
          </Pressable>
        </View>

        {account && walletAddress ? (
          <Pressable
            onPress={handleOpenWalletMenu}
            accessibilityRole="button"
            accessibilityLabel={showContactSheetNudge ? 'Wallet menu, new contact sheet feature' : 'Wallet menu'}
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
            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.textSoft, marginLeft: 2 }}>▼</Text>
            {showContactSheetNudge && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: -3,
                  right: -3,
                  width: 11,
                  height: 11,
                  borderRadius: 6,
                  backgroundColor: colors.yellow,
                  borderWidth: 2,
                  borderColor: colors.bg,
                }}
              />
            )}
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

      {/* Second row — mode chip · Kino cadence selector · aspect selector / EXP dial */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 74,
          left: 18,
          right: 18,
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          zIndex: 20,
        }}
      >
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          {/* Mode & Film selection chip */}
          <Pressable
            onPress={() => router.push('/mode-select')}
            style={[
              chip,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 7,
                paddingHorizontal: 11,
                borderRadius: 10,
              },
            ]}
          >
            <Animated.View style={hudRotateStyle}>
              {activeMode === 'roll' ? (
                <IconFilm size={15} color={colors.text} />
              ) : (
                <IconCamera size={15} color={colors.text} />
              )}
            </Animated.View>
            <Animated.Text
              style={[
                {
                  fontFamily: fonts.sansBold,
                  fontSize: 11,
                  letterSpacing: tracking(0.1, 11),
                  color: colors.text,
                },
                hudRotateStyle,
              ]}
            >
              {activeMode === 'roll' ? 'FILM' : 'QUICK'}
            </Animated.Text>
            {activeMode === 'roll' && activeRoll !== null && (
              <>
                <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <Animated.Text
                  style={[{ fontFamily: fonts.mono, fontSize: 9, color: colors.textSoft }, hudRotateStyle]}
                  numberOfLines={1}
                >
                  {effectiveFilmName.toUpperCase()}
                </Animated.Text>
                {activeRoll.aspect !== 'full' && (
                  <Animated.Text
                    style={[{ fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft }, hudRotateStyle]}
                  >
                    {activeRoll.aspect}
                  </Animated.Text>
                )}
              </>
            )}
            {activeMode === 'quick' && (
              <>
                <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <Animated.Text
                  style={[{ fontFamily: fonts.mono, fontSize: 9, color: colors.textSoft }, hudRotateStyle]}
                  numberOfLines={1}
                >
                  {effectiveFilmName.toUpperCase()}
                </Animated.Text>
              </>
            )}
          </Pressable>

          {/* Kino Cadence Selector Chip */}
          <Pressable
            onPress={() => {
              cycleCaptureFps()
              Vibration.vibrate(25)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Kino Frame Rate: ${captureFps} FPS`}
            style={[
              chip,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingVertical: 7,
                paddingHorizontal: 10,
                borderRadius: 10,
              },
            ]}
          >
            <Animated.Text
              style={[
                {
                  fontFamily: fonts.monoBold,
                  fontSize: 10,
                  color: colors.accentSoft,
                  letterSpacing: 0.5,
                },
                hudRotateStyle,
              ]}
            >
              🎞️ {captureFps === 8 ? '8 FPS · F5' : `${captureFps} FPS`}
            </Animated.Text>
          </Pressable>
        </View>

        {/* Right side: EXP dial (in Roll mode) or Aspect dropdown (in Quick mode) */}
        {activeMode === 'roll' && activeRoll !== null && (
          <View style={[roundChip(52), { borderColor: 'rgba(255,255,255,0.16)' }]}>
            <Animated.Text
              style={[{ fontFamily: fonts.monoBold, fontSize: 18, lineHeight: 20, color: colors.text }, hudRotateStyle]}
            >
              {remainingExp}
            </Animated.Text>
            <Animated.Text
              style={[
                {
                  fontFamily: fonts.mono,
                  fontSize: 7,
                  letterSpacing: tracking(0.18, 7),
                  color: colors.accentSoft,
                  marginTop: 1,
                },
                hudRotateStyle,
              ]}
            >
              EXP
            </Animated.Text>
          </View>
        )}

        {activeMode === 'quick' && (
          <View pointerEvents="box-none" style={{ alignItems: 'flex-end' }}>
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
              <Animated.Text style={[{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.text }, hudRotateStyle]}>
                {quickAspectLabel}
              </Animated.Text>
              <Animated.Text style={[{ fontFamily: fonts.mono, fontSize: 8, color: colors.textSoft }, hudRotateStyle]}>
                {aspectMenuOpen ? '▲' : '▼'}
              </Animated.Text>
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
                    <Animated.Text
                      style={[
                        {
                          fontFamily: fonts.mono,
                          fontSize: 11,
                          color: colors.textSoft,
                          textAlign: 'center',
                        },
                        hudRotateStyle,
                      ]}
                    >
                      {label}
                    </Animated.Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Pro mode strip — persistent M · ISO · S · EV · WB · AF value strip
          pinned above the shutter row, one parameter expanded at a time.
          See ManualControls.tsx for the design source and the adjustments
          made from it for this camera's real (coupled) exposure model. */}
      {proOpen && TIER2_ENABLED && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 150 }}>
          <ManualControls
            controls={manualCamera}
            ev={ev}
            setEv={setEv}
            minExposure={minExposure}
            maxExposure={maxExposure}
            uiRotationAnim={uiRotationAnim}
          />
        </View>
      )}

      {/* LomoKino Active Cranking HUD */}
      {isCranking && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 155,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'rgba(25, 20, 10, 0.92)',
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: '#f39c12',
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e74c3c' }} />
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 12, color: '#fff' }}>
              🎞️ KINO CRANKING ({captureFps === 8 ? '8 FPS · F5' : `${captureFps} FPS`}) · {crankCount} FRAMES (
              {(crankCount / captureFps).toFixed(1)}s)
            </Text>
          </View>
        </View>
      )}

      {/* LomoKino Developing Banner */}
      {kinoDevelopingCount !== null && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 155,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: 'rgba(10, 10, 15, 0.94)',
              paddingHorizontal: 18,
              paddingVertical: 9,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.accent,
            }}
          >
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.text }}>
              DEVELOPING {kinoDevelopingCount} KINO FRAMES...
            </Text>
          </View>
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
        {isCapturing && manualCamera.shutterMode === 'manual' && manualCamera.manualShutterNs >= 500_000_000 && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 8,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                backgroundColor: 'rgba(15,15,20,0.88)',
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.accentSoft,
              }}
            >
              <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.accentSoft, letterSpacing: 0.8 }}>
                {`HOLD STILL · EXPOSING ${(manualCamera.manualShutterNs / 1e9).toFixed(1)}s`}
              </Text>
            </View>
          </View>
        )}

        <Pressable onPress={toggleCamera} style={roundChip(44)}>
          <Animated.View style={hudRotateStyle}>
            <IconFlip size={20} color={colors.text} />
          </Animated.View>
        </Pressable>

        <View style={{ alignItems: 'center' }}>
          <Pressable
            onPressIn={handleShutterPressIn}
            onPressOut={handleShutterPressOut}
            onPress={handleShutterPress}
            disabled={isCapturing || !controlsReady}
            style={{
              width: 82,
              height: 82,
              borderRadius: 41,
              borderWidth: isCranking ? 3 : 2,
              borderColor: isCranking ? '#f39c12' : colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isCapturing || !controlsReady || rollIsFull || activeRoll?.developed ? 0.5 : 1,
              transform: [{ scale: isCranking ? 1.08 : 1 }],
            }}
          >
            {isCranking && (
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 92,
                  height: 92,
                  borderRadius: 46,
                  borderWidth: 2,
                  borderColor: '#f39c12',
                  borderStyle: 'dashed',
                  transform: [
                    {
                      rotate: crankAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                }}
              />
            )}
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: isCranking ? '#d35400' : colors.text,
                borderWidth: 4,
                borderColor: 'rgba(12,13,22,0.35)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isCranking ? (
                <Animated.Text style={[{ fontFamily: fonts.monoBold, fontSize: 16, color: '#fff' }, hudRotateStyle]}>
                  {crankCount}
                </Animated.Text>
              ) : null}
            </View>
          </Pressable>
          {/* Shutter sub-label: shows current mode and speed, tapping cycles capture FPS */}
          <Pressable
            onPress={() => {
              if (!isCranking) {
                cycleCaptureFps()
                Vibration.vibrate(25)
              }
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Kino Frame Rate: ${captureFps} FPS`}
          >
            <Animated.View
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  marginTop: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderWidth: 1,
                  borderColor: isCranking ? '#f39c12' : 'rgba(255, 255, 255, 0.16)',
                  opacity: uiRotation === 0 ? 1 : 0,
                },
                hudRotateStyle,
              ]}
            >
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 8,
                  letterSpacing: tracking(0.12, 8),
                  color: isCranking ? '#f39c12' : colors.textSoft,
                }}
              >
                {isCranking ? 'CRANKING' : `HOLD FOR KINO · ${captureFps === 8 ? '8 FPS (F5)' : `${captureFps} FPS`}`}
              </Text>
            </Animated.View>
          </Pressable>
        </View>

        {/* Quick mode only — a roll's frames mint as a whole roll, not here */}
        {activeMode === 'roll' ? (
          <View style={{ width: 44, height: 44 }} />
        ) : (
          <View style={{ alignItems: 'center', gap: 5 }}>
            <Pressable onPress={handleReview} style={roundChip(44)}>
              <Animated.View style={hudRotateStyle}>
                <IconMint size={20} color={colors.text} strokeWidth={1.5} />
              </Animated.View>
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
            <Animated.Text
              style={[
                {
                  fontFamily: fonts.mono,
                  fontSize: 9,
                  letterSpacing: tracking(0.14, 9),
                  color: colors.textSoft,
                },
                hudRotateStyle,
              ]}
            >
              MINT
            </Animated.Text>
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
              {walletAddress ? formatWalletDisplay(walletAddress, domain) : ''}
            </Text>
          </View>

          <Pressable
            onPress={handleOpenHistory}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 56,
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: pressed ? colors.accentTint : colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            })}
          >
            <IconGallery size={18} color={colors.textSecondary} />
            <Text style={{ flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.text }}>History</Text>
          </Pressable>

          <Pressable
            onPress={handleOpenContactSheet}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 62,
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: pressed ? colors.accentTint : colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            })}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.accentTint,
              }}
            >
              <IconFilm size={18} color={colors.accentSoft} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.text }}>
                Create Contact Sheet
              </Text>
              <Text style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                Export minted frames as an image
              </Text>
            </View>
          </Pressable>

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
                <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.text }}>{option.label}</Text>
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

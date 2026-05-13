import { useState, useRef, useCallback, useEffect } from 'react'
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
} from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  PhotoFile,
} from 'react-native-vision-camera'
import {
  Gesture,
  GestureDetector,
  GestureUpdateEvent,
  PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler'
import { Paths, File, Directory } from 'expo-file-system'
import { usePhotoStore } from '../store/photos'
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'
import { useNetworkStore } from '../store/network'
import { useSessionStore } from '../store/session'

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

  const photos = usePhotoStore((state) => state.photos)
  const addPhoto = usePhotoStore((state) => state.addPhoto)
  const setAction = usePhotoStore((state) => state.setAction)

  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const cluster = useNetworkStore((s) => s.cluster)
  const setCluster = useNetworkStore((s) => s.setCluster)

  const activeMode = useSessionStore((s) => s.activeMode)
  const activeRoll = useSessionStore((s) => s.activeRoll)
  const addFrameToRoll = useSessionStore((s) => s.addFrameToRoll)

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

      const photoId = addPhoto(destFile.uri)

      // In roll mode: register frame and auto-mark for minting
      if (activeMode === 'roll' && activeRoll !== null) {
        addFrameToRoll(photoId)
        setAction(photoId, 'mint')
      }
    } catch (error) {
      console.error('Failed to capture photo:', error)
      Alert.alert('Error', 'Failed to capture photo. Please try again.')
    } finally {
      setIsCapturing(false)
    }
  }, [flash, isCapturing, addPhoto, supportsFlash, activeMode, activeRoll, addFrameToRoll, setAction, shutterFlashAnim])

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
    [activeDevice, focusOpacity]
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
    if (photos.length === 0) {
      Alert.alert('No Photos', 'Take some photos first before reviewing.')
      return
    }
    router.push('/review')
  }, [photos.length, router])

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

  const handleToggleNetwork = useCallback(async () => {
    setWalletMenuVisible(false)
    const next = cluster === 'mainnet' ? 'devnet' : 'mainnet'
    if (account) {
      try {
        await disconnect()
      } catch {
        // continue regardless
      }
    }
    setCluster(next)
  }, [cluster, account, disconnect, setCluster])

  if (!hasPermission) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
        <Text className="text-white text-xl text-center mb-4">
          Camera permission is required
        </Text>
        <Pressable
          onPress={() => Linking.openSettings()}
          className="bg-purple-600 px-6 py-3 rounded-xl"
        >
          <Text className="text-white font-bold">Open Settings</Text>
        </Pressable>
      </View>
    )
  }

  if (!activeDevice) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <Text className="text-white text-xl">No camera device found</Text>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-black">
      <GestureDetector gesture={pinchGesture}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleFocus}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={activeDevice}
            isActive={true}
            photo={true}
            zoom={zoom}
          />

          {/* Shutter Flash Overlay */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: '#000', opacity: shutterFlashAnim },
            ]}
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
                borderWidth: 2,
                borderColor: '#FFD700',
                borderRadius: 8,
                opacity: focusOpacity,
              }}
            />
          )}
        </Pressable>
      </GestureDetector>

      {/* Zoom Indicator */}
      {zoom > 1.1 && (
        <View className="absolute top-1/2 right-4 bg-black/60 px-3 py-1 rounded-full">
          <Text className="text-white text-sm font-bold">{zoom.toFixed(1)}x</Text>
        </View>
      )}

      {/* Top Controls */}
      <View className="absolute top-12 left-0 right-0 flex-row justify-between items-center px-6">
        {/* Flash Toggle */}
        <Pressable
          onPress={toggleFlash}
          disabled={!supportsFlash}
          className={`w-12 h-12 rounded-full items-center justify-center ${
            supportsFlash ? 'bg-black/50' : 'bg-black/30'
          }`}
          style={{ opacity: supportsFlash ? 1 : 0.4 }}
        >
          {supportsFlash ? (
            <Text className="text-xl">{flash === 'on' ? '⚡' : '✕'}</Text>
          ) : (
            <Text className="text-gray-500 text-xl">⚡</Text>
          )}
        </Pressable>

        {/* Wallet Status — tappable when connected */}
        {account && walletAddress ? (
          <Pressable
            onPress={() => setWalletMenuVisible(true)}
            className="bg-green-600/80 px-4 py-2 rounded-full flex-row items-center gap-2"
          >
            {cluster === 'devnet' && (
              <View className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            )}
            <Text className="text-white text-sm font-medium">
              {formatWalletDisplay(walletAddress, domain)}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConnectWallet}
            className="bg-purple-600 px-4 py-2 rounded-full"
          >
            <Text className="text-white text-sm font-bold">Connect Wallet</Text>
          </Pressable>
        )}

        {/* Camera Flip */}
        <Pressable
          onPress={toggleCamera}
          className="w-12 h-12 bg-black/50 rounded-full items-center justify-center"
        >
          <Text className="text-white text-xl">🔄</Text>
        </Pressable>
      </View>

      {/* Mode Indicator Chip */}
      <Pressable
        onLongPress={() => {
          if (activeRoll !== null) {
            Alert.alert('Roll in progress', 'Develop or abandon the roll before switching modes.')
          } else {
            router.push('/mode-select')
          }
        }}
        className="absolute top-28 left-6 flex-row items-center gap-1.5 bg-black/60 px-3 py-1.5 rounded-full"
      >
        <Text className="text-base">{activeMode === 'quick' ? '⚡' : '🎞️'}</Text>
        {activeMode === 'roll' && activeRoll !== null && (
          <Text className="text-white text-xs font-medium">
            {activeRoll.frameIds.length} / {activeRoll.size}
          </Text>
        )}
      </Pressable>

      {/* Bottom Controls */}
      <View className="absolute bottom-12 left-0 right-0 flex-row justify-center items-center gap-8">
        {/* Gallery/Review Button */}
        <Pressable
          onPress={handleReview}
          className="w-16 h-16 bg-white/20 rounded-2xl items-center justify-center"
        >
          {photos.length > 0 && (
            <View className="absolute -top-2 -right-2 bg-purple-600 w-6 h-6 rounded-full items-center justify-center">
              <Text className="text-white text-xs font-bold">{photos.length}</Text>
            </View>
          )}
          <Text className="text-white text-2xl">🖼️</Text>
        </Pressable>

        {/* Capture Button */}
        <Pressable
          onPress={handleCapture}
          disabled={isCapturing}
          className="w-20 h-20 bg-white rounded-full items-center justify-center border-4 border-purple-600"
          style={{ opacity: isCapturing ? 0.5 : 1 }}
        >
          <View className="w-16 h-16 bg-white rounded-full" />
        </Pressable>

        {/* Mint Button */}
        <Pressable
          onPress={handleReview}
          disabled={photos.length === 0}
          className="w-16 h-16 bg-purple-600 rounded-2xl items-center justify-center"
          style={{ opacity: photos.length === 0 ? 0.5 : 1 }}
        >
          <Text className="text-white text-sm font-bold">MINT</Text>
        </Pressable>
      </View>

      {/* Wallet Menu Modal */}
      <Modal
        visible={walletMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWalletMenuVisible(false)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          className="bg-black/70"
          onPress={() => setWalletMenuVisible(false)}
        />
        <View
          style={{ position: 'absolute', top: '30%', left: 24, right: 24 }}
          className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-700"
        >
          {/* Wallet Address */}
          <View className="px-5 py-4 border-b border-gray-700">
            <Text className="text-gray-400 text-xs mb-1">Connected Wallet</Text>
            <Text className="text-white text-sm font-mono" numberOfLines={1}>
              {walletAddress}
            </Text>
          </View>

          {/* Network Toggle */}
          <Pressable
            onPress={handleToggleNetwork}
            className="flex-row items-center justify-between px-5 py-4 border-b border-gray-700"
          >
            <View className="flex-row items-center gap-3">
              <View
                className={`w-2.5 h-2.5 rounded-full ${cluster === 'devnet' ? 'bg-yellow-400' : 'bg-green-400'}`}
              />
              <Text className="text-white font-medium">
                {cluster === 'devnet' ? 'Devnet' : 'Mainnet'}
              </Text>
            </View>
            <Text className="text-purple-400 text-sm">
              Switch to {cluster === 'devnet' ? 'Mainnet' : 'Devnet'}
            </Text>
          </Pressable>

          {/* Disconnect */}
          <Pressable onPress={handleDisconnect} className="px-5 py-4 border-b border-gray-700">
            <Text className="text-red-400 font-medium text-center">Disconnect Wallet</Text>
          </Pressable>

          {/* Close */}
          <Pressable onPress={() => setWalletMenuVisible(false)} className="px-5 py-4">
            <Text className="text-gray-400 text-center">Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

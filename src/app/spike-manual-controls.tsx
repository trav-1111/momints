// ============================================================================
// TIER 2 — verification screen for independent ISO/shutter/focus auto-manual
// toggles. Not part of the product surface, not linked from any nav. Reach
// it with:
//   adb shell am start -a android.intent.action.VIEW -d "momints://spike-manual-controls" com.momints.app
//
// Mounts the real src/components/ManualControls.tsx (the actual pro-mode
// panel, not a throwaway) against a live preview, so this doubles as both
// the on-device verification vehicle and a smoke test of the component
// before/alongside its use in camera.tsx.
// ============================================================================
import { useRef, useState } from 'react'
import { View, Text, StyleSheet, findNodeHandle } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import ManualControls from '../components/ManualControls'
import { useManualCameraState } from '../hooks/useManualCameraState'

export default function ManualControlsSpike() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)
  const viewTag = findNodeHandle(cameraRef.current)
  const maxFocusDiopters = device && device.minFocusDistance > 0 ? 100 / device.minFocusDistance : null
  const controls = useManualCameraState(viewTag, device?.id ?? null, maxFocusDiopters)
  const [ev, setEv] = useState(0)
  const minExposure = device?.minExposure ?? -2
  const maxExposure = device?.maxExposure ?? 2

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1} onPress={requestPermission}>
          Tap to grant camera permission
        </Text>
      </View>
    )
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>No camera device found</Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <Camera ref={cameraRef} style={StyleSheet.absoluteFill} device={device} isActive={true} />
      <View style={styles.hud}>
        <ManualControls controls={controls} ev={ev} setEv={setEv} minExposure={minExposure} maxExposure={maxExposure} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  h1: { color: '#fff', fontSize: 15, fontWeight: '700', padding: 20, textAlign: 'center' },
  hud: { position: 'absolute', left: 10, right: 10, bottom: 30 },
})

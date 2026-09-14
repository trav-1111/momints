// ============================================================================
// TIER 2 — DAY 2 verification screen. Not part of the product surface, not
// linked from any nav. Reach it with:
//   adb shell am start -a android.intent.action.VIEW -d "momints://spike-manual-controls" com.momints.app
//
// Mounts the real src/components/ManualControls.tsx (the actual pro-mode
// panel, not a throwaway) against a live preview, so this doubles as both
// the on-device verification vehicle for shutter + white balance and a
// smoke test of the component before it gets wired into camera.tsx.
// ============================================================================
import { useRef, useState } from 'react'
import { View, Text, StyleSheet, findNodeHandle } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import ManualControls from '../components/ManualControls'

export default function ManualControlsSpike() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)
  const [enabled, setEnabled] = useState(false)

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

  const viewTag = findNodeHandle(cameraRef.current)
  const maxFocusDiopters = device.minFocusDistance > 0 ? 100 / device.minFocusDistance : null

  return (
    <View style={styles.root}>
      <Camera ref={cameraRef} style={StyleSheet.absoluteFill} device={device} isActive={true} />
      <View style={styles.hud}>
        <ManualControls
          viewTag={viewTag}
          enabled={enabled}
          onToggleEnabled={setEnabled}
          maxFocusDiopters={maxFocusDiopters}
        />
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

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
import { useEffect, useState } from 'react'
import { AppState, View, Text, StyleSheet } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import ManualControls from '../components/ManualControls'
import { useManualCameraState } from '../hooks/useManualCameraState'
import { useCameraReadiness } from '../hooks/useCameraReadiness'

export default function ManualControlsSpike() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const focused = useIsFocused()
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const active = focused && appActive
  const readiness = useCameraReadiness(device?.id ?? null, active)
  const invalidate = readiness.invalidate
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') invalidate()
      setAppActive(state === 'active')
    })
    return () => subscription.remove()
  }, [invalidate])
  const maxFocusDiopters = device && device.minFocusDistance > 0 ? 100 / device.minFocusDistance : null
  const controls = useManualCameraState(readiness.session, device?.id ?? null, maxFocusDiopters, readiness.isCurrent)
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
      <Camera
        ref={readiness.ref}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        onInitialized={readiness.onInitialized}
        onStarted={readiness.onStarted}
        onStopped={readiness.onStopped}
        onError={readiness.onError}
      />
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

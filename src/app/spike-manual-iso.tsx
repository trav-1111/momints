// ============================================================================
// TIER 2 — DAY 1 GATE MICRO-SPIKE. Not part of the product surface, not
// linked from any nav. Reach it with:
//   adb shell am start -a android.intent.action.VIEW -d "momints://spike-manual-iso" com.momints.app
//
// Question: can we push manual ISO onto the LIVE react-native-vision-camera
// session via CameraX's Camera2Interop (modules/camera-manual), reached
// through reflection into vision-camera's internal CameraSession — without
// forking the library? And does it actually change the image, not just "not
// throw"?
//
// Test design: hold shutter speed constant (1/1000s — fast enough that a
// live 30fps-ish preview keeps updating, so we're not staring at a frozen
// frame) and only swing ISO between the device's confirmed min (100) and max
// (11470, from the capability spike) to isolate the ISO effect specifically,
// rather than conflating it with a shutter change.
// ============================================================================
import { useCallback, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, findNodeHandle } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { applyManualExposure, resetToAuto } from '../../modules/camera-manual'

const LOG_TAG = '[ManualIsoSpike]'
const SHUTTER_NS = 1_000_000 // 1/1000s — fixed, so only ISO varies

type Mode = 'auto' | 'dark' | 'bright'

export default function ManualIsoSpike() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)

  const [mode, setMode] = useState<Mode>('auto')
  const [status, setStatus] = useState('Not applied yet.')

  const getViewTag = useCallback((): number | null => {
    return findNodeHandle(cameraRef.current)
  }, [])

  const applyMode = useCallback(
    (next: Mode, iso: number | null) => {
      const tag = getViewTag()
      if (tag == null) {
        setStatus('ERROR: could not resolve camera view tag (findNodeHandle returned null).')
        console.log(LOG_TAG, 'findNodeHandle returned null')
        return
      }
      try {
        if (next === 'auto') {
          resetToAuto(tag)
          setStatus('Applied: AUTO (CONTROL_AE_MODE back ON).')
          console.log(LOG_TAG, 'resetToAuto() OK')
        } else {
          applyManualExposure(tag, iso, SHUTTER_NS)
          setStatus(`Applied: ISO ${iso}, shutter 1/1000s (AE_MODE forced OFF).`)
          console.log(LOG_TAG, `applyManualExposure(iso=${iso}, shutterNs=${SHUTTER_NS}) OK`)
        }
        setMode(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setStatus(`ERROR: ${message}`)
        console.log(LOG_TAG, 'ERROR', message)
      }
    },
    [getViewTag],
  )

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>Camera permission required</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant</Text>
        </Pressable>
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
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
      />

      <View style={styles.hud}>
        <Text style={styles.h1}>Manual ISO gate — Camera2Interop</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.hint}>
          Shutter fixed at 1/1000s throughout — only ISO changes between presets, so any
          brightness difference is attributable to ISO alone.
        </Text>

        <View style={styles.row}>
          <Pressable
            style={[styles.stepBtn, mode === 'auto' && styles.stepBtnActive]}
            onPress={() => applyMode('auto', null)}
          >
            <Text style={styles.btnText}>Auto (reset)</Text>
          </Pressable>
          <Pressable
            style={[styles.stepBtn, mode === 'dark' && styles.stepBtnActive]}
            onPress={() => applyMode('dark', 100)}
          >
            <Text style={styles.btnText}>ISO 100 (dark)</Text>
          </Pressable>
          <Pressable
            style={[styles.stepBtn, mode === 'bright' && styles.stepBtnActive]}
            onPress={() => applyMode('bright', 11470)}
          >
            <Text style={styles.btnText}>ISO 11470 (bright)</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Expected if this works: ISO 100 preset should look noticeably darker than ISO 11470 at
          the same 1/1000s shutter — roughly 100x sensor gain difference. Screenshot each preset
          and compare, same as the exposure-bias check in the capability spike.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 12 },
  hud: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 30,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    padding: 12,
  },
  row: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  stepBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  stepBtnActive: { backgroundColor: '#7d7bf0' },
  status: { color: '#fff', fontSize: 12, marginTop: 4, fontFamily: 'monospace' },
  hint: { color: '#9a9a9a', fontSize: 11, marginTop: 6 },
  h1: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btn: { backgroundColor: '#7d7bf0', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
})

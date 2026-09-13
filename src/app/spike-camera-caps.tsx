// ============================================================================
// THROWAWAY SPIKE — camera manual-control capability probe.
// Not part of the app's product surface. Not linked from any nav. Reach it
// with a deep link (see CAMERA_SPIKE_RESULT.md for the exact adb command).
// Answers: what does Camera2 report as available to a THIRD-PARTY app on
// this device, and which of those can react-native-vision-camera (the
// library already in this app) actually set.
// Safe to delete this whole branch once CAMERA_SPIKE_RESULT.md is written.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, GestureResponderEvent } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { getCameraCapabilities, type CameraCapability } from '../../modules/camera-caps'

const LOG_TAG = '[CameraCapsSpike]'

// Fields vision-camera 4.7.3's public JS API has NO setter for at all, on
// either Android or iOS — confirmed by reading node_modules/react-native-vision-camera
// source (CameraProps.ts, TakePhotoOptions in PhotoFile.ts). Listed here so the
// on-device tester isn't hunting for controls that don't exist.
const NOT_SETTABLE_VIA_LIBRARY = [
  { label: 'ISO (manual sensor sensitivity)', note: 'No prop/method. Only exposure BIAS (EV) is exposed.' },
  { label: 'Shutter speed (manual exposure time)', note: 'No prop/method.' },
  { label: 'White balance (manual/AWB_MODE_OFF)', note: 'No prop/method. Always auto WB.' },
  { label: 'RAW capture', note: "supportsRawCapture is hardcoded false in vision-camera's own Android source." },
]

function formatNs(ns: number | null): string {
  if (ns == null) return 'n/a'
  const seconds = ns / 1e9
  if (seconds >= 1) return `${seconds.toFixed(2)}s`
  return `1/${Math.round(1 / seconds)}s`
}

export default function CameraCapsSpike() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)

  const [caps, setCaps] = useState<CameraCapability[] | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const [exposure, setExposure] = useState(0)
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission, requestPermission])

  const loadCaps = useCallback(() => {
    try {
      const result = getCameraCapabilities()
      setCaps(result)
      setCapsError(null)
      // Primary capture method — grab this with:
      //   adb logcat | grep CameraCapsSpike
      // if the on-screen text is cut off on the Seeker's display.
      console.log(LOG_TAG, JSON.stringify(result, null, 2))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCapsError(message)
      console.log(LOG_TAG, 'ERROR', message)
    }
  }, [])

  useEffect(() => {
    loadCaps()
  }, [loadCaps])

  const backCap = caps?.find((c) => c.lensFacing === 'BACK') ?? caps?.[0] ?? null
  const minExposure = device?.minExposure ?? -2
  const maxExposure = device?.maxExposure ?? 2

  const nudgeExposure = useCallback(
    (delta: number) => {
      setExposure((prev) => Math.min(maxExposure, Math.max(minExposure, prev + delta)))
    },
    [minExposure, maxExposure],
  )

  const handleTapFocus = useCallback(
    async (event: GestureResponderEvent) => {
      if (!cameraRef.current || !device?.supportsFocus) return
      const { locationX, locationY } = event.nativeEvent
      setFocusPoint({ x: locationX, y: locationY })
      try {
        await cameraRef.current.focus({ x: locationX, y: locationY })
        console.log(LOG_TAG, `focus() resolved at (${locationX.toFixed(0)}, ${locationY.toFixed(0)})`)
      } catch (err) {
        console.log(LOG_TAG, 'focus() failed:', err)
      }
    },
    [device],
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
      <Pressable style={styles.previewWrap} onPress={handleTapFocus}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          exposure={exposure}
        />
        {focusPoint && (
          <View
            pointerEvents="none"
            style={[styles.focusRing, { left: focusPoint.x - 35, top: focusPoint.y - 35 }]}
          />
        )}
        <View style={styles.exposureHud}>
          <Text style={styles.exposureText}>
            EV bias: {exposure.toFixed(2)} (range {minExposure.toFixed(1)}..{maxExposure.toFixed(1)})
          </Text>
          <Text style={styles.hint}>Watch the preview brighten/darken as you tap +/-.</Text>
          <View style={styles.row}>
            <Pressable style={styles.stepBtn} onPress={() => nudgeExposure(-0.5)}>
              <Text style={styles.btnText}>− EV</Text>
            </Pressable>
            <Pressable style={styles.stepBtn} onPress={() => setExposure(0)}>
              <Text style={styles.btnText}>Reset</Text>
            </Pressable>
            <Pressable style={styles.stepBtn} onPress={() => nudgeExposure(0.5)}>
              <Text style={styles.btnText}>+ EV</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Tap anywhere on the preview to test focus-at-point.</Text>
        </View>
      </Pressable>

      <ScrollView style={styles.report} contentContainerStyle={{ padding: 12 }}>
        <Text style={styles.h1}>Camera2 capabilities (this device, third-party access)</Text>
        {capsError && <Text style={styles.error}>ERROR reading capabilities: {capsError}</Text>}
        {backCap && (
          <View style={{ marginBottom: 14 }}>
            <Row label="Camera ID / facing" value={`${backCap.cameraId} / ${backCap.lensFacing}`} />
            <Row label="Hardware level" value={backCap.hardwareLevel} />
            <Row label="Available capabilities" value={backCap.availableCapabilities.join(', ') || '(none)'} />
            <Row label="MANUAL_SENSOR" value={String(backCap.hasManualSensor)} />
            <Row label="MANUAL_POST_PROCESSING" value={String(backCap.hasManualPostProcessing)} />
            <Row label="RAW capability flag" value={String(backCap.hasRaw)} />
            <Row
              label="ISO range"
              value={backCap.isoMin != null ? `${backCap.isoMin} – ${backCap.isoMax}` : 'n/a'}
            />
            <Row
              label="Exposure time range"
              value={
                backCap.exposureTimeNsMin != null
                  ? `${formatNs(backCap.exposureTimeNsMin)} – ${formatNs(backCap.exposureTimeNsMax)}`
                  : 'n/a'
              }
            />
            <Row
              label="Min focus distance"
              value={backCap.minFocusDistanceDiopters != null ? `${backCap.minFocusDistanceDiopters} diopters` : 'n/a'}
            />
            <Row label="Manual focus possible (AF_MODE_OFF + non-fixed lens)" value={String(backCap.manualFocusPossible)} />
            <Row label="AWB_MODE_OFF available" value={String(backCap.hasAwbModeOff)} />
          </View>
        )}
        {!backCap && !capsError && <Text style={styles.hint}>Loading…</Text>}

        <Pressable style={styles.btn} onPress={loadCaps}>
          <Text style={styles.btnText}>Reload capabilities</Text>
        </Pressable>

        <Text style={[styles.h1, { marginTop: 20 }]}>Not settable via react-native-vision-camera 4.7.3</Text>
        {NOT_SETTABLE_VIA_LIBRARY.map((item) => (
          <View key={item.label} style={{ marginBottom: 8 }}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.hint}>{item.note}</Text>
          </View>
        ))}

        <Text style={[styles.hint, { marginTop: 16 }]}>
          Full JSON also logged to logcat — filter with: adb logcat | grep CameraCapsSpike
        </Text>
      </ScrollView>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 12 },
  previewWrap: { height: '45%', backgroundColor: '#111' },
  report: { flex: 1, backgroundColor: '#0a0a0a' },
  focusRing: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#7d7bf0',
  },
  exposureHud: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 10,
  },
  row: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  stepBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  exposureText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  hint: { color: '#9a9a9a', fontSize: 11, marginTop: 2 },
  h1: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  label: { color: '#8a8aff', fontSize: 11, fontWeight: '600' },
  value: { color: '#eee', fontSize: 13, fontFamily: 'monospace' },
  error: { color: '#e5544b', fontSize: 12, marginBottom: 10 },
  btn: {
    backgroundColor: '#7d7bf0',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
})

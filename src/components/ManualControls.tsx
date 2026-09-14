// Tier 2 — manual camera controls (ISO / shutter / white balance) on top of
// modules/camera-manual's Camera2Interop bridge. Proven on-device (Day-1
// gate + Day-2 shutter/WB checks): reflection into vision-camera's live
// CameraX session, verified to visibly affect the preview, not just "didn't
// throw."
//
// Drag-to-change dials, log-scaled — ISO and shutter both span orders of
// magnitude (ISO 100-11470, shutter 1/10000s-16s), so a linear drag would
// waste most of its travel at one end. Log scale matches how a real
// camera's stops-based dial feels: equal drag distance = equal perceived
// step, all the way across the range.
import { useCallback, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Gesture, GestureDetector, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler'
import {
  applyManualExposure,
  applyWhiteBalance,
  applyManualFocus,
  resetToAuto,
  ISO_RANGE,
  SHUTTER_NS_RANGE,
  type WhiteBalancePresetName,
} from '../../modules/camera-manual'
import { colors, fonts } from '../theme'

const PX_PER_STOP = 70 // drag distance for one full log2 stop (one doubling) — tuned for a phone-width screen
const FOCUS_DRAG_PX = 280 // fixed full-sweep drag distance for the (linear, small-range) focus dial

function log2(n: number): number {
  return Math.log(n) / Math.LN2
}

const ISO_STOPS = log2(ISO_RANGE.max / ISO_RANGE.min)
const SHUTTER_STOPS = log2(SHUTTER_NS_RANGE.max / SHUTTER_NS_RANGE.min)

function isoToStops(iso: number): number {
  return log2(iso / ISO_RANGE.min)
}
function stopsToIso(stops: number): number {
  return ISO_RANGE.min * Math.pow(2, stops)
}
function shutterToStops(ns: number): number {
  return log2(ns / SHUTTER_NS_RANGE.min)
}
function stopsToShutter(stops: number): number {
  return SHUTTER_NS_RANGE.min * Math.pow(2, stops)
}

function formatShutter(ns: number): string {
  const seconds = ns / 1e9
  if (seconds >= 1) return `${seconds.toFixed(1)}s`
  return `1/${Math.round(1 / seconds)}`
}

const WB_PRESETS: WhiteBalancePresetName[] = [
  'AUTO',
  'INCANDESCENT',
  'FLUORESCENT',
  'WARM_FLUORESCENT',
  'DAYLIGHT',
  'CLOUDY_DAYLIGHT',
  'TWILIGHT',
  'SHADE',
]
const WB_LABELS: Record<WhiteBalancePresetName, string> = {
  AUTO: 'AUTO',
  INCANDESCENT: 'TUNGSTEN',
  FLUORESCENT: 'FLUOR.',
  WARM_FLUORESCENT: 'WARM FL.',
  DAYLIGHT: 'DAYLIGHT',
  CLOUDY_DAYLIGHT: 'CLOUDY',
  TWILIGHT: 'TWILIGHT',
  SHADE: 'SHADE',
}

type Dial = {
  label: string
  valueText: string
  value: number
  min: number
  max: number
  // Total drag distance (px) to sweep the full min..max range — lets a
  // small linear range (focus, a few diopters) feel just as controllable as
  // a huge log-scaled one (ISO/shutter, many stops) without a shared,
  // wrong-for-one-of-them px-per-unit constant.
  pxRange: number
  onDrag: (value: number) => void
  onDragEnd: () => void
}

function DragDial({ label, valueText, value, min, max, pxRange, onDrag, onDragEnd }: Dial) {
  const baseValue = useRef(value)
  const pan = Gesture.Pan()
    .onStart(() => {
      baseValue.current = value
    })
    .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      const delta = (e.translationX / pxRange) * (max - min)
      const next = Math.min(max, Math.max(min, baseValue.current + delta))
      onDrag(next)
    })
    .onEnd(() => onDragEnd())
    .runOnJS(true)

  const fillPct = Math.max(0, Math.min(1, (value - min) / (max - min))) * 100

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.dial}>
        <View style={styles.dialHeader}>
          <Text style={styles.dialLabel}>{label}</Text>
          <Text style={styles.dialValue}>{valueText}</Text>
        </View>
        <View style={styles.dialTrack}>
          <View style={[styles.dialFill, { width: `${fillPct}%` }]} />
        </View>
      </View>
    </GestureDetector>
  )
}

type Props = {
  viewTag: number | null
  enabled: boolean
  onToggleEnabled: (next: boolean) => void
  // Device-reported LENS_INFO_MINIMUM_FOCUS_DISTANCE in diopters, derived by
  // the caller from vision-camera's `minFocusDistance` (cm): 100 / cm.
  // null/0 means this physical camera can't manually focus (fixed-focus
  // lens, e.g. many front cameras) — the dial hides itself in that case
  // rather than offering a control that would silently do nothing.
  maxFocusDiopters: number | null
}

export default function ManualControls({ viewTag, enabled, onToggleEnabled, maxFocusDiopters }: Props) {
  const [isoStops, setIsoStops] = useState(isoToStops(400))
  const [shutterStops, setShutterStops] = useState(shutterToStops(1_000_000)) // 1/1000s default
  const [wb, setWb] = useState<WhiteBalancePresetName>('AUTO')
  const [focusDiopters, setFocusDiopters] = useState(0) // 0 = infinity

  const canFocus = maxFocusDiopters != null && maxFocusDiopters > 0

  const lastAppliedIso = useRef<number | null>(null)
  const lastAppliedShutterNs = useRef<number | null>(null)
  const lastAppliedFocus = useRef<number | null>(null)

  const applyExposureIfChanged = useCallback(
    (nextIsoStops: number, nextShutterStops: number) => {
      if (viewTag == null) return
      const iso = Math.round(stopsToIso(nextIsoStops))
      const shutterNs = Math.round(stopsToShutter(nextShutterStops))
      if (iso === lastAppliedIso.current && shutterNs === lastAppliedShutterNs.current) return
      lastAppliedIso.current = iso
      lastAppliedShutterNs.current = shutterNs
      applyManualExposure(viewTag, iso, shutterNs)
    },
    [viewTag],
  )

  const applyFocusIfChanged = useCallback(
    (next: number) => {
      if (viewTag == null || !canFocus || maxFocusDiopters == null) return
      const rounded = Math.round(next * 100) / 100
      if (rounded === lastAppliedFocus.current) return
      lastAppliedFocus.current = rounded
      applyManualFocus(viewTag, rounded, maxFocusDiopters)
    },
    [viewTag, canFocus, maxFocusDiopters],
  )

  const handleToggle = useCallback(
    (next: boolean) => {
      onToggleEnabled(next)
      if (!viewTag) return
      if (next) {
        applyExposureIfChanged(isoStops, shutterStops)
        applyWhiteBalance(viewTag, wb)
        if (canFocus) applyFocusIfChanged(focusDiopters)
      } else {
        resetToAuto(viewTag)
        lastAppliedIso.current = null
        lastAppliedShutterNs.current = null
        lastAppliedFocus.current = null
      }
    },
    [
      onToggleEnabled,
      viewTag,
      isoStops,
      shutterStops,
      wb,
      canFocus,
      focusDiopters,
      applyExposureIfChanged,
      applyFocusIfChanged,
    ],
  )

  const handleWbSelect = useCallback(
    (preset: WhiteBalancePresetName) => {
      setWb(preset)
      if (viewTag != null && enabled) applyWhiteBalance(viewTag, preset)
    },
    [viewTag, enabled],
  )

  if (!enabled) {
    return (
      <View style={styles.root}>
        <Pressable style={styles.autoBtn} onPress={() => handleToggle(true)}>
          <Text style={styles.autoBtnText}>MANUAL</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <DragDial
        label="ISO"
        valueText={String(Math.round(stopsToIso(isoStops)))}
        value={isoStops}
        min={0}
        max={ISO_STOPS}
        pxRange={ISO_STOPS * PX_PER_STOP}
        onDrag={(s) => {
          setIsoStops(s)
          applyExposureIfChanged(s, shutterStops)
        }}
        onDragEnd={() => applyExposureIfChanged(isoStops, shutterStops)}
      />
      <DragDial
        label="SHUTTER"
        valueText={formatShutter(stopsToShutter(shutterStops))}
        value={shutterStops}
        min={0}
        max={SHUTTER_STOPS}
        pxRange={SHUTTER_STOPS * PX_PER_STOP}
        onDrag={(s) => {
          setShutterStops(s)
          applyExposureIfChanged(isoStops, s)
        }}
        onDragEnd={() => applyExposureIfChanged(isoStops, shutterStops)}
      />
      {canFocus && maxFocusDiopters != null && (
        <DragDial
          label="FOCUS"
          valueText={focusDiopters < 0.05 ? '∞' : `${(1 / focusDiopters).toFixed(2)}m`}
          value={focusDiopters}
          min={0}
          max={maxFocusDiopters}
          pxRange={FOCUS_DRAG_PX}
          onDrag={(d) => {
            setFocusDiopters(d)
            applyFocusIfChanged(d)
          }}
          onDragEnd={() => applyFocusIfChanged(focusDiopters)}
        />
      )}

      <View style={styles.wbRow}>
        {WB_PRESETS.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => handleWbSelect(preset)}
            style={[styles.wbChip, wb === preset && styles.wbChipActive]}
          >
            <Text style={[styles.wbChipText, wb === preset && styles.wbChipTextActive]}>{WB_LABELS[preset]}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.autoBtn} onPress={() => handleToggle(false)}>
        <Text style={styles.autoBtnText}>AUTO</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  dial: {
    backgroundColor: colors.chipBg,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    borderRadius: 12,
    padding: 10,
  },
  dialHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dialLabel: { fontFamily: fonts.monoBold, fontSize: 10, color: colors.accentSoft, letterSpacing: 1 },
  dialValue: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.text },
  dialTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  dialFill: { height: '100%', backgroundColor: colors.accent },
  wbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  wbChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.chipBg,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  wbChipActive: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  wbChipText: { fontFamily: fonts.mono, fontSize: 10, color: colors.textSoft },
  wbChipTextActive: { color: colors.accentSoft },
  autoBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  autoBtnText: { fontFamily: fonts.sansBold, fontSize: 11, color: colors.accentSoft, letterSpacing: 1 },
})

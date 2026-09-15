// Tier 2 — manual camera controls (ISO / shutter / focus / white balance) on
// top of modules/camera-manual's Camera2Interop bridge. Proven on-device:
// reflection into vision-camera's live CameraX session, verified to visibly
// affect both the preview and the actual captured photo, not just "didn't
// throw."
//
// Purely presentational — all state lives in useManualCameraState (see that
// hook's own comment for why: the native call replaces the whole capture-
// request override set per-call, so exactly one place must own the full
// picture). This component just renders controls against that state.
import { useRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Gesture, GestureDetector, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler'
import { filterIsoNotches, ISO_RANGE, SHUTTER_NS_RANGE, type WhiteBalancePresetName, type AutoManualMode } from '../../modules/camera-manual'
import type { ManualCameraState } from '../hooks/useManualCameraState'
import { colors, fonts } from '../theme'

const PX_PER_STOP = 70 // drag distance for one full log2 stop (one doubling) — tuned for a phone-width screen
const FOCUS_DRAG_PX = 280 // fixed full-sweep drag distance for the (linear, small-range) focus dial
const ISO_NOTCHES = filterIsoNotches(ISO_RANGE)

function log2(n: number): number {
  return Math.log(n) / Math.LN2
}

const SHUTTER_STOPS = log2(SHUTTER_NS_RANGE.max / SHUTTER_NS_RANGE.min)
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

function ModeToggle({
  mode,
  onChange,
}: {
  mode: AutoManualMode
  onChange: (next: AutoManualMode) => void
}) {
  return (
    <View style={styles.modeToggle}>
      <Pressable
        onPress={() => onChange('auto')}
        style={[styles.modeSeg, mode === 'auto' && styles.modeSegActive]}
      >
        <Text style={[styles.modeSegText, mode === 'auto' && styles.modeSegTextActive]}>AUTO</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('manual')}
        style={[styles.modeSeg, mode === 'manual' && styles.modeSegActive]}
      >
        <Text style={[styles.modeSegText, mode === 'manual' && styles.modeSegTextActive]}>MANUAL</Text>
      </Pressable>
    </View>
  )
}

type DragDialProps = {
  valueText: string
  value: number
  min: number
  max: number
  pxRange: number
  onDrag: (value: number) => void
  leftLabel?: string
  rightLabel?: string
}

function DragDial({ valueText, value, min, max, pxRange, onDrag, leftLabel, rightLabel }: DragDialProps) {
  const baseValue = useRef(value)
  const pan = Gesture.Pan()
    .onStart(() => {
      baseValue.current = value
    })
    .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      const delta = (e.translationX / pxRange) * (max - min)
      onDrag(Math.min(max, Math.max(min, baseValue.current + delta)))
    })
    .runOnJS(true)

  const fillPct = Math.max(0, Math.min(1, (value - min) / (max - min))) * 100

  return (
    <GestureDetector gesture={pan}>
      <View>
        <View style={styles.dialTrack}>
          <View style={[styles.dialFill, { width: `${fillPct}%` }]} />
        </View>
        <View style={styles.dialFooter}>
          <Text style={styles.dialEdgeLabel}>{leftLabel ?? ''}</Text>
          <Text style={styles.dialValue}>{valueText}</Text>
          <Text style={styles.dialEdgeLabel}>{rightLabel ?? ''}</Text>
        </View>
      </View>
    </GestureDetector>
  )
}

function NotchedDial({
  notches,
  valueIndex,
  onChangeIndex,
}: {
  notches: readonly number[]
  valueIndex: number
  onChangeIndex: (index: number) => void
}) {
  const maxIndex = notches.length - 1
  const pxPerNotch = 60
  const baseIndex = useRef(valueIndex)
  const pan = Gesture.Pan()
    .onStart(() => {
      baseIndex.current = valueIndex
    })
    .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      const raw = baseIndex.current + e.translationX / pxPerNotch
      const snapped = Math.round(Math.min(maxIndex, Math.max(0, raw)))
      if (snapped !== valueIndex) onChangeIndex(snapped)
    })
    .runOnJS(true)

  return (
    <GestureDetector gesture={pan}>
      <View>
        <View style={styles.notchRow}>
          {notches.map((n, i) => (
            <View key={n} style={styles.notchTickWrap}>
              <View style={[styles.notchTick, i === valueIndex && styles.notchTickActive]} />
            </View>
          ))}
        </View>
        <View style={styles.notchLabelRow}>
          {notches.map((n, i) => (
            <Text key={n} style={[styles.notchLabel, i === valueIndex && styles.notchLabelActive]}>
              {n}
            </Text>
          ))}
        </View>
      </View>
    </GestureDetector>
  )
}

type Props = {
  controls: ManualCameraState
}

export default function ManualControls({ controls }: Props) {
  const {
    exposureMode,
    setExposureMode,
    manualIso,
    setManualIso,
    manualShutterNs,
    setManualShutterNs,
    focusMode,
    setFocusMode,
    manualFocusDiopters,
    setManualFocusDiopters,
    maxFocusDiopters,
    whiteBalance,
    setWhiteBalance,
    canIndependentExposure,
  } = controls

  const isoIndex = Math.max(0, ISO_NOTCHES.indexOf(manualIso))
  const shutterStops = shutterToStops(manualShutterNs)
  const canFocus = maxFocusDiopters != null && maxFocusDiopters > 0
  const exposureManual = exposureMode === 'manual'

  return (
    <View style={styles.root}>
      {!canIndependentExposure && (
        <Text style={styles.capabilityNote}>
          This camera supports automatic or fully manual exposure. Independent Auto ISO and Auto Shutter are
          unavailable.
        </Text>
      )}

      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlLabel}>EXPOSURE</Text>
          <ModeToggle mode={exposureMode} onChange={setExposureMode} />
        </View>
      </View>

      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlLabel}>ISO</Text>
          {!exposureManual && <Text style={styles.autoValue}>AUTO</Text>}
        </View>
        {exposureManual && (
          <NotchedDial
            notches={ISO_NOTCHES}
            valueIndex={isoIndex}
            onChangeIndex={(i) => setManualIso(ISO_NOTCHES[i])}
          />
        )}
      </View>

      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <Text style={styles.controlLabel}>SHUTTER</Text>
          {!exposureManual && <Text style={styles.autoValue}>AUTO</Text>}
        </View>
        {exposureManual && (
          <DragDial
            valueText={formatShutter(manualShutterNs)}
            value={shutterStops}
            min={0}
            max={SHUTTER_STOPS}
            pxRange={SHUTTER_STOPS * PX_PER_STOP}
            onDrag={(s) => setManualShutterNs(Math.round(stopsToShutter(s)))}
          />
        )}
      </View>

      {canFocus && maxFocusDiopters != null && (
        <View style={styles.control}>
          <View style={styles.controlHeader}>
            <Text style={styles.controlLabel}>FOCUS</Text>
            <ModeToggle mode={focusMode} onChange={setFocusMode} />
          </View>
          {focusMode === 'manual' && (
            <DragDial
              // UI runs short (near) -> long (far/infinity) left-to-right, the
              // opposite of the underlying diopter scale (high diopters =
              // near, 0 = infinity) — invert for display, invert back on drag.
              valueText={manualFocusDiopters < 0.05 ? '∞' : `${(1 / manualFocusDiopters).toFixed(2)}m`}
              value={maxFocusDiopters - manualFocusDiopters}
              min={0}
              max={maxFocusDiopters}
              pxRange={FOCUS_DRAG_PX}
              onDrag={(d) => setManualFocusDiopters(maxFocusDiopters - d)}
              leftLabel="NEAR"
              rightLabel="∞"
            />
          )}
        </View>
      )}

      <View style={styles.wbRow}>
        {WB_PRESETS.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setWhiteBalance(preset)}
            style={[styles.wbChip, whiteBalance === preset && styles.wbChipActive]}
          >
            <Text style={[styles.wbChipText, whiteBalance === preset && styles.wbChipTextActive]}>
              {WB_LABELS[preset]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  capabilityNote: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  control: { gap: 6 },
  controlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlLabel: { fontFamily: fonts.monoBold, fontSize: 10, color: colors.accentSoft, letterSpacing: 1 },
  autoValue: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, letterSpacing: 1 },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  modeSeg: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.chipBg },
  modeSegActive: { backgroundColor: colors.accentTint },
  modeSegText: { fontFamily: fonts.sansBold, fontSize: 9, color: colors.textSoft },
  modeSegTextActive: { color: colors.accentSoft },
  dialTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  dialFill: { height: '100%', backgroundColor: colors.accent },
  dialFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  dialEdgeLabel: { fontFamily: fonts.mono, fontSize: 9, color: colors.textMuted, minWidth: 30 },
  dialValue: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.text },
  notchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 16 },
  notchTickWrap: { alignItems: 'center', flex: 1 },
  notchTick: { width: 2, height: 10, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  notchTickActive: { backgroundColor: colors.accent, height: 14 },
  notchLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  notchLabel: { flex: 1, textAlign: 'center', fontFamily: fonts.mono, fontSize: 9, color: colors.textMuted },
  notchLabelActive: { color: colors.accentSoft, fontFamily: fonts.monoBold },
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
})

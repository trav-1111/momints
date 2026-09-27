// Tier 2 — manual camera controls (metering / ISO / shutter / EV / white
// balance / focus) on top of modules/camera-manual's Camera2Interop bridge.
//
// Visual design follows "Camera app UI design" (Claude Design project
// 10e4ee39-1918-44a0-9f47-65dd74a6490b, "Momints Camera Pro Mode.dc.html"):
// a persistent six-column value strip (M · ISO · S · EV · WB · AF) pinned
// above the shutter row, with exactly one parameter's controls expanded
// directly above it at a time. That mockup was built assuming ISO and
// shutter could run independent auto states (ISO-priority / shutter-
// priority) — real-device testing on the Seeker found no
// CONTROL_AE_AVAILABLE_PRIORITY_MODES support, so this build couples them
// into one shared exposureMode (see useManualCameraState's own comment).
// Adjustments from the mockup, made deliberately rather than by omission:
//   - ISO and S always show the same AUTO/MANUAL state and one "A" badge
//     tap flips both, since that's the only real state this hardware has.
//   - EV is enabled while exposure is AUTO (the camera is running AE and a
//     bias has something to act on) and disabled in MANUAL — the opposite
//     of the mockup's literal caption, but the real semantics, and what
//     this app's EV bias already did before this redesign.
//   - Shutter ruler end labels come from this camera's real measured
//     SHUTTER_NS_RANGE, not the mockup's placeholder "0.5".
//   - WB is trimmed to the 5 presets real cameras universally ship (Auto,
//     Tungsten, Fluorescent, Daylight, Cloudy) rather than the mockup's 6 —
//     Warm Fluorescent read as visually identical to Fluorescent in testing
//     and Twilight/Shade weren't worth the extra icons users have to learn.
//
// All state lives in useManualCameraState (see that hook's own comment for
// why) plus EV bias, which stays local to camera.tsx (it's a vision-camera
// native prop, not a Camera2Interop override) and is passed in as props.
// This component is purely presentational.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native'
import { Gesture, GestureDetector, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import {
  filterIsoNotches,
  ISO_RANGE,
  SHUTTER_NS_RANGE,
  type MeteringMode,
  type WhiteBalancePresetName,
} from '../../modules/camera-manual'
import type { ManualCameraState } from '../hooks/useManualCameraState'
import { colors, fonts } from '../theme'
import {
  IconMeteringMatrix,
  IconMeteringCenter,
  IconMeteringSpot,
  IconWbIncandescent,
  IconWbFluorescent,
  IconWbCloudy,
  IconWbDaylight,
  IconFocusNear,
  IconFocusFar,
  type IconProps,
} from './icons'

// Drag distances tuned down from an initial pass that read as sluggish —
// shorter full-sweep distance = a smaller finger movement covers more of
// the range, which is what "faster" actually means for a drag control.
const PX_PER_STOP = 48 // drag distance for one full log2 stop
const ISO_PX_PER_NOTCH = 42
const ISO_NOTCHES = filterIsoNotches(ISO_RANGE)

function log2(n: number): number {
  return Math.log(n) / Math.LN2
}

// Standard photographic shutter stops (1/8000s to 16s)
export const SHUTTER_NOTCHES_NS = [
  125_000, // 1/8000s
  250_000, // 1/4000s
  500_000, // 1/2000s
  1_000_000, // 1/1000s
  2_000_000, // 1/500s
  4_000_000, // 1/250s
  8_000_000, // 1/125s
  16_666_667, // 1/60s
  33_333_333, // 1/30s
  66_666_667, // 1/15s
  125_000_000, // 1/8s
  250_000_000, // 1/4s
  500_000_000, // 1/2s
  1_000_000_000, // 1s
  2_000_000_000, // 2s
  4_000_000_000, // 4s
  8_000_000_000, // 8s
  16_000_000_000, // 16s
] as const

export const SHUTTER_NOTCHES = SHUTTER_NOTCHES_NS.filter(
  (ns) => ns >= SHUTTER_NS_RANGE.min && ns <= SHUTTER_NS_RANGE.max,
)

export function findClosestShutterIndex(ns: number): number {
  let bestIdx = 0
  let minDiff = Infinity
  for (let i = 0; i < SHUTTER_NOTCHES.length; i++) {
    const diff = Math.abs(Math.log2(ns / SHUTTER_NOTCHES[i]))
    if (diff < minDiff) {
      minDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
}

export function formatShutter(ns: number): string {
  const seconds = ns / 1e9
  if (seconds >= 1) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`
  return `1/${Math.round(1 / seconds)}`
}
// Focus also drags in log2 stops, not raw diopters — a linear-diopter scale
// over this camera's full manual range (0 to ~22 diopters, see camera.tsx's
// MANUAL_FOCUS_HEADROOM_DIOPTERS) put over 75% of the slider inside
// 0.05-1m, leaving almost no travel for the 1m-infinity range most photos
// actually use. log2(diopters+1) crowds the far/infinity end and spreads
// macro out, same shape as a real lens's focus-ring distance markings, and
// matches how the ISO/shutter rulers already scale (consistency, not a new
// interaction to learn).
function focusToStops(diopters: number): number {
  return log2(diopters + 1)
}
function stopsToFocus(stops: number): number {
  return Math.pow(2, stops) - 1
}
function formatEv(ev: number): string {
  if (Math.abs(ev) < 0.05) return '0'
  return `${ev > 0 ? '+' : ''}${ev.toFixed(1)}`
}

type ParamKey = 'M' | 'ISO' | 'S' | 'EV' | 'WB' | 'AF'

const METERING_ICON: Record<MeteringMode, React.ComponentType<IconProps>> = {
  matrix: IconMeteringMatrix,
  center: IconMeteringCenter,
  spot: IconMeteringSpot,
}

// The 5 presets real cameras universally ship — see the file-header comment
// for why WARM_FLUORESCENT/TWILIGHT/SHADE were dropped. The underlying
// WhiteBalancePreset map in camera-manual/index.ts keeps all 8 real device
// constants; this is just what the picker exposes.
const WB_PRESETS: WhiteBalancePresetName[] = ['AUTO', 'INCANDESCENT', 'FLUORESCENT', 'DAYLIGHT', 'CLOUDY_DAYLIGHT']
const WB_ICON: Partial<Record<WhiteBalancePresetName, React.ComponentType<IconProps>>> = {
  INCANDESCENT: IconWbIncandescent,
  FLUORESCENT: IconWbFluorescent,
  DAYLIGHT: IconWbDaylight,
  CLOUDY_DAYLIGHT: IconWbCloudy,
}
const WB_STRIP_LABEL: Record<WhiteBalancePresetName, string> = {
  AUTO: 'AUTO',
  INCANDESCENT: 'TUNG',
  FLUORESCENT: 'FLUOR',
  WARM_FLUORESCENT: 'WARM',
  DAYLIGHT: 'DAY',
  CLOUDY_DAYLIGHT: 'CLOUD',
  TWILIGHT: 'TWI',
  SHADE: 'SHADE',
}

function AutoBadge({
  active,
  onPress,
  uiRotationStyle,
}: {
  active: boolean
  onPress: () => void
  uiRotationStyle?: object
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync()
        onPress()
      }}
      style={[styles.autoBadge, active && styles.autoBadgeActive]}
    >
      <Animated.Text style={[styles.autoBadgeText, active && styles.autoBadgeTextActive, uiRotationStyle]}>
        A
      </Animated.Text>
    </Pressable>
  )
}

// Shared "ruler" for every numeric parameter (ISO, shutter, EV, focus
// distance). ISO and shutter drag in notch index space so they snap to
// standard photographic stops; the others drag continuously.
type RulerProps = {
  value: number
  min: number
  max: number
  pxRange: number
  onDrag: (v: number) => void
  dim?: boolean
  labels: ReactNode[]
  majorCount?: number
  minorCount?: number
  // Granularity for the haptic "click" while dragging. Defaults to one tick
  // per rendered minor tick, matching the visual ruler; ISO and shutter override this
  // to 1 (one click per notch).
  hapticStep?: number
}

function Ruler({ value, min, max, pxRange, onDrag, dim, labels, majorCount, minorCount = 28, hapticStep }: RulerProps) {
  const baseValue = useRef(value)
  const lastDetent = useRef<number | null>(null)
  const step = hapticStep ?? (max - min) / minorCount
  const pan = Gesture.Pan()
    .onStart(() => {
      baseValue.current = value
      lastDetent.current = Math.round((value - min) / step)
    })
    .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      const delta = (e.translationX / pxRange) * (max - min)
      const next = Math.min(max, Math.max(min, baseValue.current + delta))
      const detent = Math.round((next - min) / step)
      if (detent !== lastDetent.current) {
        lastDetent.current = detent
        Haptics.selectionAsync()
      }
      onDrag(next)
    })
    .runOnJS(true)

  const fillPct = Math.max(0, Math.min(1, (value - min) / (max - min))) * 100

  return (
    <View style={styles.rulerCol}>
      <View style={styles.rulerLabelRow}>{labels}</View>
      <GestureDetector gesture={pan}>
        <View style={styles.rulerTrack}>
          {majorCount != null ? (
            <>
              <View style={styles.tickRowMinor} pointerEvents="none">
                {Array.from({ length: minorCount + 1 }).map((_, i) => (
                  <View key={i} style={[styles.tickMinor, dim && styles.tickDim]} />
                ))}
              </View>
              <View style={styles.tickRowMajor} pointerEvents="none">
                {Array.from({ length: majorCount + 1 }).map((_, i) => (
                  <View key={i} style={[styles.tickMajor, dim && styles.tickDim]} />
                ))}
              </View>
            </>
          ) : (
            <View style={styles.tickRowMajor} pointerEvents="none">
              {Array.from({ length: minorCount + 1 }).map((_, i) => (
                <View key={i} style={[styles.tickMajor, dim && styles.tickDim]} />
              ))}
            </View>
          )}
          <View style={[styles.rulerMarker, dim && styles.rulerMarkerDim, { left: `${fillPct}%` }]} />
        </View>
      </GestureDetector>
    </View>
  )
}

function MeteringPanel({ controls, uiRotationStyle }: { controls: ManualCameraState; uiRotationStyle?: object }) {
  const { meteringMode, setMeteringMode } = controls
  return (
    <View style={styles.iconChoiceRow}>
      {(['matrix', 'center', 'spot'] as const).map((mode) => {
        const Icon = METERING_ICON[mode]
        const active = meteringMode === mode
        return (
          <Pressable
            key={mode}
            onPress={() => {
              Haptics.selectionAsync()
              setMeteringMode(mode)
            }}
            style={styles.iconChoiceItem}
          >
            <Animated.View style={uiRotationStyle}>
              <Icon size={26} color={active ? colors.accentSoft : colors.text} />
            </Animated.View>
          </Pressable>
        )
      })}
    </View>
  )
}

function IsoPanel({ controls, uiRotationStyle }: { controls: ManualCameraState; uiRotationStyle?: object }) {
  const { exposureMode, setExposureMode, manualIso, setManualIso } = controls
  const auto = exposureMode === 'auto'
  const isoIndex = Math.max(0, ISO_NOTCHES.indexOf(manualIso))
  return (
    <View style={styles.panelRow}>
      <AutoBadge active={auto} onPress={() => setExposureMode(auto ? 'manual' : 'auto')} uiRotationStyle={uiRotationStyle} />
      <Ruler
        value={isoIndex}
        min={0}
        max={ISO_NOTCHES.length - 1}
        pxRange={ISO_NOTCHES.length * ISO_PX_PER_NOTCH}
        onDrag={(v) => {
          if (auto) setExposureMode('manual')
          setManualIso(ISO_NOTCHES[Math.round(v)])
        }}
        dim={auto}
        majorCount={ISO_NOTCHES.length - 1}
        minorCount={24}
        hapticStep={1}
        labels={ISO_NOTCHES.map((n) => (
          <Animated.Text
            key={n}
            style={[
              styles.rulerLabelText,
              !auto && manualIso === n && { color: colors.accentSoft, fontFamily: fonts.monoBold },
              uiRotationStyle,
            ]}
          >
            {n}
          </Animated.Text>
        ))}
      />
    </View>
  )
}

function ShutterPanel({ controls, uiRotationStyle }: { controls: ManualCameraState; uiRotationStyle?: object }) {
  const { exposureMode, setExposureMode, manualShutterNs, setManualShutterNs } = controls
  const auto = exposureMode === 'auto'
  const shutterIndex = findClosestShutterIndex(manualShutterNs)
  return (
    <View style={styles.panelRow}>
      <AutoBadge active={auto} onPress={() => setExposureMode(auto ? 'manual' : 'auto')} uiRotationStyle={uiRotationStyle} />
      <Ruler
        value={shutterIndex}
        min={0}
        max={SHUTTER_NOTCHES.length - 1}
        pxRange={(SHUTTER_NOTCHES.length - 1) * 28}
        onDrag={(v) => {
          if (auto) setExposureMode('manual')
          const idx = Math.max(0, Math.min(SHUTTER_NOTCHES.length - 1, Math.round(v)))
          setManualShutterNs(SHUTTER_NOTCHES[idx])
        }}
        dim={auto}
        majorCount={SHUTTER_NOTCHES.length - 1}
        minorCount={34}
        hapticStep={1}
        labels={[
          <Animated.Text key="min" style={[styles.rulerLabelText, uiRotationStyle]}>
            {formatShutter(SHUTTER_NOTCHES[0])}
          </Animated.Text>,
          <Animated.View key="cur" style={[styles.rulerCurrentBadge, uiRotationStyle]}>
            <Text style={styles.rulerCurrentText}>
              {auto ? 'AUTO' : formatShutter(manualShutterNs)}
            </Text>
          </Animated.View>,
          <Animated.Text key="max" style={[styles.rulerLabelText, uiRotationStyle]}>
            {formatShutter(SHUTTER_NOTCHES[SHUTTER_NOTCHES.length - 1])}
          </Animated.Text>,
        ]}
      />
    </View>
  )
}

function EvPanel({
  ev,
  setEv,
  minExposure,
  maxExposure,
  dim,
  uiRotationStyle,
}: {
  ev: number
  setEv: (v: number) => void
  minExposure: number
  maxExposure: number
  dim: boolean
  uiRotationStyle?: object
}) {
  return (
    <View style={styles.panelRow}>
      <View style={styles.autoBadgeSpacer} />
      <Ruler
        value={ev}
        min={minExposure}
        max={maxExposure}
        pxRange={Math.max(1, maxExposure - minExposure) * PX_PER_STOP}
        onDrag={setEv}
        dim={dim}
        majorCount={4}
        minorCount={20}
        labels={[
          <Animated.Text key="min" style={[styles.rulerLabelText, uiRotationStyle]}>
            {minExposure.toFixed(1)}
          </Animated.Text>,
          <Animated.Text key="max" style={[styles.rulerLabelText, uiRotationStyle]}>
            {`+${maxExposure.toFixed(1)}`}
          </Animated.Text>,
        ]}
      />
    </View>
  )
}

function WhiteBalancePanel({ controls, uiRotationStyle }: { controls: ManualCameraState; uiRotationStyle?: object }) {
  const { whiteBalance, setWhiteBalance } = controls
  return (
    <View style={styles.wbGrid}>
      {WB_PRESETS.map((preset) => {
        const active = whiteBalance === preset
        const Icon = WB_ICON[preset]
        return (
          <Pressable
            key={preset}
            onPress={() => {
              Haptics.selectionAsync()
              setWhiteBalance(preset)
            }}
            style={styles.wbItem}
          >
            {preset === 'AUTO' ? (
              <View style={[styles.autoBadge, active && styles.autoBadgeActive]}>
                <Animated.Text style={[styles.autoBadgeText, active && styles.autoBadgeTextActive, uiRotationStyle]}>
                  A
                </Animated.Text>
              </View>
            ) : Icon ? (
              <Animated.View style={uiRotationStyle}>
                <Icon size={24} color={active ? colors.accentSoft : colors.text} />
              </Animated.View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function FocusPanel({
  controls,
  onAutoSelected,
  uiRotationStyle,
}: {
  controls: ManualCameraState
  onAutoSelected: () => void
  uiRotationStyle?: object
}) {
  const { focusMode, setFocusMode, manualFocusDiopters, setManualFocusDiopters, maxFocusDiopters } = controls
  if (maxFocusDiopters == null) return null

  if (focusMode === 'auto') {
    return (
      <View style={styles.twoChoiceRow}>
        <View style={styles.twoChoiceItem}>
          <Animated.Text style={[styles.twoChoiceText, styles.twoChoiceTextActive, uiRotationStyle]}>AF</Animated.Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync()
            setFocusMode('manual')
          }}
          style={styles.twoChoiceItem}
        >
          <Animated.Text style={[styles.twoChoiceText, uiRotationStyle]}>MF</Animated.Text>
        </Pressable>
      </View>
    )
  }

  const maxStops = focusToStops(maxFocusDiopters)
  return (
    <View style={styles.panelRow}>
      <AutoBadge
        active={false}
        onPress={() => {
          setFocusMode('auto')
          onAutoSelected()
        }}
        uiRotationStyle={uiRotationStyle}
      />
      <Ruler
        value={maxStops - focusToStops(manualFocusDiopters)}
        min={0}
        max={maxStops}
        pxRange={maxStops * PX_PER_STOP}
        onDrag={(v) => setManualFocusDiopters(stopsToFocus(maxStops - v))}
        majorCount={5}
        minorCount={24}
        labels={[
          <Animated.View key="near" style={uiRotationStyle}>
            <IconFocusNear size={17} color={colors.text} />
          </Animated.View>,
          <Animated.View key="far" style={uiRotationStyle}>
            <IconFocusFar size={17} color={colors.text} />
          </Animated.View>,
        ]}
      />
    </View>
  )
}

type Props = {
  controls: ManualCameraState
  ev: number
  setEv: (v: number) => void
  minExposure: number
  maxExposure: number
  uiRotationAnim?: Animated.Value
}

export default function ManualControls({
  controls,
  ev,
  setEv,
  minExposure,
  maxExposure,
  uiRotationAnim,
}: Props) {
  const [activeParam, setActiveParam] = useState<ParamKey | null>(null)
  const {
    exposureMode,
    focusMode,
    whiteBalance,
    meteringMode,
    manualIso,
    manualShutterNs,
    maxFocusDiopters,
    fullyManual,
    canIndependentExposure,
  } = controls
  const canFocus = maxFocusDiopters != null && maxFocusDiopters > 0

  const uiRotationDeg = uiRotationAnim
    ? uiRotationAnim.interpolate({
        inputRange: [-360, 360],
        outputRange: ['-360deg', '360deg'],
      })
    : '0deg'
  const uiRotationStyle = { transform: [{ rotate: uiRotationDeg }] }

  useEffect(() => {
    if (fullyManual && (activeParam === 'EV' || activeParam === 'M')) setActiveParam(null)
  }, [fullyManual, activeParam])

  const toggle = (key: ParamKey) => {
    Haptics.selectionAsync()
    setActiveParam((cur) => (cur === key ? null : key))
  }
  const MeteringIcon = METERING_ICON[meteringMode]

  return (
    <View>
      {activeParam != null && (
        <View style={styles.panel}>
          {activeParam === 'M' && <MeteringPanel controls={controls} uiRotationStyle={uiRotationStyle} />}
          {activeParam === 'ISO' && <IsoPanel controls={controls} uiRotationStyle={uiRotationStyle} />}
          {activeParam === 'S' && <ShutterPanel controls={controls} uiRotationStyle={uiRotationStyle} />}
          {activeParam === 'EV' && (
            <EvPanel
              ev={ev}
              setEv={setEv}
              minExposure={minExposure}
              maxExposure={maxExposure}
              dim={fullyManual}
              uiRotationStyle={uiRotationStyle}
            />
          )}
          {activeParam === 'WB' && <WhiteBalancePanel controls={controls} uiRotationStyle={uiRotationStyle} />}
          {activeParam === 'AF' && (
            <FocusPanel controls={controls} onAutoSelected={() => setActiveParam(null)} uiRotationStyle={uiRotationStyle} />
          )}
          {(activeParam === 'ISO' || activeParam === 'S') && !canIndependentExposure && (
            <Text style={styles.capabilityNote}>ISO and shutter share one exposure mode on this camera.</Text>
          )}
        </View>
      )}

      <View style={styles.strip}>
        <Pressable style={styles.stripCol} onPress={() => toggle('M')}>
          <Animated.Text style={[styles.stripLabel, activeParam === 'M' && styles.stripLabelActive, uiRotationStyle]}>
            M
          </Animated.Text>
          <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
            <MeteringIcon size={17} color={fullyManual ? colors.textMuted : colors.text} />
          </Animated.View>
        </Pressable>
        <Pressable style={styles.stripCol} onPress={() => toggle('ISO')}>
          <Animated.Text style={[styles.stripLabel, activeParam === 'ISO' && styles.stripLabelActive, uiRotationStyle]}>
            ISO
          </Animated.Text>
          <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
            <Text style={styles.stripValueText}>{exposureMode === 'auto' ? 'AUTO' : manualIso}</Text>
          </Animated.View>
        </Pressable>
        <Pressable style={styles.stripCol} onPress={() => toggle('S')}>
          <Animated.Text style={[styles.stripLabel, activeParam === 'S' && styles.stripLabelActive, uiRotationStyle]}>
            S
          </Animated.Text>
          <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
            <Text style={styles.stripValueText}>
              {exposureMode === 'auto' ? 'AUTO' : formatShutter(manualShutterNs)}
            </Text>
          </Animated.View>
        </Pressable>
        <Pressable style={styles.stripCol} onPress={() => toggle('EV')} disabled={fullyManual}>
          <Animated.Text
            style={[
              styles.stripLabel,
              activeParam === 'EV' && styles.stripLabelActive,
              fullyManual && styles.stripDisabled,
              uiRotationStyle,
            ]}
          >
            EV
          </Animated.Text>
          <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
            <Text style={[styles.stripValueText, fullyManual && styles.stripDisabled]}>{formatEv(ev)}</Text>
          </Animated.View>
        </Pressable>
        <Pressable style={styles.stripCol} onPress={() => toggle('WB')}>
          <Animated.Text style={[styles.stripLabel, activeParam === 'WB' && styles.stripLabelActive, uiRotationStyle]}>
            WB
          </Animated.Text>
          <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
            <Text style={styles.stripValueText}>{WB_STRIP_LABEL[whiteBalance]}</Text>
          </Animated.View>
        </Pressable>
        {canFocus && (
          <Pressable style={styles.stripCol} onPress={() => toggle('AF')}>
            <Animated.Text style={[styles.stripLabel, activeParam === 'AF' && styles.stripLabelActive, uiRotationStyle]}>
              AF
            </Animated.Text>
            <Animated.View style={[styles.stripValueRow, uiRotationStyle]}>
              <Text style={styles.stripValueText}>{focusMode === 'auto' ? 'AF' : 'MF'}</Text>
            </Animated.View>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    backgroundColor: 'rgba(8,9,16,0.82)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 13,
    paddingHorizontal: 6,
  },
  stripCol: { flex: 1, alignItems: 'center', gap: 7 },
  stripLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: colors.textSoft },
  stripLabelActive: { color: colors.accentSoft, fontFamily: fonts.monoBold },
  stripDisabled: { color: colors.textMuted },
  stripValueRow: { minHeight: 18, alignItems: 'center', justifyContent: 'center' },
  stripValueText: { fontFamily: fonts.mono, fontSize: 12, color: colors.text },

  panel: {
    backgroundColor: 'rgba(8,9,16,0.7)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    gap: 8,
  },
  panelRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  capabilityNote: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },

  autoBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoBadgeActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  autoBadgeText: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.textSoft },
  autoBadgeTextActive: { color: '#0a0a0b' },
  autoBadgeSpacer: { width: 36 },

  rulerCol: { flex: 1 },
  rulerLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' },
  rulerLabelText: { fontFamily: fonts.mono, fontSize: 11, color: colors.textSoft },
  rulerTrack: { height: 30, justifyContent: 'flex-end' },
  tickRowMinor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  tickMinor: { width: 1.5, height: '70%', backgroundColor: 'rgba(255,255,255,0.4)' },
  tickRowMajor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 17,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  tickMajor: { width: 2, height: '100%', backgroundColor: colors.text },
  tickDim: { opacity: 0.45 },
  rulerMarker: {
    position: 'absolute',
    bottom: 0,
    width: 3,
    height: 26,
    borderRadius: 2,
    marginLeft: -1.5,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  rulerMarkerDim: {
    opacity: 0.35,
    backgroundColor: colors.textSoft,
    shadowOpacity: 0,
  },
  rulerCurrentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 213, 102, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 213, 102, 0.4)',
  },
  rulerCurrentText: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    color: colors.accentSoft,
    letterSpacing: 0.4,
  },

  iconChoiceRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 },
  iconChoiceItem: { padding: 8 },

  twoChoiceRow: { flexDirection: 'row', paddingVertical: 10 },
  twoChoiceItem: { flex: 1, alignItems: 'center' },
  twoChoiceText: { fontFamily: fonts.monoBold, fontSize: 15, letterSpacing: 1, color: colors.text },
  twoChoiceTextActive: { color: colors.accentSoft },

  wbGrid: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 },
  wbItem: { alignItems: 'center', padding: 8 },
})

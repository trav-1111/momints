import { requireNativeModule } from 'expo-modules-core'

const CameraManualNative = requireNativeModule('CameraManual')

// Seeker main rear camera (id 0), confirmed via the camera-caps capability
// spike run on real hardware. Different camera ids / different devices have
// different ranges — these are NOT universal Camera2 constants, they're this
// specific sensor's SENSOR_INFO_SENSITIVITY_RANGE / SENSOR_INFO_EXPOSURE_TIME_RANGE.
export const ISO_RANGE = { min: 100, max: 11470 } as const
export const SHUTTER_NS_RANGE = { min: 100_000, max: 16_000_000_000 } as const

// CameraMetadata.CONTROL_AWB_MODE_* — exact values confirmed via javap
// against the android-36 SDK (android.hardware.camera2.CameraMetadata),
// not guessed. Presets, not a continuous Kelvin dial — CONTROL_AWB_MODE_OFF
// (raw manual gains via COLOR_CORRECTION_GAINS) is available on this device
// too (see camera-caps hasAwbModeOff) but presets are the Day-2 scope; a
// continuous dial is a natural follow-up, not required for pro-mode v1.
export const WhiteBalancePreset = {
  AUTO: 1,
  INCANDESCENT: 2,
  FLUORESCENT: 3,
  WARM_FLUORESCENT: 4,
  DAYLIGHT: 5,
  CLOUDY_DAYLIGHT: 6,
  TWILIGHT: 7,
  SHADE: 8,
} as const

export type WhiteBalancePresetName = keyof typeof WhiteBalancePreset

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a finite number, got ${value}`)
  }
  return Math.min(range.max, Math.max(range.min, value))
}

// viewTag: the vision-camera <Camera> component's native view tag, e.g.
//   findNodeHandle(cameraRef.current)
// Either iso or shutterNs can be omitted to leave that one alone — but
// CONTROL_AE_MODE is forced off either way, since manual ISO/shutter are
// ignored by the sensor while auto-exposure is running.
// Out-of-range values are clamped to the hardware's real range rather than
// rejected outright — matches how a physical dial behaves at its stops.
export function applyManualExposure(viewTag: number, iso: number | null, shutterNs: number | null): void {
  const clampedIso = iso == null ? null : Math.round(clamp(iso, ISO_RANGE))
  const clampedShutterNs = shutterNs == null ? null : Math.round(clamp(shutterNs, SHUTTER_NS_RANGE))
  CameraManualNative.applyManualExposure(viewTag, clampedIso, clampedShutterNs)
}

// Independent of exposure — safe to call without touching ISO/shutter.
export function applyWhiteBalance(viewTag: number, preset: WhiteBalancePresetName): void {
  CameraManualNative.applyWhiteBalance(viewTag, WhiteBalancePreset[preset])
}

// focusDistanceDiopters: 0 = infinity, up to maxDiopters (the device's real
// LENS_INFO_MINIMUM_FOCUS_DISTANCE — pass activeDevice.minFocusDistance
// converted from vision-camera's cm to diopters: 100 / minFocusDistanceCm).
// Deliberately NOT a hardcoded module constant like ISO_RANGE/SHUTTER_NS_RANGE
// — focus range varies per physical camera (main vs macro vs front) even on
// the same device, unlike the exposure ranges which are pinned to one camera.
export function applyManualFocus(viewTag: number, focusDistanceDiopters: number, maxDiopters: number): void {
  const clamped = clamp(focusDistanceDiopters, { min: 0, max: maxDiopters })
  CameraManualNative.applyManualFocus(viewTag, clamped)
}

export type MeteringMode = 'matrix' | 'center' | 'spot'

// Only has any visible effect while auto-exposure is actually running — i.e.
// NOT while Tier-2 manual exposure (applyManualExposure) is active, since
// AE_REGIONS steers an AE algorithm that's off in that mode. normX/normY are
// 0..1 frame-normalized and only used for 'spot' (default: frame center).
export function applyMeteringMode(viewTag: number, mode: MeteringMode, normX?: number, normY?: number): void {
  CameraManualNative.applyMeteringMode(viewTag, mode, normX ?? null, normY ?? null)
}

// Clears every override (exposure, white balance, focus, metering regions —
// everything) — hands the whole session back to CameraX's normal
// auto-everything behavior in one call.
export function resetToAuto(viewTag: number): void {
  CameraManualNative.resetToAuto(viewTag)
}

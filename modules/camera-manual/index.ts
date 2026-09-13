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

// Clears every override (exposure AND white balance) — hands the whole
// session back to CameraX's normal auto-everything behavior in one call.
export function resetToAuto(viewTag: number): void {
  CameraManualNative.resetToAuto(viewTag)
}

import { requireNativeModule } from 'expo-modules-core'

const CameraManualNative = requireNativeModule('CameraManual')

// Seeker main rear camera (id 0), confirmed via the camera-caps capability
// spike run on real hardware. Different camera ids / different devices have
// different ranges — these are NOT universal Camera2 constants, they're this
// specific sensor's SENSOR_INFO_SENSITIVITY_RANGE / SENSOR_INFO_EXPOSURE_TIME_RANGE.
export const ISO_RANGE = { min: 100, max: 11470 } as const
export const SHUTTER_NS_RANGE = { min: 100_000, max: 16_000_000_000 } as const

// Real photographic ISO stops for the manual notched slider — deliberately a
// curated subset of the hardware's full range (100-11470), not the whole
// thing: a cleaner, more recognizable "camera" feel than a raw continuous
// dial up to 11470. Auto ISO is not limited to these — the platform's own AE
// algorithm can pick any value in the full supported range.
export const ISO_NOTCHES = [100, 200, 400, 800, 1600, 3200] as const

// Filters the notch list against a camera's real SENSOR_INFO_SENSITIVITY_RANGE
// (from camera-caps) — defensive for any camera/device where the range
// doesn't cover the full 100-3200 span (e.g. this app's own camera 3 macro
// lens tops out at isoMax 4000, still fine, but not every device will).
export function filterIsoNotches(range: { min: number; max: number }): number[] {
  return ISO_NOTCHES.filter((n) => n >= range.min && n <= range.max)
}

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

export type AutoManualMode = 'auto' | 'manual'
export type MeteringMode = 'matrix' | 'center' | 'spot'

// ISO and shutter can be controlled independently.
export type CameraControlState = {
  exposureMode?: AutoManualMode
  isoMode?: AutoManualMode
  shutterMode?: AutoManualMode
  iso: number | null
  shutterNs: number | null
  focusMode: AutoManualMode
  focusDistance: number | null // diopters, required when focusMode === 'manual'
  whiteBalance: WhiteBalancePresetName
  metering: MeteringMode
  meteringNormX?: number // 0..1, only used for 'spot'
  meteringNormY?: number
  aeLock?: boolean
  afLock?: boolean
}

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a finite number, got ${value}`)
  }
  return Math.min(range.max, Math.max(range.min, value))
}

// viewTag: the vision-camera <Camera> component's native view tag, e.g.
//   findNodeHandle(cameraRef.current)
//
// Rebuilds the ENTIRE capture-request override state on every call (see the
// native module's own doc comment for why this is the "set" not "add"
// design) — always pass the FULL desired state, not a partial delta.
// ISO/shutter are clamped to this camera's real hardware range; focus is
// NOT clamped here since its range is camera-specific (main vs macro vs
// front) — the caller must clamp against its own maxFocusDiopters.
export async function applyCameraState(viewTag: number, cameraId: string, state: CameraControlState): Promise<void> {
  const iso = state.iso == null ? null : Math.round(clamp(state.iso, ISO_RANGE))
  const shutterNs = state.shutterNs == null ? null : Math.round(clamp(state.shutterNs, SHUTTER_NS_RANGE))
  const isoMode = state.isoMode ?? (state.exposureMode ?? 'auto')
  const shutterMode = state.shutterMode ?? (state.exposureMode ?? 'auto')
  const exposureMode = state.exposureMode ?? (isoMode === 'manual' && shutterMode === 'manual' ? 'manual' : 'auto')

  await CameraManualNative.applyCameraState(viewTag, cameraId, {
    exposureMode,
    isoMode,
    shutterMode,
    iso,
    shutterNs,
    focusMode: state.focusMode,
    focusDistance: state.focusDistance,
    awbMode: WhiteBalancePreset[state.whiteBalance],
    meteringMode: state.metering,
    meteringNormX: state.meteringNormX ?? 0.5,
    meteringNormY: state.meteringNormY ?? 0.5,
    aeLock: state.aeLock ?? false,
    afLock: state.afLock ?? false,
  })
}

// Clears every override (exposure, white balance, focus, metering regions —
// everything) in one call — hands the whole session back to CameraX's
// normal auto-everything behavior without needing to compute a valid full
// state first. Useful on screen unmount/cleanup.
export async function resetToAuto(viewTag: number, cameraId: string): Promise<void> {
  await CameraManualNative.resetToAuto(viewTag, cameraId)
}

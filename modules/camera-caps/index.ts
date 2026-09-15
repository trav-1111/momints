import { requireNativeModule } from 'expo-modules-core'

const CameraCapsNative = requireNativeModule('CameraCaps')

export type CameraCapability = {
  cameraId: string
  lensFacing: 'FRONT' | 'BACK' | 'EXTERNAL' | 'UNKNOWN'
  hardwareLevel: 'LIMITED' | 'FULL' | 'LEGACY' | 'LEVEL_3' | 'EXTERNAL' | 'UNKNOWN'
  availableCapabilities: string[]
  hasManualSensor: boolean
  hasManualPostProcessing: boolean
  hasRaw: boolean
  isoMin: number | null
  isoMax: number | null
  exposureTimeNsMin: number | null
  exposureTimeNsMax: number | null
  minFocusDistanceDiopters: number | null
  manualFocusPossible: boolean
  hasAfModeOff: boolean
  hasAwbModeOff: boolean
  maxRegionsAe: number
  meteringModePossible: boolean
  activeArrayWidth?: number
  activeArrayHeight?: number
  // CONTROL_AE_AVAILABLE_PRIORITY_MODES (API 36+) — whether the platform can
  // run its own auto-exposure for the axis you leave on auto while the other
  // is manually set. Query at runtime; don't infer from OS version alone.
  hasIsoPriority: boolean
  hasShutterPriority: boolean
}

// Reads android.hardware.camera2.CameraCharacteristics directly — this is
// what a THIRD-PARTY app sees, same access level our app has, not the
// privileged/vendor path the Seeker's native camera app may use.
export function getCameraCapabilities(): CameraCapability[] {
  const json = CameraCapsNative.getCameraCapabilitiesJson() as string
  return JSON.parse(json)
}

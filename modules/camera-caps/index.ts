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
}

// Reads android.hardware.camera2.CameraCharacteristics directly — this is
// what a THIRD-PARTY app sees, same access level our app has, not the
// privileged/vendor path the Seeker's native camera app may use.
export function getCameraCapabilities(): CameraCapability[] {
  const json = CameraCapsNative.getCameraCapabilitiesJson() as string
  return JSON.parse(json)
}

import { requireNativeModule } from 'expo-modules-core'

const CameraRawNative = requireNativeModule('CameraRaw')

export interface RawSensorInfo {
  supported: boolean
  cameraId: string
  width: number
  height: number
  cfaPattern: number
  cfaPatternName: 'RGGB' | 'GRBG' | 'GBRG' | 'BGGR' | 'RGB' | 'UNKNOWN'
  whiteLevel: number
  blackLevel: number[]
  isoRange: { min: number; max: number }
  shutterRangeNs: { min: number; max: number }
  hasOis: boolean
}

export interface RawCaptureOptions {
  /**
   * Native viewTag of the active VisionCamera `<Camera>` component (from findNodeHandle(cameraRef.current)).
   * When provided, CameraRawModule gracefully pauses the VisionCamera session lifecycle,
   * acquires the hardware Camera 0 sensor, captures the pure RAW DNG frame, and restores the viewfinder.
   */
  viewTag?: number
  /** Hardware camera ID. Defaults to "0" (Seeker Rear Main). */
  cameraId?: string
  /** Whether to capture a simultaneous hardware JPEG frame alongside the RAW DNG. Defaults to true. */
  includeJpeg?: boolean
  /** Manual ISO sensitivity (100 - 11470). When omitted, Camera2 AE algorithm is used. */
  manualIso?: number
  /** Manual shutter exposure in nanoseconds (100_000 - 16_000_000_000). */
  manualExposureNs?: number
  /** Manual focus distance in diopters (0.0 = infinity). */
  manualFocusDistance?: number
  /** Camera2 White Balance mode preset. */
  whiteBalanceMode?: number
  /** EXIF / DNG orientation (0, 90, 180, 270). */
  orientation?: number
}

export interface RawCaptureResult {
  /** File URI for the generated lossless Adobe DNG file (file:///path/to/raw_xxx.dng). */
  dngUri: string
  /** Absolute local filesystem path for the DNG file. */
  dngPath: string
  /** File size in bytes of the DNG file. */
  dngByteLength: number
  /** Optional file URI for the simultaneous JPEG frame (file:///path/to/frame_xxx.jpg). */
  jpegUri?: string
  /** Optional absolute local filesystem path for the JPEG frame. */
  jpegPath?: string
  /** Optional file size in bytes of the JPEG frame. */
  jpegByteLength?: number
  /** Width in sensor pixels (4000 for Seeker Camera 0). */
  width: number
  /** Height in sensor pixels (3000 for Seeker Camera 0). */
  height: number
  /** Unix timestamp in milliseconds when capture occurred. */
  capturedAt: number
}

/**
 * Checks whether the specified camera ID supports Camera2 RAW_SENSOR stream capability.
 * On Solana Seeker, Camera 0 (Rear Main) returns `true`.
 */
export function isRawSupported(cameraId: string = '0'): boolean {
  try {
    return !!CameraRawNative.isRawSupported(cameraId)
  } catch (error) {
    console.warn('[CameraRaw] Failed to probe isRawSupported:', error)
    return false
  }
}

/**
 * Retrieves low-level sensor metrics for the specified camera (Bayer CFA pattern, white/black levels, OIS).
 */
export function getRawSensorInfo(cameraId: string = '0'): RawSensorInfo | null {
  try {
    return CameraRawNative.getRawSensorInfo(cameraId)
  } catch (error) {
    console.warn('[CameraRaw] Failed to getRawSensorInfo:', error)
    return null
  }
}

/**
 * Captures a native Camera2 RAW Bayer frame and writes a standard Adobe DNG file.
 * Optionally captures a simultaneous ISP-processed JPEG from the exact same exposure.
 */
export async function captureRawDng(options: RawCaptureOptions = {}): Promise<RawCaptureResult> {
  return await CameraRawNative.captureRawDng({
    cameraId: options.cameraId ?? '0',
    includeJpeg: options.includeJpeg ?? true,
    viewTag: options.viewTag,
    manualIso: options.manualIso,
    manualExposureNs: options.manualExposureNs,
    manualFocusDistance: options.manualFocusDistance,
    whiteBalanceMode: options.whiteBalanceMode,
    orientation: options.orientation ?? 0,
  })
}

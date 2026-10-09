import type { CameraCapability } from '../../../modules/camera-caps'

type FocusCapability = Pick<CameraCapability, 'cameraId' | 'manualFocusPossible' | 'minFocusDistanceDiopters'>

// Seeker main lens can focus past its reported guaranteed-sharp 2-diopter floor.
const SEEKER_FOCUS_HEADROOM_DIOPTERS = 20

export function resolveManualFocusRange(
  cameraId: string | null,
  visionMinimumDistanceCm: number | null | undefined,
  capabilities: FocusCapability[],
): number | null {
  if (!cameraId) return null
  const native = capabilities.find((item) => item.cameraId === cameraId)
  if (native) {
    const distance = native.minFocusDistanceDiopters
    return native.manualFocusPossible && distance != null && Number.isFinite(distance) && distance > 0
      ? distance + SEEKER_FOCUS_HEADROOM_DIOPTERS
      : null
  }
  return visionMinimumDistanceCm != null && Number.isFinite(visionMinimumDistanceCm) && visionMinimumDistanceCm > 0
    ? 100 / visionMinimumDistanceCm + SEEKER_FOCUS_HEADROOM_DIOPTERS
    : null
}

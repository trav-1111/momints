// Centralizes ALL Camera2Interop-driven state (ISO, shutter, focus, white
// balance, metering) in one place. This is required, not just tidy: the
// native applyCameraState call REPLACES the entire capture-request override
// set on every invocation (see camera-manual's own doc comment for why) —
// if two components each independently called it with only their own slice
// of state, whichever called last would silently wipe out the other's
// settings. camera.tsx and ManualControls both read/write through this one
// hook instead of owning any of this state themselves.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyCameraState,
  resetToAuto,
  type AutoManualMode,
  type MeteringMode,
  type WhiteBalancePresetName,
} from '../../modules/camera-manual'
import { getCameraCapabilities } from '../../modules/camera-caps'

const DEFAULT_ISO = 400
const DEFAULT_SHUTTER_NS = 1_000_000 // 1/1000s

export function useManualCameraState(
  viewTag: number | null,
  cameraId: string | null,
  maxFocusDiopters: number | null,
) {
  // ISO and shutter share one exposure mode (see camera-manual's index.ts
  // CameraControlState doc comment) — manualIso/manualShutterNs are kept as
  // their own state regardless of mode so a round trip through Auto never
  // loses the user's last manual values.
  const [exposureMode, setExposureMode] = useState<AutoManualMode>('auto')
  const [manualIso, setManualIso] = useState(DEFAULT_ISO)
  const [manualShutterNs, setManualShutterNs] = useState(DEFAULT_SHUTTER_NS)

  // Focus: no clean way to read the live CaptureResult-reported lens
  // position (would need a CameraCaptureSession.CaptureCallback attached at
  // use-case build time, before vision-camera binds its own Preview/
  // ImageCapture — not reachable via this reflection-based approach without
  // forking vision-camera). Falls back to preserving the last manually-set
  // value instead of "wherever autofocus last converged."
  const [focusMode, setFocusMode] = useState<AutoManualMode>('auto')
  const [manualFocusDiopters, setManualFocusDiopters] = useState(0) // 0 = infinity

  const [whiteBalance, setWhiteBalance] = useState<WhiteBalancePresetName>('AUTO')
  const [meteringMode, setMeteringMode] = useState<MeteringMode>('matrix')
  const [meteringPoint, setMeteringPoint] = useState({ x: 0.5, y: 0.5 })

  // CONTROL_AE_AVAILABLE_PRIORITY_MODES (API 36+) — read once per camera.
  // Not used to drive any control anymore (see CameraControlState's doc
  // comment: confirmed false on the real Seeker, so there's no independent-
  // auto UI to gate) — kept only to surface an honest capability note below
  // instead of silently implying a capability this hardware doesn't have,
  // and as a live signal for a future device/build that does support it.
  const { hasIsoPriority, hasShutterPriority } = useMemo(() => {
    if (cameraId == null) return { hasIsoPriority: false, hasShutterPriority: false }
    try {
      const caps = getCameraCapabilities().find((c) => c.cameraId === cameraId)
      return {
        hasIsoPriority: caps?.hasIsoPriority ?? false,
        hasShutterPriority: caps?.hasShutterPriority ?? false,
      }
    } catch {
      return { hasIsoPriority: false, hasShutterPriority: false }
    }
  }, [cameraId])

  const canIndependentExposure = hasIsoPriority && hasShutterPriority
  const fullyManual = exposureMode === 'manual'

  useEffect(() => {
    if (viewTag == null) return
    applyCameraState(viewTag, {
      exposureMode,
      iso: exposureMode === 'manual' ? manualIso : null,
      shutterNs: exposureMode === 'manual' ? manualShutterNs : null,
      focusMode,
      focusDistance: focusMode === 'manual' ? manualFocusDiopters : null,
      whiteBalance,
      metering: meteringMode,
      meteringNormX: meteringPoint.x,
      meteringNormY: meteringPoint.y,
    })
  }, [
    viewTag,
    exposureMode,
    manualIso,
    manualShutterNs,
    focusMode,
    manualFocusDiopters,
    whiteBalance,
    meteringMode,
    meteringPoint,
  ])

  const reset = useCallback(() => {
    if (viewTag == null) return
    resetToAuto(viewTag)
    setExposureMode('auto')
    setFocusMode('auto')
    setWhiteBalance('AUTO')
    setMeteringMode('matrix')
  }, [viewTag])

  return {
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
    meteringMode,
    setMeteringMode,
    meteringPoint,
    setMeteringPoint,
    canIndependentExposure,
    fullyManual,
    reset,
  }
}

export type ManualCameraState = ReturnType<typeof useManualCameraState>

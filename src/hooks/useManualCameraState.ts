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
  const [isoMode, setIsoMode] = useState<AutoManualMode>('auto')
  const [manualIso, setManualIso] = useState(DEFAULT_ISO)
  const [shutterMode, setShutterMode] = useState<AutoManualMode>('auto')
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
  // Independent ISO/shutter auto toggles only make sense if the platform can
  // actually run its own AE for whichever one is left on auto; otherwise
  // fall back to a single paired toggle (see isoMode/shutterMode setters
  // below, which enforce pairing when unsupported).
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

  // When independent priority modes aren't available, ISO and shutter are
  // pinned together — setting one manual forces the other manual too (both
  // land on plain AE_MODE_OFF, which needs no priority-mode support at all).
  const setIsoModeGuarded = useCallback(
    (next: AutoManualMode) => {
      setIsoMode(next)
      if (!canIndependentExposure) setShutterMode(next)
    },
    [canIndependentExposure],
  )
  const setShutterModeGuarded = useCallback(
    (next: AutoManualMode) => {
      setShutterMode(next)
      if (!canIndependentExposure) setIsoMode(next)
    },
    [canIndependentExposure],
  )

  const fullyManual = isoMode === 'manual' && shutterMode === 'manual'

  useEffect(() => {
    if (viewTag == null) return
    applyCameraState(viewTag, {
      isoMode,
      iso: isoMode === 'manual' ? manualIso : null,
      shutterMode,
      shutterNs: shutterMode === 'manual' ? manualShutterNs : null,
      focusMode,
      focusDistance: focusMode === 'manual' ? manualFocusDiopters : null,
      whiteBalance,
      metering: meteringMode,
      meteringNormX: meteringPoint.x,
      meteringNormY: meteringPoint.y,
    })
  }, [
    viewTag,
    isoMode,
    manualIso,
    shutterMode,
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
    setIsoMode('auto')
    setShutterMode('auto')
    setFocusMode('auto')
    setWhiteBalance('AUTO')
    setMeteringMode('matrix')
  }, [viewTag])

  return {
    isoMode,
    setIsoMode: setIsoModeGuarded,
    manualIso,
    setManualIso,
    shutterMode,
    setShutterMode: setShutterModeGuarded,
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

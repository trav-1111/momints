// Centralizes ALL Camera2Interop-driven state (ISO, shutter, focus, white
// balance, metering) in one place. This is required, not just tidy: the
// native applyCameraState call REPLACES the entire capture-request override
// set on every invocation (see camera-manual's own doc comment for why) —
// if two components each independently called it with only their own slice
// of state, whichever called last would silently wipe out the other's
// settings. camera.tsx and ManualControls both read/write through this one
// hook instead of owning any of this state themselves.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyCameraState,
  type AutoManualMode,
  type MeteringMode,
  type WhiteBalancePresetName,
} from '../../modules/camera-manual'
import { getCameraCapabilities } from '../../modules/camera-caps'
import type { ReadyCameraSession } from './useCameraReadiness'

const DEFAULT_ISO = 400
const DEFAULT_SHUTTER_NS = 1_000_000 // 1/1000s

export type CameraLockMode = 'none' | 'AF/AE' | 'AE' | 'AF'

export function useManualCameraState(
  session: ReadyCameraSession | null,
  cameraId: string | null,
  maxFocusDiopters: number | null,
  isSessionCurrent: (session: ReadyCameraSession) => boolean,
) {
  // ISO and shutter have independent auto/manual modes.
  // manualIso/manualShutterNs are kept as their own state regardless of mode so
  // a round trip through Auto never loses the user's last manual values.
  const [isoMode, setIsoMode] = useState<AutoManualMode>('auto')
  const [shutterMode, setShutterMode] = useState<AutoManualMode>('auto')
  const [manualIso, setManualIso] = useState(DEFAULT_ISO)
  const [manualShutterNs, setManualShutterNs] = useState(DEFAULT_SHUTTER_NS)

  // Derived exposureMode for backwards compatibility with tests and callers
  const exposureMode: AutoManualMode = isoMode === 'manual' && shutterMode === 'manual' ? 'manual' : 'auto'
  const setExposureMode = useCallback((mode: AutoManualMode) => {
    setIsoMode(mode)
    setShutterMode(mode)
  }, [])

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

  // AF/AE Lock system — hold-to-lock on the viewfinder.
  //   'none': standard continuous auto
  //   'AF/AE': both focus and exposure locked to the target point
  //   'AE': exposure locked to that area's brightness; focus remains continuous
  //   'AF': focus locked to target distance; exposure adapts continuously
  const [lockMode, setLockMode] = useState<CameraLockMode>('none')
  const [lockPoint, setLockPoint] = useState<{ x: number; y: number } | null>(null)
  const [exposurePoint, setExposurePoint] = useState<{ x: number; y: number } | null>(null)

  const isAeLocked = lockMode === 'AF/AE' || lockMode === 'AE'
  const isAfLocked = lockMode === 'AF/AE' || lockMode === 'AF'

  const lock = useCallback(
    (mode: CameraLockMode, normPoint?: { x: number; y: number }, normExpPoint?: { x: number; y: number }) => {
      setLockMode(mode)
      if (normPoint) {
        setLockPoint(normPoint)
      }
      if (normExpPoint) {
        setExposurePoint(normExpPoint)
      }
    },
    [],
  )

  const unlock = useCallback(() => {
    setLockMode('none')
    setLockPoint(null)
    setExposurePoint(null)
  }, [])

  const cycleLockMode = useCallback(() => {
    setLockMode((prev) => {
      if (prev === 'AF/AE') return 'AE'
      if (prev === 'AE') return 'AF'
      if (prev === 'AF') return 'AF/AE'
      return 'AF/AE'
    })
  }, [])

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

  const canIndependentExposure = true
  const fullyManual = isoMode === 'manual' && shutterMode === 'manual'

  const desiredState = useMemo(() => {
    const activeExp = exposurePoint ?? lockPoint ?? meteringPoint
    return {
      exposureMode,
      isoMode,
      shutterMode,
      iso: isoMode === 'manual' ? manualIso : null,
      shutterNs: shutterMode === 'manual' ? manualShutterNs : null,
      focusMode,
      focusDistance: focusMode === 'manual' ? manualFocusDiopters : null,
      whiteBalance,
      metering: isAeLocked ? ('spot' as MeteringMode) : meteringMode,
      meteringNormX: isAeLocked ? activeExp.x : meteringPoint.x,
      meteringNormY: isAeLocked ? activeExp.y : meteringPoint.y,
      aeLock: isAeLocked,
      afLock: isAfLocked,
    }
  }, [
    exposureMode,
    isoMode,
    shutterMode,
    manualIso,
    manualShutterNs,
    focusMode,
    manualFocusDiopters,
    whiteBalance,
    meteringMode,
    meteringPoint,
    isAeLocked,
    isAfLocked,
    lockPoint,
    exposurePoint,
  ])

  const [retryGeneration, setRetryGeneration] = useState(0)
  type Applied = { session: ReadyCameraSession; state: typeof desiredState; retryGeneration: number }
  const [applied, setApplied] = useState<Applied | null>(null)
  const [failure, setFailure] = useState<{
    session: ReadyCameraSession
    state: typeof desiredState
    error: Error
  } | null>(null)
  const latest = useRef({ session, desiredState, retryGeneration })
  latest.current = { session, desiredState, retryGeneration }
  const acknowledged = useRef<Applied | null>(null)
  const canCapture = useCallback(() => {
    const now = latest.current
    const ack = acknowledged.current
    return !!(
      now.session &&
      isSessionCurrent(now.session) &&
      ack?.session === now.session &&
      ack.state === now.desiredState &&
      ack.retryGeneration === now.retryGeneration
    )
  }, [isSessionCurrent])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stillCurrent = () =>
      !cancelled &&
      isSessionCurrent(session) &&
      latest.current.session === session &&
      latest.current.desiredState === desiredState &&
      latest.current.retryGeneration === retryGeneration
    const apply = async (attempt: number) => {
      if (!stillCurrent()) return
      try {
        await applyCameraState(session.viewTag, session.cameraId, desiredState)
        if (!stillCurrent()) return
        const ack = { session, state: desiredState, retryGeneration }
        acknowledged.current = ack
        setApplied(ack)
        setFailure(null)
      } catch (error) {
        if (!stillCurrent()) return
        // Only the known binding race is retryable. No infinite polling and no
        // swallowed hardware, reflection, settings or timeout failures.
        if ((error as { code?: string })?.code === 'ERR_CAMERA_NOT_BOUND' && attempt < 2) {
          timer = setTimeout(() => void apply(attempt + 1), 100 * (attempt + 1))
          return
        }
        setFailure({ session, state: desiredState, error: error instanceof Error ? error : new Error(String(error)) })
      }
    }
    void apply(0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [session, desiredState, retryGeneration, isSessionCurrent])

  const controlsReady = !!(
    session &&
    applied?.session === session &&
    applied.state === desiredState &&
    applied.retryGeneration === retryGeneration
  )
  const controlsError = failure?.session === session && failure?.state === desiredState ? failure.error : null
  const retry = useCallback(() => {
    setFailure(null)
    setRetryGeneration((value) => value + 1)
  }, [])

  const reset = useCallback(() => {
    // Reset desired JS state even when unbound. The same acknowledged full-state
    // application handles the native reset once this session is ready again.
    setIsoMode('auto')
    setShutterMode('auto')
    setFocusMode('auto')
    setWhiteBalance('AUTO')
    setMeteringMode('matrix')
    setLockMode('none')
    setLockPoint(null)
    setExposurePoint(null)
    retry()
  }, [retry])

  return {
    exposureMode,
    setExposureMode,
    isoMode,
    setIsoMode,
    shutterMode,
    setShutterMode,
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
    lockMode,
    setLockMode,
    lockPoint,
    setLockPoint,
    exposurePoint,
    setExposurePoint,
    lock,
    unlock,
    cycleLockMode,
    isAeLocked,
    isAfLocked,
    canIndependentExposure,
    fullyManual,
    reset,
    controlsReady,
    controlsError,
    canCapture,
    retry,
  }
}

export type ManualCameraState = ReturnType<typeof useManualCameraState>

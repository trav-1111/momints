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
  getAmbientLight,
  type AutoManualMode,
  type MeteringMode,
  type WhiteBalancePresetName,
} from '../../modules/camera-manual'
import { getCameraCapabilities } from '../../modules/camera-caps'
import type { ReadyCameraSession } from './useCameraReadiness'

const DEFAULT_ISO = 400
const DEFAULT_SHUTTER_NS = 16_666_667 // 1/60s baseline (16.6ms)

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

  // Aperture / Depth of Field emulation mode.
  // 'auto': native optical f/1.7 lens without computational depth processing.
  // 'manual': emulated f-stop (f/1.2 - f/16), driving focal bracketing / DfD bokeh.
  const [apertureMode, setApertureMode] = useState<AutoManualMode>('auto')
  const [apertureValue, setApertureValue] = useState<number>(1.8)
  const [apertureGain, setApertureGain] = useState<number>(0)

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

  const [sceneEv, setSceneEv] = useState(10.5)

  useEffect(() => {
    let active = true
    const timer = setInterval(() => {
      if (!active) return
      try {
        const reading = getAmbientLight()
        if (typeof reading.sceneEv === 'number' && Number.isFinite(reading.sceneEv)) {
          setSceneEv((prev) => {
            const target = reading.sceneEv
            return Math.abs(prev - target) < 0.05 ? target : prev * 0.75 + target * 0.25
          })
        }
      } catch {}
    }, 100)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

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

  const canIndependentExposure = hasIsoPriority && hasShutterPriority
  const fullyManual = isoMode === 'manual' && shutterMode === 'manual'
  const isEvEnabled = isoMode === 'auto' && shutterMode === 'auto' && exposureMode === 'auto' && !fullyManual

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
  const isAutoDefault = useMemo(() => {
    return (
      desiredState.exposureMode === 'auto' &&
      desiredState.isoMode === 'auto' &&
      desiredState.shutterMode === 'auto' &&
      desiredState.focusMode === 'auto' &&
      desiredState.whiteBalance === 'AUTO' &&
      desiredState.metering === 'matrix' &&
      !desiredState.aeLock &&
      !desiredState.afLock
    )
  }, [desiredState])

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
    if (!now.session || !isSessionCurrent(now.session)) return false
    if (!isAutoDefault) {
      return !!(
        ack?.session === now.session &&
        ack.state === now.desiredState &&
        ack.retryGeneration === now.retryGeneration
      )
    }
    return true
  }, [isSessionCurrent, isAutoDefault])

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
        // Only the known binding race is retryable.
        const isNotBound = (error as { code?: string })?.code === 'ERR_CAMERA_NOT_BOUND'
        if (isNotBound && attempt < 8) {
          timer = setTimeout(() => void apply(attempt + 1), 150 * Math.min(attempt + 1, 4))
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
    (isAutoDefault ||
      (applied?.session === session &&
        applied.state === desiredState &&
        applied.retryGeneration === retryGeneration))
  )
  const controlsError =
    !isAutoDefault && failure?.session === session && failure?.state === desiredState ? failure.error : null
  const retry = useCallback(() => {
    setFailure(null)
    setRetryGeneration((value) => value + 1)
  }, [])

  const reset = useCallback(() => {
    // Reset desired JS state even when unbound. The same acknowledged full-state
    // application handles the native reset once this session is ready again.
    setExposureMode('auto')
    setFocusMode('auto')
    setApertureMode('auto')
    setApertureValue(1.8)
    setApertureGain(0)
    setWhiteBalance('AUTO')
    setMeteringMode('matrix')
    setLockMode('none')
    setLockPoint(null)
    setExposurePoint(null)
    retry()
  }, [retry, setExposureMode])

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
    apertureMode,
    setApertureMode,
    apertureValue,
    setApertureValue,
    apertureGain,
    setApertureGain,
    isEvEnabled,
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
    sceneEv,
  }
}

export type ManualCameraState = ReturnType<typeof useManualCameraState>

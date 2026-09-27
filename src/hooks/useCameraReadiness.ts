import { useCallback, useRef, useState } from 'react'
import { findNodeHandle } from 'react-native'
import type { Camera, CameraRuntimeError } from 'react-native-vision-camera'

export type ReadyCameraSession = { viewTag: number; cameraId: string; generation: number }
type Binding = { session: ReadyCameraSession | null; started: boolean }

// A React view handle is NOT a bound CameraX session. Keep binding and streaming
// signals separate, and invalidate synchronously so a shutter callback cannot
// use yesterday's readiness while React is scheduling the next render.
export function useCameraReadiness(cameraId: string | null, active: boolean) {
  const cameraRef = useRef<Camera | null>(null)
  const identity = useRef({ cameraId, active })
  identity.current = { cameraId, active }
  const generation = useRef(0)
  const current = useRef<Binding>({ session: null, started: false })
  const [binding, setBinding] = useState(current.current)
  const [error, setError] = useState<CameraRuntimeError | null>(null)
  const publish = useCallback((next: Binding) => {
    current.current = next
    setBinding(next)
  }, [])
  const invalidate = useCallback(() => {
    publish({ ...current.current, started: false })
  }, [publish])
  const ref = useCallback(
    (camera: Camera | null) => {
      cameraRef.current = camera
      publish({ session: null, started: false })
    },
    [publish],
  )
  const onInitialized = useCallback(() => {
    const viewTag = findNodeHandle(cameraRef.current)
    if (viewTag == null || cameraId == null) return
    setError(null)
    publish({ session: { viewTag, cameraId, generation: ++generation.current }, started: false })
  }, [cameraId, publish])
  const onStarted = useCallback(() => {
    const previous = current.current.session
    if (!previous || previous.cameraId !== cameraId || findNodeHandle(cameraRef.current) !== previous.viewTag) return
    // Resuming the same native view still requires a fresh settings application.
    publish({ session: { ...previous, generation: ++generation.current }, started: true })
  }, [cameraId, publish])
  const onError = useCallback(
    (failure: CameraRuntimeError) => {
      publish({ session: null, started: false })
      setError(failure)
    },
    [publish],
  )
  const isCurrent = useCallback((session: ReadyCameraSession) => {
    return (
      identity.current.active &&
      identity.current.cameraId === session.cameraId &&
      current.current.started &&
      current.current.session === session &&
      findNodeHandle(cameraRef.current) === session.viewTag
    )
  }, [])
  const session = active && binding.started && binding.session?.cameraId === cameraId ? binding.session : null
  return {
    cameraRef,
    ref,
    session,
    isCurrent,
    invalidate,
    onInitialized,
    onStarted,
    onStopped: invalidate,
    onError,
    error,
  }
}

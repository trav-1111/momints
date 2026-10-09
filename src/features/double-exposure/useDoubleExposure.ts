import { useCallback, useState } from 'react'
import { deleteCapture } from '../../services/imagePrivacy'

export interface DoubleExposureState {
  isMxActive: boolean
  firstExposureUri: string | null
  toggleMx: () => void
  recordFirstExposure: (uri: string) => void
  resetMx: () => void
}

/**
 * Hook to manage Lomography-style multiple exposure state.
 * When active, the first shutter release stores a latent exposure without advancing the film,
 * and the second shutter release blends both frames before advancing.
 */
export function useDoubleExposure(): DoubleExposureState {
  const [isMxActive, setIsMxActive] = useState<boolean>(false)
  const [firstExposureUri, setFirstExposureUri] = useState<string | null>(null)

  const toggleMx = useCallback(() => {
    setIsMxActive((prev) => {
      const next = !prev
      if (!next && firstExposureUri) {
        // Discard any uncommitted latent first exposure if MX is turned off
        deleteCapture(firstExposureUri)
        setFirstExposureUri(null)
      }
      return next
    })
  }, [firstExposureUri])

  const recordFirstExposure = useCallback((uri: string) => {
    setFirstExposureUri(uri)
  }, [])

  const resetMx = useCallback(() => {
    if (firstExposureUri) {
      deleteCapture(firstExposureUri)
    }
    setFirstExposureUri(null)
  }, [firstExposureUri])

  return {
    isMxActive,
    firstExposureUri,
    toggleMx,
    recordFirstExposure,
    resetMx,
  }
}

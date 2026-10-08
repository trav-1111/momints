import { create } from 'zustand'
import { Paths, File } from 'expo-file-system'

export type KinoCaptureSpeed = 3 | 5 | 8 // FPS: 3 = Slow Crank, 5 = Classic LomoKino, 8 = Nikon F5 High-Speed Motor Drive
export type KinoPlaybackSpeed = 3 | 5 | 8 | 12 | 18 | 24 // FPS
export type KinoShutterGap = 'off' | 'subtle' | 'classic' | 'deep'

export const SHUTTER_GAP_MS: Record<KinoShutterGap, number> = {
  off: 0,
  subtle: 18,
  classic: 32,
  deep: 50,
}

export const CAPTURE_CADENCE_MS: Record<KinoCaptureSpeed, number> = {
  3: 333,
  5: 200,
  8: 125, // 8 FPS (Nikon F5 SLR motor drive cadence)
}

export const KINO_CAPTURE_SPEEDS: KinoCaptureSpeed[] = [3, 5, 8]
export const KINO_PLAYBACK_SPEEDS: KinoPlaybackSpeed[] = [3, 5, 8, 12, 18, 24]
export const KINO_SHUTTER_GAPS: KinoShutterGap[] = ['off', 'subtle', 'classic', 'deep']

export const KINO_SHUTTER_GAP_LABELS: Record<KinoShutterGap, string> = {
  off: 'OFF',
  subtle: 'SUBTLE',
  classic: 'CLASSIC',
  deep: 'DEEP',
}

/**
 * Computes the exact blackout duration in milliseconds for a given shutter gap
 * and playback FPS, simulating authentic mechanical rotary shutter angles:
 * - off: 0ms
 * - subtle: ~18% frame period
 * - classic: ~38% frame period (authentic 180° rotary blade)
 * - deep: ~58% frame period (deep cinema projector flicker)
 */
export function getShutterBlackoutMs(gap: KinoShutterGap, fps: KinoPlaybackSpeed): number {
  if (gap === 'off') return 0
  const period = 1000 / fps
  switch (gap) {
    case 'subtle':
      return Math.round(Math.max(12, period * 0.18))
    case 'classic':
      return Math.round(Math.max(20, period * 0.38))
    case 'deep':
      return Math.round(Math.max(30, period * 0.58))
  }
}

interface KinoSettingsStore {
  captureFps: KinoCaptureSpeed
  playbackFps: KinoPlaybackSpeed
  shutterGap: KinoShutterGap
  setCaptureFps: (fps: KinoCaptureSpeed) => void
  setPlaybackFps: (fps: KinoPlaybackSpeed) => void
  setShutterGap: (gap: KinoShutterGap) => void
  cycleCaptureFps: () => KinoCaptureSpeed
  cycleShutterGap: () => KinoShutterGap
}

const STORAGE_KEY = 'kino-settings-store'

function parseCaptureFps(value: unknown): KinoCaptureSpeed {
  return value === 3 || value === 5 || value === 8 ? value : value === 7 ? 8 : 5
}

function parsePlaybackFps(value: unknown): KinoPlaybackSpeed {
  return value === 3 || value === 5 || value === 8 || value === 12 || value === 18 || value === 24
    ? value
    : value === 7
      ? 8
      : 8
}

function parseShutterGap(value: unknown): KinoShutterGap {
  return value === 'off' || value === 'subtle' || value === 'classic' || value === 'deep' ? value : 'classic'
}

async function readPersistedKinoSettings(): Promise<{
  captureFps: KinoCaptureSpeed
  playbackFps: KinoPlaybackSpeed
  shutterGap: KinoShutterGap
}> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) {
      return { captureFps: 5, playbackFps: 8, shutterGap: 'classic' }
    }
    const text = await file.text()
    const data = JSON.parse(text)
    return {
      captureFps: parseCaptureFps(data?.captureFps),
      playbackFps: parsePlaybackFps(data?.playbackFps),
      shutterGap: parseShutterGap(data?.shutterGap),
    }
  } catch {
    return { captureFps: 5, playbackFps: 8, shutterGap: 'classic' }
  }
}

function persistKinoSettings(settings: {
  captureFps: KinoCaptureSpeed
  playbackFps: KinoPlaybackSpeed
  shutterGap: KinoShutterGap
}): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(JSON.stringify(settings))
  } catch {
    // non-critical
  }
}

export const useKinoSettingsStore = create<KinoSettingsStore>()((set, get) => ({
  captureFps: 5,
  playbackFps: 8,
  shutterGap: 'classic',

  setCaptureFps: (captureFps) => {
    const next = { ...get(), captureFps }
    persistKinoSettings(next)
    set({ captureFps })
  },

  setPlaybackFps: (playbackFps) => {
    const next = { ...get(), playbackFps }
    persistKinoSettings(next)
    set({ playbackFps })
  },

  setShutterGap: (shutterGap) => {
    const next = { ...get(), shutterGap }
    persistKinoSettings(next)
    set({ shutterGap })
  },

  cycleCaptureFps: () => {
    const current = get().captureFps
    const nextFps: KinoCaptureSpeed = current === 3 ? 5 : current === 5 ? 8 : 3
    get().setCaptureFps(nextFps)
    return nextFps
  },

  cycleShutterGap: () => {
    const current = get().shutterGap
    const order: KinoShutterGap[] = ['classic', 'deep', 'off', 'subtle']
    const nextIdx = (order.indexOf(current) + 1) % order.length
    const nextGap = order[nextIdx]
    get().setShutterGap(nextGap)
    return nextGap
  },
}))

readPersistedKinoSettings().then((settings) => {
  useKinoSettingsStore.setState(settings)
})

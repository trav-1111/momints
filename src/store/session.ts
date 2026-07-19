import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'quick' | 'roll'
export type RollSize = 12 | 24 | 36

// Per-roll film emulation settings. Applied to every frame captured on the roll.
// Extensible toward the roadmap (film stock, ISO grain) without another migration.
export type FilmMode = 'color' | 'bw'
export interface FilmSettings {
  mode: FilmMode
  // future: iso?: number; stock?: string
}

export const DEFAULT_FILM: FilmSettings = { mode: 'color' }

// Capture aspect ratio. 'full' keeps the sensor's native frame (no crop);
// the others center-crop the photo. In roll mode this is fixed at creation.
export type AspectRatio = '1:1' | '4:3' | '16:9' | 'full'
export const DEFAULT_ASPECT: AspectRatio = 'full'

export interface ActiveRoll {
  id: string
  name: string
  size: RollSize
  film: FilmSettings
  aspect: AspectRatio
  frameIds: string[]
  startedAt: number
  // false = open (shooting; frames hidden). true = developed (closed to further
  // shots; frames become reviewable and mintable). Like real film.
  developed: boolean
  collectionAddress?: string
}

interface PersistedSession {
  hasSetMode: boolean
  activeMode: AppMode
  activeRoll: ActiveRoll | null
}

interface SessionStore extends PersistedSession {
  selectQuickMode: () => void
  startRoll: (name: string, size: RollSize, film: FilmSettings, aspect: AspectRatio) => boolean
  resumeRoll: () => void
  addFrameToRoll: (photoId: string) => void
  developRoll: () => void
  removeFrameFromRoll: (photoId: string) => void
  abandonRoll: () => void
  completeRoll: () => void
  setCollectionAddress: (address: string) => void
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT: PersistedSession = {
  hasSetMode: false,
  activeMode: 'quick',
  activeRoll: null,
}

const STORAGE_KEY = 'session-store'

// ─── Persistence ──────────────────────────────────────────────────────────────

function parseActiveRoll(raw: unknown): ActiveRoll | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.startedAt !== 'number' ||
    !Array.isArray(r.frameIds) ||
    (r.size !== 12 && r.size !== 24 && r.size !== 36)
  ) {
    return null
  }
  return {
    id: r.id,
    name: r.name,
    size: r.size as RollSize,
    film: parseFilmSettings(r.film),
    aspect: parseAspect(r.aspect),
    frameIds: (r.frameIds as unknown[]).filter((f): f is string => typeof f === 'string'),
    startedAt: r.startedAt,
    developed: r.developed === true,
    collectionAddress: typeof r.collectionAddress === 'string' ? r.collectionAddress : undefined,
  }
}

// Defaults to color when missing or invalid so rolls persisted before film
// settings existed hydrate as color (backward compatible).
function parseFilmSettings(raw: unknown): FilmSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_FILM }
  const f = raw as Record<string, unknown>
  return { mode: f.mode === 'bw' ? 'bw' : 'color' }
}

// Defaults to full-frame for rolls persisted before aspect ratios existed.
function parseAspect(raw: unknown): AspectRatio {
  return raw === '1:1' || raw === '4:3' || raw === '16:9' ? raw : DEFAULT_ASPECT
}

async function readPersistedSession(): Promise<PersistedSession> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return DEFAULT
    const text = await file.text()
    const data: unknown = JSON.parse(text)
    if (data === null || typeof data !== 'object') return DEFAULT
    const d = data as Record<string, unknown>

    // Accept the single-roll shape (activeRoll) and migrate the interim
    // multi-roll shape (rolls[] + currentRollId) down to one active roll.
    let activeRoll = parseActiveRoll(d.activeRoll)
    if (!activeRoll && Array.isArray(d.rolls)) {
      const parsed = d.rolls.map(parseActiveRoll).filter((r): r is ActiveRoll => r !== null)
      const current = parsed.find((r) => r.id === d.currentRollId)
      activeRoll = current ?? parsed[0] ?? null
    }

    return {
      hasSetMode: typeof d.hasSetMode === 'boolean' ? d.hasSetMode : DEFAULT.hasSetMode,
      activeMode: d.activeMode === 'roll' ? 'roll' : 'quick',
      activeRoll,
    }
  } catch {
    return DEFAULT
  }
}

function persistSession(state: PersistedSession): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(
      JSON.stringify({
        hasSetMode: state.hasSetMode,
        activeMode: state.activeMode,
        activeRoll: state.activeRoll,
      }),
    )
  } catch {
    // non-critical
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()((set, get) => {
  // Persist the current state and apply the same object to the store.
  const commit = (next: PersistedSession) => {
    persistSession(next)
    set(next)
  }

  return {
    ...DEFAULT,

    // Quick mode keeps the roll in progress — it stays active until developed
    // and minted, or discarded, so you can pop out for single shots.
    selectQuickMode: () => {
      commit({ hasSetMode: true, activeMode: 'quick', activeRoll: get().activeRoll })
    },

    // One roll at a time — refuse a new roll while one is in progress.
    startRoll: (name, size, film, aspect) => {
      if (get().activeRoll) return false
      const newRoll: ActiveRoll = {
        id: uuidv4(),
        name,
        size,
        film,
        aspect,
        frameIds: [],
        startedAt: Date.now(),
        developed: false,
      }
      commit({ hasSetMode: true, activeMode: 'roll', activeRoll: newRoll })
      return true
    },

    // Re-enter roll mode for the in-progress roll (from quick mode / mode-select).
    resumeRoll: () => {
      const { activeRoll } = get()
      if (!activeRoll) return
      commit({ hasSetMode: true, activeMode: 'roll', activeRoll })
    },

    addFrameToRoll: (photoId) => {
      const { activeRoll } = get()
      if (!activeRoll || activeRoll.developed || activeRoll.frameIds.length >= activeRoll.size) return
      const updated: ActiveRoll = { ...activeRoll, frameIds: [...activeRoll.frameIds, photoId] }
      commit({ hasSetMode: true, activeMode: 'roll', activeRoll: updated })
    },

    // Develop = close the roll to further shots and reveal its frames.
    developRoll: () => {
      const { activeMode, activeRoll } = get()
      if (!activeRoll || activeRoll.developed) return
      commit({ hasSetMode: true, activeMode, activeRoll: { ...activeRoll, developed: true } })
    },

    // Cull a frame from a developed roll before minting. Photo/file cleanup is
    // the caller's responsibility — see useRollActions.
    removeFrameFromRoll: (photoId) => {
      const { activeMode, activeRoll } = get()
      if (!activeRoll) return
      const updated: ActiveRoll = {
        ...activeRoll,
        frameIds: activeRoll.frameIds.filter((id) => id !== photoId),
      }
      commit({ hasSetMode: true, activeMode, activeRoll: updated })
    },

    // Discard a roll without minting it (frees the slot).
    abandonRoll: () => {
      commit({ hasSetMode: get().hasSetMode, activeMode: get().activeMode, activeRoll: null })
    },

    // Distinct from abandonRoll so Week 5 can archive the finished roll
    // (collection address, frame mints) without touching discard semantics.
    completeRoll: () => {
      commit({ hasSetMode: get().hasSetMode, activeMode: get().activeMode, activeRoll: null })
    },

    setCollectionAddress: (address) => {
      const { activeMode, activeRoll } = get()
      if (!activeRoll) return
      commit({ hasSetMode: true, activeMode, activeRoll: { ...activeRoll, collectionAddress: address } })
    },
  }
})

// Async hydration on startup — same pattern as network.ts and mintQueue.ts
readPersistedSession().then((session) => {
  useSessionStore.setState(session)
})

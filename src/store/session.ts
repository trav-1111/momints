import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Paths, File } from 'expo-file-system'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'quick' | 'roll'
export type RollSize = 12 | 24 | 36

export interface ActiveRoll {
  id: string
  name: string
  size: RollSize
  frameIds: string[]
  startedAt: number
  collectionAddress?: string
}

interface PersistedSession {
  hasSetMode: boolean
  activeMode: AppMode
  activeRoll: ActiveRoll | null
}

interface SessionStore extends PersistedSession {
  selectQuickMode: () => void
  startRoll: (name: string, size: RollSize) => void
  addFrameToRoll: (photoId: string) => void
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
    frameIds: (r.frameIds as unknown[]).filter((f): f is string => typeof f === 'string'),
    startedAt: r.startedAt,
    collectionAddress: typeof r.collectionAddress === 'string' ? r.collectionAddress : undefined,
  }
}

async function readPersistedSession(): Promise<PersistedSession> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return DEFAULT
    const text = await file.text()
    const data: unknown = JSON.parse(text)
    if (data === null || typeof data !== 'object') return DEFAULT
    const d = data as Record<string, unknown>
    return {
      hasSetMode: typeof d.hasSetMode === 'boolean' ? d.hasSetMode : DEFAULT.hasSetMode,
      activeMode: d.activeMode === 'roll' ? 'roll' : 'quick',
      activeRoll: parseActiveRoll(d.activeRoll),
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
      })
    )
  } catch {
    // non-critical
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()((set, get) => ({
  ...DEFAULT,

  selectQuickMode: () => {
    const next: PersistedSession = { hasSetMode: true, activeMode: 'quick', activeRoll: null }
    persistSession(next)
    set(next)
  },

  startRoll: (name, size) => {
    const newRoll: ActiveRoll = {
      id: uuidv4(),
      name,
      size,
      frameIds: [],
      startedAt: Date.now(),
    }
    const next: PersistedSession = { hasSetMode: true, activeMode: 'roll', activeRoll: newRoll }
    persistSession(next)
    set(next)
  },

  addFrameToRoll: (photoId) => {
    const { activeRoll } = get()
    if (!activeRoll) return
    const updated: ActiveRoll = { ...activeRoll, frameIds: [...activeRoll.frameIds, photoId] }
    const next: PersistedSession = { hasSetMode: true, activeMode: 'roll', activeRoll: updated }
    persistSession(next)
    set({ activeRoll: updated })
  },

  abandonRoll: () => {
    const next: PersistedSession = {
      hasSetMode: get().hasSetMode,
      activeMode: 'roll',
      activeRoll: null,
    }
    persistSession(next)
    set({ activeRoll: null })
  },

  // Distinct from abandonRoll so Week 5 can archive the finished roll
  // (collection address, frame mints) without touching abandon semantics
  completeRoll: () => {
    const next: PersistedSession = {
      hasSetMode: get().hasSetMode,
      activeMode: 'roll',
      activeRoll: null,
    }
    persistSession(next)
    set({ activeRoll: null })
  },

  setCollectionAddress: (address) => {
    const { activeRoll } = get()
    if (!activeRoll) return
    const updated: ActiveRoll = { ...activeRoll, collectionAddress: address }
    const next: PersistedSession = { hasSetMode: true, activeMode: 'roll', activeRoll: updated }
    persistSession(next)
    set({ activeRoll: updated })
  },
}))

// Async hydration on startup — same pattern as network.ts and mintQueue.ts
readPersistedSession().then((session) => {
  useSessionStore.setState(session)
})

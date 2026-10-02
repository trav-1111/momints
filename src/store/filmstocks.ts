import { File, Paths } from 'expo-file-system'
import { create } from 'zustand'
import {
  DEFAULT_COLOR_FILM_ID,
  FALLBACK_HOUSE_CATALOGUE,
  fetchFilmStockCatalogue,
  fetchUnlockedFilmStockIds,
  readCachedFilmStockCatalogue,
  type FilmStockCatalogueItem,
  type FilmStockCatalogueResponse,
} from '../services/filmstocks'
import { MAX_CATALOGUE_AGE_MS, canLoadRoll, canUseQuick, catalogueIsRecent } from '../services/filmstockPolicy.cjs'

interface PersistedFilmStockState {
  unlocksByWallet: Record<string, string[]>
  favourites: string[]
  recentlyUsed: string[]
  quickFilmStockId: string
}

interface FilmStockState extends PersistedFilmStockState {
  catalogue: FilmStockCatalogueItem[]
  serverTimeMs: number
  serverClockOffsetMs: number
  catalogueReceivedAtMs: number
  connectedWallet: string | null
  loading: boolean
  hydrated: boolean
  error: string | null
  hydrate: () => Promise<void>
  refresh: (wallet: string | null) => Promise<void>
  selectQuickFilm: (filmStockId: string) => void
  recordUse: (filmStockId: string) => void
  toggleFavourite: (filmStockId: string) => void
  unlockLocally: (wallet: string, filmStockId: string) => void
}

const STATE_FILE = new File(Paths.document, 'filmstock-access.json')
const EMPTY_PERSISTED: PersistedFilmStockState = {
  unlocksByWallet: {},
  favourites: [],
  recentlyUsed: [],
  quickFilmStockId: DEFAULT_COLOR_FILM_ID,
}

function persist(state: PersistedFilmStockState): void {
  try {
    STATE_FILE.write(JSON.stringify(state))
  } catch {
    // Reconstructible preference/cache only; never block shooting.
  }
}

async function readPersisted(): Promise<PersistedFilmStockState> {
  try {
    if (!STATE_FILE.exists) return EMPTY_PERSISTED
    const raw = JSON.parse(await STATE_FILE.text()) as Record<string, unknown>
    const unlocksByWallet: Record<string, string[]> = {}
    if (raw.unlocksByWallet && typeof raw.unlocksByWallet === 'object') {
      for (const [wallet, ids] of Object.entries(raw.unlocksByWallet as Record<string, unknown>)) {
        if (Array.isArray(ids)) unlocksByWallet[wallet] = ids.filter((id): id is string => typeof id === 'string')
      }
    }
    return {
      unlocksByWallet,
      favourites: Array.isArray(raw.favourites)
        ? raw.favourites.filter((id): id is string => typeof id === 'string')
        : [],
      recentlyUsed: Array.isArray(raw.recentlyUsed)
        ? raw.recentlyUsed.filter((id): id is string => typeof id === 'string').slice(0, 12)
        : [],
      quickFilmStockId: typeof raw.quickFilmStockId === 'string' ? raw.quickFilmStockId : DEFAULT_COLOR_FILM_ID,
    }
  } catch {
    return EMPTY_PERSISTED
  }
}

function persistedFrom(state: FilmStockState): PersistedFilmStockState {
  return {
    unlocksByWallet: state.unlocksByWallet,
    favourites: state.favourites,
    recentlyUsed: state.recentlyUsed,
    quickFilmStockId: state.quickFilmStockId,
  }
}

export const useFilmStockStore = create<FilmStockState>((set, get) => ({
  ...EMPTY_PERSISTED,
  catalogue: FALLBACK_HOUSE_CATALOGUE.filmstocks,
  serverTimeMs: Date.parse(FALLBACK_HOUSE_CATALOGUE.serverTime),
  serverClockOffsetMs: 0,
  catalogueReceivedAtMs: 0,
  connectedWallet: null,
  loading: false,
  hydrated: false,
  error: null,

  hydrate: async () => {
    const [preferences, cached] = await Promise.all([readPersisted(), readCachedFilmStockCatalogue()])
    set({
      ...preferences,
      catalogue: cached.filmstocks,
      serverTimeMs: Date.parse(cached.serverTime),
      serverClockOffsetMs: Date.parse(cached.serverTime) - (cached.receivedAtDeviceMs ?? 0),
      catalogueReceivedAtMs: cached.receivedAtDeviceMs ?? 0,
      hydrated: true,
    })
  },

  refresh: async (wallet) => {
    set((state) => {
      const selected = state.catalogue.find((stock) => stock.filmStockId === state.quickFilmStockId)
      const cachedUnlocks = wallet ? (state.unlocksByWallet[wallet] ?? []) : []
      return {
        loading: true,
        connectedWallet: wallet,
        error: null,
        quickFilmStockId:
          selected && canUseQuick(selected, cachedUnlocks) ? state.quickFilmStockId : DEFAULT_COLOR_FILM_ID,
      }
    })
    const [catalogueResult, unlockResult] = await Promise.allSettled([
      fetchFilmStockCatalogue(),
      wallet ? fetchUnlockedFilmStockIds(wallet) : Promise.resolve([]),
    ])
    set((state) => {
      if (state.connectedWallet !== wallet) return state
      const catalogue = catalogueResult.status === 'fulfilled' ? catalogueResult.value : null
      const unlocked = unlockResult.status === 'fulfilled' ? unlockResult.value : null
      const errors = [catalogueResult, unlockResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))
      const next = {
        catalogue: catalogue?.filmstocks ?? state.catalogue,
        serverTimeMs: catalogue ? Date.parse(catalogue.serverTime) : state.serverTimeMs,
        serverClockOffsetMs: catalogue
          ? Date.parse(catalogue.serverTime) - (catalogue.receivedAtDeviceMs ?? Date.now())
          : state.serverClockOffsetMs,
        catalogueReceivedAtMs: catalogue?.receivedAtDeviceMs ?? state.catalogueReceivedAtMs,
        connectedWallet: wallet,
        loading: false,
        error: errors.length ? errors.join(' · ') : null,
        // Earned unlocks are permanent for their original wallet. DAS indexing
        // and Arweave metadata can lag, so a refresh adds proof without erasing
        // cached unlocks, including ones earned while this request was pending.
        unlocksByWallet:
          wallet && unlocked
            ? {
                ...state.unlocksByWallet,
                [wallet]: [...new Set([...(state.unlocksByWallet[wallet] ?? []), ...unlocked])],
              }
            : state.unlocksByWallet,
      }
      const merged = { ...state, ...next }
      const selectedQuick = merged.catalogue.find((stock) => stock.filmStockId === state.quickFilmStockId)
      const walletUnlocks = wallet ? (merged.unlocksByWallet[wallet] ?? []) : []
      const quickFilmStockId =
        selectedQuick && canUseQuick(selectedQuick, walletUnlocks) ? state.quickFilmStockId : DEFAULT_COLOR_FILM_ID
      const finalNext = { ...next, quickFilmStockId }
      persist(persistedFrom({ ...merged, quickFilmStockId }))
      return finalNext
    })
  },

  selectQuickFilm: (filmStockId) => {
    set((state) => {
      const next = {
        quickFilmStockId: filmStockId,
        recentlyUsed: [filmStockId, ...state.recentlyUsed.filter((id) => id !== filmStockId)].slice(0, 12),
      }
      persist({ ...persistedFrom(state), ...next })
      return next
    })
  },

  recordUse: (filmStockId) => {
    set((state) => {
      const recentlyUsed = [filmStockId, ...state.recentlyUsed.filter((id) => id !== filmStockId)].slice(0, 12)
      persist({ ...persistedFrom(state), recentlyUsed })
      return { recentlyUsed }
    })
  },

  toggleFavourite: (filmStockId) => {
    set((state) => {
      const favourites = state.favourites.includes(filmStockId)
        ? state.favourites.filter((id) => id !== filmStockId)
        : [filmStockId, ...state.favourites]
      persist({ ...persistedFrom(state), favourites })
      return { favourites }
    })
  },

  unlockLocally: (wallet, filmStockId) => {
    set((state) => {
      const current = state.unlocksByWallet[wallet] ?? []
      const unlocksByWallet = current.includes(filmStockId)
        ? state.unlocksByWallet
        : { ...state.unlocksByWallet, [wallet]: [...current, filmStockId] }
      const recentlyUsed = [filmStockId, ...state.recentlyUsed.filter((id) => id !== filmStockId)].slice(0, 12)
      const next = { unlocksByWallet, recentlyUsed }
      persist({ ...persistedFrom(state), ...next })
      return next
    })
  },
}))

export function unlockedIds(state: FilmStockState): string[] {
  return state.connectedWallet ? (state.unlocksByWallet[state.connectedWallet] ?? []) : []
}

export const FILMSTOCK_CATALOGUE_MAX_AGE_MS = MAX_CATALOGUE_AGE_MS

export function authoritativeFilmStockTime(state: FilmStockState): number {
  return Date.now() + state.serverClockOffsetMs
}

export function hasRecentCatalogue(state: FilmStockState): boolean {
  return catalogueIsRecent(state.catalogueReceivedAtMs, Date.now())
}

export function rollEligible(stock: FilmStockCatalogueItem, state: FilmStockState): boolean {
  return canLoadRoll(
    stock,
    {
      unlockedIds: unlockedIds(state),
      serverClockOffsetMs: state.serverClockOffsetMs,
      catalogueReceivedAtMs: state.catalogueReceivedAtMs,
    },
    Date.now(),
  )
}

export function quickEligible(stock: FilmStockCatalogueItem, state: FilmStockState): boolean {
  return canUseQuick(stock, unlockedIds(state))
}

export const filmStockHydrated = useFilmStockStore.getState().hydrate()

export type { FilmStockCatalogueResponse }

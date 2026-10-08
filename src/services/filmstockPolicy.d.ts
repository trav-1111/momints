import type { FilmStockCatalogueItem } from './filmstocks'

export const MAX_CATALOGUE_AGE_MS: number
export function isCurrentlyStocked(stock: FilmStockCatalogueItem, serverTimeMs: number): boolean
export function catalogueIsRecent(receivedAtDeviceMs: number, deviceNowMs: number): boolean
export function canLoadRoll(
  stock: FilmStockCatalogueItem,
  access: {
    unlockedIds: string[]
    serverClockOffsetMs: number
    catalogueReceivedAtMs: number
  },
  deviceNowMs: number,
): boolean
export function canUseQuick(stock: FilmStockCatalogueItem, unlockedIds: string[]): boolean

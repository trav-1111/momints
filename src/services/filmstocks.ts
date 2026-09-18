import { Directory, File, Paths } from 'expo-file-system'
import { ROLL_API_BASE } from '../config/rollApi'
import { isCurrentlyStocked } from './filmstockPolicy.cjs'

export const FILMSTOCK_ENGINE_VERSION = 1
export const DEFAULT_COLOR_FILM_ID = 'momints-color-v1'
export const DEFAULT_BW_FILM_ID = 'momints-bw-v1'

export interface FilmStockCatalogueItem {
  filmStockId: string
  displayName: string
  shortDescription: string
  characteristics: string[]
  previewImageUrls: string[]
  recipeUrl: string
  availableFrom: string | null
  availableUntil: string | null
  evergreen: boolean
  minimumEngineVersion: number
  baseMode: 'color' | 'bw'
}

export interface FilmStockCatalogueResponse {
  serverTime: string
  catalogueUpdatedAt: string
  filmstocks: FilmStockCatalogueItem[]
  /** Local cache bookkeeping; never supplied by or sent to the Worker API. */
  receivedAtDeviceMs?: number
}

export interface FilmStockRecipeV1 {
  schemaVersion: 1
  filmStockId: string
  /** Skia 4x5 colour matrix. Declarative data only; never executable code. */
  colorMatrix: number[]
}

const RECIPES = new Directory(Paths.document, 'momints-filmstock-recipes')
const CATALOGUE_CACHE = new File(Paths.document, 'filmstock-catalogue.json')

// prettier-ignore
const GRAYSCALE_MATRIX = [
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0,     0,     0,     1, 0,
]

// House recipes ship in-app so they always work offline. The same immutable
// JSON is published to R2 for one uniform remote catalogue contract.
const BUILTIN_RECIPES: Record<string, FilmStockRecipeV1> = {
  [DEFAULT_COLOR_FILM_ID]: {
    schemaVersion: 1,
    filmStockId: DEFAULT_COLOR_FILM_ID,
    colorMatrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  },
  [DEFAULT_BW_FILM_ID]: {
    schemaVersion: 1,
    filmStockId: DEFAULT_BW_FILM_ID,
    colorMatrix: GRAYSCALE_MATRIX,
  },
}

export const FALLBACK_HOUSE_CATALOGUE: FilmStockCatalogueResponse = {
  serverTime: new Date(0).toISOString(),
  catalogueUpdatedAt: new Date(0).toISOString(),
  filmstocks: [
    {
      filmStockId: DEFAULT_COLOR_FILM_ID,
      displayName: 'Momints Color',
      shortDescription: 'Clean colour with a restrained, neutral response.',
      characteristics: ['natural colour', 'clean contrast', 'house film'],
      previewImageUrls: [],
      recipeUrl: 'builtin:momints-color-v1',
      availableFrom: null,
      availableUntil: null,
      evergreen: true,
      minimumEngineVersion: 1,
      baseMode: 'color',
    },
    {
      filmStockId: DEFAULT_BW_FILM_ID,
      displayName: 'Momints B&W',
      shortDescription: 'Neutral monochrome with a classic luminance response.',
      characteristics: ['monochrome', 'neutral', 'house film'],
      previewImageUrls: [],
      recipeUrl: 'builtin:momints-bw-v1',
      availableFrom: null,
      availableUntil: null,
      evergreen: true,
      minimumEngineVersion: 1,
      baseMode: 'bw',
    },
  ],
  receivedAtDeviceMs: 0,
}

function validateCatalogueResponse(raw: unknown): FilmStockCatalogueResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Filmstock catalogue is not an object')
  const value = raw as Record<string, unknown>
  if (typeof value.serverTime !== 'string' || Number.isNaN(Date.parse(value.serverTime))) {
    throw new Error('Filmstock catalogue is missing valid serverTime')
  }
  if (typeof value.catalogueUpdatedAt !== 'string' || !Array.isArray(value.filmstocks)) {
    throw new Error('Filmstock catalogue is incomplete')
  }
  const ids = new Set<string>()
  const filmstocks = value.filmstocks.map((entry): FilmStockCatalogueItem => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid filmstock entry')
    const stock = entry as Record<string, unknown>
    if (
      typeof stock.filmStockId !== 'string' ||
      typeof stock.displayName !== 'string' ||
      typeof stock.shortDescription !== 'string' ||
      typeof stock.recipeUrl !== 'string' ||
      typeof stock.evergreen !== 'boolean' ||
      typeof stock.minimumEngineVersion !== 'number' ||
      (stock.baseMode !== 'color' && stock.baseMode !== 'bw') ||
      !Array.isArray(stock.characteristics) ||
      !Array.isArray(stock.previewImageUrls)
    ) {
      throw new Error('Invalid filmstock catalogue fields')
    }
    if (ids.has(stock.filmStockId)) throw new Error(`Duplicate filmstock ID: ${stock.filmStockId}`)
    ids.add(stock.filmStockId)
    return {
      filmStockId: stock.filmStockId,
      displayName: stock.displayName,
      shortDescription: stock.shortDescription,
      characteristics: stock.characteristics.filter((v): v is string => typeof v === 'string'),
      previewImageUrls: stock.previewImageUrls.filter((v): v is string => typeof v === 'string'),
      recipeUrl: stock.recipeUrl,
      availableFrom: typeof stock.availableFrom === 'string' ? stock.availableFrom : null,
      availableUntil: typeof stock.availableUntil === 'string' ? stock.availableUntil : null,
      evergreen: stock.evergreen,
      minimumEngineVersion: stock.minimumEngineVersion,
      baseMode: stock.baseMode,
    }
  })
  return {
    serverTime: value.serverTime,
    catalogueUpdatedAt: value.catalogueUpdatedAt,
    filmstocks,
    receivedAtDeviceMs: typeof value.receivedAtDeviceMs === 'number' ? value.receivedAtDeviceMs : 0,
  }
}

export function currentlyStocked(stock: FilmStockCatalogueItem, serverTimeMs: number): boolean {
  return isCurrentlyStocked(stock, serverTimeMs)
}

export async function readCachedFilmStockCatalogue(): Promise<FilmStockCatalogueResponse> {
  try {
    if (!CATALOGUE_CACHE.exists) return FALLBACK_HOUSE_CATALOGUE
    return validateCatalogueResponse(JSON.parse(await CATALOGUE_CACHE.text()))
  } catch {
    return FALLBACK_HOUSE_CATALOGUE
  }
}

export async function fetchFilmStockCatalogue(): Promise<FilmStockCatalogueResponse> {
  if (!ROLL_API_BASE) throw new Error('Filmstock catalogue backend is not configured')
  const response = await fetch(`${ROLL_API_BASE}/v1/filmstocks`)
  if (!response.ok) throw new Error(`Filmstock catalogue request failed (${response.status})`)
  const parsed = validateCatalogueResponse(await response.json())
  // Cloudflare may serve the public catalogue from edge cache. Its Age header
  // advances the generated serverTime so a cached response cannot delay an
  // availability boundary by the cache TTL.
  const edgeAgeSeconds = Number(response.headers.get('age') ?? 0)
  const catalogue = {
    ...parsed,
    serverTime: new Date(
      Date.parse(parsed.serverTime) + (Number.isFinite(edgeAgeSeconds) ? edgeAgeSeconds * 1000 : 0),
    ).toISOString(),
    receivedAtDeviceMs: Date.now(),
  }
  CATALOGUE_CACHE.write(JSON.stringify(catalogue))
  return catalogue
}

export async function fetchUnlockedFilmStockIds(creatorAddress: string): Promise<string[]> {
  if (!ROLL_API_BASE) return []
  const response = await fetch(`${ROLL_API_BASE}/v1/filmstocks/unlocked`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ creatorAddress }),
  })
  if (!response.ok) throw new Error(`Film cabinet refresh failed (${response.status})`)
  const body = (await response.json()) as { unlockedFilmStockIds?: unknown }
  if (!Array.isArray(body.unlockedFilmStockIds)) throw new Error('Film cabinet response is invalid')
  return body.unlockedFilmStockIds.filter((id): id is string => typeof id === 'string')
}

function validateRecipe(raw: unknown, expectedId: string): FilmStockRecipeV1 {
  if (!raw || typeof raw !== 'object') throw new Error('Film recipe is not an object')
  const recipe = raw as Record<string, unknown>
  if (recipe.schemaVersion !== 1 || recipe.filmStockId !== expectedId) {
    throw new Error(`Film recipe identity mismatch for ${expectedId}`)
  }
  if (
    !Array.isArray(recipe.colorMatrix) ||
    recipe.colorMatrix.length !== 20 ||
    recipe.colorMatrix.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`${expectedId} has an invalid 4x5 colour matrix`)
  }
  return { schemaVersion: 1, filmStockId: expectedId, colorMatrix: recipe.colorMatrix as number[] }
}

function recipeFile(id: string): File {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(id)) throw new Error('Invalid filmStockId')
  if (!RECIPES.exists) RECIPES.create({ idempotent: true, intermediates: true })
  return new File(RECIPES, `${id}.json`)
}

export function isFilmStockDownloaded(id: string): boolean {
  return Boolean(BUILTIN_RECIPES[id]) || recipeFile(id).exists
}

export async function ensureFilmStockRecipe(stock: FilmStockCatalogueItem): Promise<FilmStockRecipeV1> {
  if (stock.minimumEngineVersion > FILMSTOCK_ENGINE_VERSION) {
    throw new Error(`${stock.displayName} needs a newer Momints processing engine`)
  }
  const builtin = BUILTIN_RECIPES[stock.filmStockId]
  if (builtin) return builtin
  const file = recipeFile(stock.filmStockId)
  if (file.exists) return validateRecipe(JSON.parse(await file.text()), stock.filmStockId)
  const response = await fetch(stock.recipeUrl, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Could not download ${stock.displayName} (${response.status})`)
  const recipe = validateRecipe(await response.json(), stock.filmStockId)
  file.write(JSON.stringify(recipe))
  return recipe
}

export async function loadFilmStockRecipe(id: string): Promise<FilmStockRecipeV1> {
  const builtin = BUILTIN_RECIPES[id]
  if (builtin) return builtin
  const file = recipeFile(id)
  if (!file.exists) throw new Error(`Film recipe ${id} is not downloaded`)
  return validateRecipe(JSON.parse(await file.text()), id)
}

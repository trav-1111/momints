import { createHash } from 'react-native-quick-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { ROLL_API_BASE } from '../config/rollApi'
import { isCurrentlyStocked } from './filmstockPolicy.cjs'

export const FILMSTOCK_ENGINE_VERSION = 2
export const DEFAULT_COLOR_FILM_ID = 'momints-color-v1'
export const DEFAULT_BW_FILM_ID = 'momints-bw-v1'
export const LUT_SIZE = 33
export const LUT_HEADER_BYTES = 16
export const LUT_MAGIC = 'MOMLUT01'

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
  /** Legacy house-film transform kept for existing rolls. */
  colorMatrix: number[]
}

export interface FilmStockRecipeV2 {
  schemaVersion: 2
  filmStockId: string
  displayName: string
  shortDescription: string
  characteristics: string[]
  baseMode: 'color' | 'bw'
  inputColorSpace: 'sRGB'
  outputColorSpace: 'sRGB'
  lut: {
    format: 'momints-lut'
    size: 33
    uri: string
    sha256: string
    intensity: number
  }
  exposure?: { ev: number }
  grain?: { amount: number; size: number; roughness: number }
  halation?: { amount: number; radius: number }
  bloom?: { amount: number; radius?: number }
  sharpness?: { amount: number }
  vignette?: { amount: number }
  minimumEngineVersion: number
}

export type FilmStockRecipe = FilmStockRecipeV1 | FilmStockRecipeV2

export interface LoadedFilmStockPackage {
  recipe: FilmStockRecipe
  runtimeLutUri?: string
}

const PACKAGES = new Directory(Paths.document, 'momints-filmstock-packages')
const CATALOGUE_CACHE = new File(Paths.document, 'filmstock-catalogue.json')

// prettier-ignore
const GRAYSCALE_MATRIX = [
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0,     0,     0,     1, 0,
]

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

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function validateCatalogueResponse(raw: unknown): FilmStockCatalogueResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Filmstock catalogue is not an object')
  const value = raw as Record<string, unknown>
  if (!validDate(value.serverTime)) throw new Error('Filmstock catalogue is missing valid serverTime')
  if (!validDate(value.catalogueUpdatedAt) || !Array.isArray(value.filmstocks)) {
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
      !Number.isInteger(stock.minimumEngineVersion) ||
      (stock.baseMode !== 'color' && stock.baseMode !== 'bw') ||
      !Array.isArray(stock.characteristics) ||
      !Array.isArray(stock.previewImageUrls)
    ) {
      throw new Error('Invalid filmstock catalogue fields')
    }
    if (
      stock.characteristics.some((item) => typeof item !== 'string') ||
      stock.previewImageUrls.some((item) => typeof item !== 'string') ||
      (stock.availableFrom !== null && !validDate(stock.availableFrom)) ||
      (stock.availableUntil !== null && !validDate(stock.availableUntil))
    ) {
      throw new Error(`Invalid filmstock catalogue values for ${stock.filmStockId}`)
    }
    if (ids.has(stock.filmStockId)) throw new Error(`Duplicate filmstock ID: ${stock.filmStockId}`)
    ids.add(stock.filmStockId)
    return {
      filmStockId: stock.filmStockId,
      displayName: stock.displayName,
      shortDescription: stock.shortDescription,
      characteristics: stock.characteristics as string[],
      previewImageUrls: stock.previewImageUrls as string[],
      recipeUrl: stock.recipeUrl,
      availableFrom: validDate(stock.availableFrom) ? stock.availableFrom : null,
      availableUntil: validDate(stock.availableUntil) ? stock.availableUntil : null,
      evergreen: stock.evergreen,
      minimumEngineVersion: stock.minimumEngineVersion as number,
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

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function validateRecipe(raw: unknown, expectedId: string): FilmStockRecipe {
  if (!raw || typeof raw !== 'object') throw new Error('Film recipe is not an object')
  const recipe = raw as Record<string, unknown>
  if (recipe.filmStockId !== expectedId) throw new Error(`Film recipe identity mismatch for ${expectedId}`)
  if (recipe.schemaVersion === 1) {
    if (
      !Array.isArray(recipe.colorMatrix) ||
      recipe.colorMatrix.length !== 20 ||
      recipe.colorMatrix.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new Error(`${expectedId} has an invalid 4x5 colour matrix`)
    }
    return { schemaVersion: 1, filmStockId: expectedId, colorMatrix: recipe.colorMatrix as number[] }
  }
  const lut = recipe.lut as Record<string, unknown> | undefined
  if (
    recipe.schemaVersion !== 2 ||
    recipe.inputColorSpace !== 'sRGB' ||
    recipe.outputColorSpace !== 'sRGB' ||
    typeof recipe.displayName !== 'string' ||
    typeof recipe.shortDescription !== 'string' ||
    !Array.isArray(recipe.characteristics) ||
    recipe.characteristics.some((value) => typeof value !== 'string') ||
    (recipe.baseMode !== 'color' && recipe.baseMode !== 'bw') ||
    !lut ||
    lut.format !== 'momints-lut' ||
    lut.size !== LUT_SIZE ||
    typeof lut.uri !== 'string' ||
    typeof lut.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(lut.sha256) ||
    !Number.isInteger(recipe.minimumEngineVersion) ||
    (recipe.minimumEngineVersion as number) < 2
  ) {
    throw new Error(`${expectedId} has an unsupported LUT recipe`)
  }
  boundedNumber(lut.intensity, 'lut.intensity', 0, 1)
  const exposure = recipe.exposure as Record<string, unknown> | undefined
  const grain = recipe.grain as Record<string, unknown> | undefined
  const halation = recipe.halation as Record<string, unknown> | undefined
  const bloom = recipe.bloom as Record<string, unknown> | undefined
  const sharpness = recipe.sharpness as Record<string, unknown> | undefined
  const vignette = recipe.vignette as Record<string, unknown> | undefined
  boundedNumber(exposure?.ev ?? 0, 'exposure.ev', -2, 2)
  boundedNumber(grain?.amount ?? 0, 'grain.amount', 0, 1)
  boundedNumber(grain?.size ?? 0, 'grain.size', 0, 1)
  boundedNumber(grain?.roughness ?? 0, 'grain.roughness', 0, 1)
  boundedNumber(halation?.amount ?? 0, 'halation.amount', 0, 1)
  boundedNumber(halation?.radius ?? 0, 'halation.radius', 0, 1)
  boundedNumber(bloom?.amount ?? 0, 'bloom.amount', 0, 1)
  boundedNumber(bloom?.radius ?? halation?.radius ?? 0, 'bloom.radius', 0, 1)
  boundedNumber(sharpness?.amount ?? 0, 'sharpness.amount', -1, 1)
  boundedNumber(vignette?.amount ?? 0, 'vignette.amount', 0, 1)
  return recipe as unknown as FilmStockRecipeV2
}

function assertId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(id)) throw new Error('Invalid filmStockId')
}

function packageDirectory(id: string): Directory {
  assertId(id)
  if (!PACKAGES.exists) PACKAGES.create({ idempotent: true, intermediates: true })
  return new Directory(PACKAGES, id)
}

function recipeFile(id: string): File {
  return new File(packageDirectory(id), 'recipe.json')
}

function runtimeFile(id: string): File {
  return new File(packageDirectory(id), 'runtime.lut')
}

function touchPackage(id: string): void {
  const directory = packageDirectory(id)
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true })
  new File(directory, 'state.json').write(JSON.stringify({ filmStockId: id, lastAccessedAt: new Date().toISOString() }))
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest().toString('hex')
}

export function parseRuntimeLut(bytes: Uint8Array): { size: number; pixels: Uint8Array } {
  if (bytes.length < LUT_HEADER_BYTES) throw new Error('Runtime LUT is incomplete')
  const magic = String.fromCharCode(...bytes.slice(0, 8))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = view.getUint16(8, true)
  const channels = view.getUint16(10, true)
  const length = view.getUint32(12, true)
  if (magic !== LUT_MAGIC || size !== LUT_SIZE || channels !== 4 || length !== size ** 3 * 4) {
    throw new Error('Runtime LUT format is unsupported')
  }
  if (bytes.length !== LUT_HEADER_BYTES + length) throw new Error('Runtime LUT byte length is invalid')
  return { size, pixels: bytes.slice(LUT_HEADER_BYTES) }
}

export function isFilmStockDownloaded(id: string): boolean {
  const builtin = BUILTIN_RECIPES[id]
  if (builtin) return true
  const recipe = recipeFile(id)
  if (!recipe.exists) return false
  try {
    const parsed = validateRecipe(JSON.parse(recipe.textSync()), id)
    return parsed.schemaVersion === 1 || runtimeFile(id).exists
  } catch {
    return false
  }
}

function resolvePackageAsset(recipeUrl: string, asset: string): string {
  const base = new URL(recipeUrl)
  const resolved = new URL(asset, base)
  if (base.protocol !== 'https:' || resolved.protocol !== 'https:' || resolved.origin !== base.origin) {
    throw new Error('Filmstock package assets must use the recipe HTTPS origin')
  }
  return resolved.toString()
}

export async function ensureFilmStockRecipe(stock: FilmStockCatalogueItem): Promise<FilmStockRecipe> {
  if (stock.minimumEngineVersion > FILMSTOCK_ENGINE_VERSION) {
    throw new Error(`${stock.displayName} needs a newer Momints processing engine`)
  }
  const builtin = BUILTIN_RECIPES[stock.filmStockId]
  if (builtin) return builtin
  const cached = recipeFile(stock.filmStockId)
  if (cached.exists) {
    const recipe = validateRecipe(JSON.parse(await cached.text()), stock.filmStockId)
    if (recipe.schemaVersion === 1 || runtimeFile(stock.filmStockId).exists) {
      touchPackage(stock.filmStockId)
      return recipe
    }
  }

  const response = await fetch(stock.recipeUrl, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Could not download ${stock.displayName} (${response.status})`)
  const recipe = validateRecipe(await response.json(), stock.filmStockId)
  if (recipe.schemaVersion === 2 && recipe.minimumEngineVersion !== stock.minimumEngineVersion) {
    throw new Error(`${stock.displayName} catalogue and recipe engine versions differ`)
  }
  const directory = packageDirectory(stock.filmStockId)
  try {
    let runtimeBytes: Uint8Array | null = null
    if (recipe.schemaVersion === 2) {
      const lutResponse = await fetch(resolvePackageAsset(stock.recipeUrl, recipe.lut.uri), { cache: 'no-store' })
      if (!lutResponse.ok) throw new Error(`Could not download ${stock.displayName} LUT (${lutResponse.status})`)
      runtimeBytes = new Uint8Array(await lutResponse.arrayBuffer())
      parseRuntimeLut(runtimeBytes)
      if (sha256(runtimeBytes) !== recipe.lut.sha256) throw new Error(`${stock.displayName} LUT checksum failed`)
    }
    if (!directory.exists) directory.create({ idempotent: true, intermediates: true })
    if (runtimeBytes) runtimeFile(stock.filmStockId).write(runtimeBytes)
    cached.write(JSON.stringify(recipe))
    touchPackage(stock.filmStockId)
    return recipe
  } catch (error) {
    if (directory.exists) directory.delete()
    throw error
  }
}

export async function loadFilmStockPackage(id: string): Promise<LoadedFilmStockPackage> {
  const builtin = BUILTIN_RECIPES[id]
  if (builtin) return { recipe: builtin }
  const file = recipeFile(id)
  if (!file.exists) throw new Error(`Film recipe ${id} is not downloaded`)
  const recipe = validateRecipe(JSON.parse(await file.text()), id)
  if (recipe.schemaVersion === 1) return { recipe }
  const runtime = runtimeFile(id)
  if (!runtime.exists) throw new Error(`Film LUT ${id} is not downloaded`)
  const bytes = await runtime.bytes()
  parseRuntimeLut(bytes)
  if (sha256(bytes) !== recipe.lut.sha256) throw new Error(`Film LUT ${id} failed integrity verification`)
  touchPackage(id)
  return { recipe, runtimeLutUri: runtime.uri }
}

export async function loadFilmStockRecipe(id: string): Promise<FilmStockRecipe> {
  return (await loadFilmStockPackage(id)).recipe
}

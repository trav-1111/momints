export const FILMSTOCK_ENGINE_VERSION = 1

export interface FilmStockCatalogueDefinition {
  filmStockId: string
  displayName: string
  shortDescription: string
  characteristics: string[]
  previewPaths: string[]
  recipePath: string
  availableFrom: string | null
  availableUntil: string | null
  evergreen: boolean
  minimumEngineVersion: number
  baseMode: 'color' | 'bw'
}

export interface FilmStockCatalogueItem extends Omit<FilmStockCatalogueDefinition, 'previewPaths' | 'recipePath'> {
  previewImageUrls: string[]
  recipeUrl: string
}

// This file is the version-controlled publishing surface. A published ID is
// immutable: visually different processing must be released as a new ID.
export const FILMSTOCK_CATALOGUE_UPDATED_AT = '2026-09-19T00:00:00.000Z'

export const FILMSTOCK_CATALOGUE: readonly FilmStockCatalogueDefinition[] = [
  {
    filmStockId: 'momints-color-v1',
    displayName: 'Momints Color',
    shortDescription: 'Clean colour with a restrained, neutral response.',
    characteristics: ['natural colour', 'clean contrast', 'house film'],
    previewPaths: [],
    recipePath: 'recipes/momints-color-v1.json',
    availableFrom: null,
    availableUntil: null,
    evergreen: true,
    minimumEngineVersion: 1,
    baseMode: 'color',
  },
  {
    filmStockId: 'momints-bw-v1',
    displayName: 'Momints B&W',
    shortDescription: 'Neutral monochrome with a classic luminance response.',
    characteristics: ['monochrome', 'neutral', 'house film'],
    previewPaths: [],
    recipePath: 'recipes/momints-bw-v1.json',
    availableFrom: null,
    availableUntil: null,
    evergreen: true,
    minimumEngineVersion: 1,
    baseMode: 'bw',
  },
]

const ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/

export function validateCatalogue(catalogue: readonly FilmStockCatalogueDefinition[] = FILMSTOCK_CATALOGUE): void {
  const ids = new Set<string>()
  for (const stock of catalogue) {
    if (!ID_SHAPE.test(stock.filmStockId)) throw new Error(`Invalid filmStockId: ${stock.filmStockId}`)
    if (ids.has(stock.filmStockId)) throw new Error(`Duplicate filmStockId: ${stock.filmStockId}`)
    ids.add(stock.filmStockId)
    if (stock.minimumEngineVersion < 1 || !Number.isInteger(stock.minimumEngineVersion)) {
      throw new Error(`${stock.filmStockId}: minimumEngineVersion must be a positive integer`)
    }
    if (stock.availableFrom && Number.isNaN(Date.parse(stock.availableFrom))) {
      throw new Error(`${stock.filmStockId}: invalid availableFrom`)
    }
    if (stock.availableUntil && Number.isNaN(Date.parse(stock.availableUntil))) {
      throw new Error(`${stock.filmStockId}: invalid availableUntil`)
    }
    if (
      stock.availableFrom &&
      stock.availableUntil &&
      Date.parse(stock.availableFrom) >= Date.parse(stock.availableUntil)
    ) {
      throw new Error(`${stock.filmStockId}: availableFrom must be earlier than availableUntil`)
    }
  }
}

validateCatalogue()

export function isCurrentlyStocked(stock: FilmStockCatalogueDefinition, serverTimeMs: number): boolean {
  if (stock.evergreen) return false
  return (
    (stock.availableFrom === null || serverTimeMs >= Date.parse(stock.availableFrom)) &&
    (stock.availableUntil === null || serverTimeMs < Date.parse(stock.availableUntil))
  )
}

export function catalogueItem(stock: FilmStockCatalogueDefinition, requestUrl: URL): FilmStockCatalogueItem {
  const assetUrl = (path: string) => new URL(`/v1/filmstocks/assets/${path}`, requestUrl.origin).toString()
  return {
    filmStockId: stock.filmStockId,
    displayName: stock.displayName,
    shortDescription: stock.shortDescription,
    characteristics: [...stock.characteristics],
    previewImageUrls: stock.previewPaths.map(assetUrl),
    recipeUrl: assetUrl(stock.recipePath),
    availableFrom: stock.availableFrom,
    availableUntil: stock.availableUntil,
    evergreen: stock.evergreen,
    minimumEngineVersion: stock.minimumEngineVersion,
    baseMode: stock.baseMode,
  }
}

export function knownFilmStock(id: string): FilmStockCatalogueDefinition | undefined {
  return FILMSTOCK_CATALOGUE.find((stock) => stock.filmStockId === id)
}

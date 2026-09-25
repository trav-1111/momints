import catalogueJson from '../../filmstock-catalogue.json'

export const FILMSTOCK_ENGINE_VERSION = 2

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

// filmstock-catalogue.json is the publishing surface updated by the package
// compiler. It is bundled into the Worker, so rotations require a Worker
// deploy but never a mobile release.
export const FILMSTOCK_CATALOGUE_UPDATED_AT = catalogueJson.catalogueUpdatedAt
export const FILMSTOCK_CATALOGUE = catalogueJson.filmstocks as readonly FilmStockCatalogueDefinition[]

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

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileRuntimeLut,
  FILMSTOCK_ID,
  parseCube,
  parseRuntimeLut,
  sha256,
  validateAttribution,
  validateLutRecipe,
} from './lib/filmstock-package.mjs'
import { assertSchema } from './lib/json-schema.mjs'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(workerRoot, 'filmstock-assets')
const sourceArchiveRoot = join(workerRoot, 'filmstock-sources')
const lock = JSON.parse(await readFile(join(assetsRoot, 'immutable-lock.json'), 'utf8'))
const catalogue = JSON.parse(await readFile(join(workerRoot, 'filmstock-catalogue.json'), 'utf8'))
const recipeSchema = JSON.parse(await readFile(join(workerRoot, 'filmstock-recipe.schema.json'), 'utf8'))
const catalogueSchema = JSON.parse(await readFile(join(workerRoot, 'filmstock-catalogue.schema.json'), 'utf8'))

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? filesBelow(join(directory, entry.name)) : Promise.resolve([join(directory, entry.name)]),
      ),
    )
  ).flat()
}

if (!catalogue || !Array.isArray(catalogue.filmstocks) || Number.isNaN(Date.parse(catalogue.catalogueUpdatedAt))) {
  throw new Error('filmstock-catalogue.json is invalid')
}
assertSchema(catalogueSchema, catalogue, 'filmstock-catalogue.json')
const catalogueIds = new Set()
for (const stock of catalogue.filmstocks) {
  if (!FILMSTOCK_ID.test(stock.filmStockId) || catalogueIds.has(stock.filmStockId)) {
    throw new Error(`Invalid or duplicate filmStockId: ${stock.filmStockId}`)
  }
  catalogueIds.add(stock.filmStockId)
  if (!Number.isInteger(stock.minimumEngineVersion) || stock.minimumEngineVersion < 1) {
    throw new Error(`${stock.filmStockId}: invalid minimumEngineVersion`)
  }
  if (
    typeof stock.displayName !== 'string' ||
    typeof stock.shortDescription !== 'string' ||
    !Array.isArray(stock.characteristics) ||
    stock.characteristics.some((value) => typeof value !== 'string')
  ) {
    throw new Error(`${stock.filmStockId}: invalid catalogue copy`)
  }
  if (!Array.isArray(stock.previewPaths) || !stock.recipePath) throw new Error(`${stock.filmStockId}: missing assets`)
  for (const key of [stock.recipePath, ...stock.previewPaths]) {
    if (!lock[key]) throw new Error(`${stock.filmStockId}: catalogue asset is not immutable-locked: ${key}`)
  }
  if (stock.availableFrom && Number.isNaN(Date.parse(stock.availableFrom))) throw new Error('Invalid availableFrom')
  if (stock.availableUntil && Number.isNaN(Date.parse(stock.availableUntil))) throw new Error('Invalid availableUntil')
  if (
    stock.availableFrom &&
    stock.availableUntil &&
    Date.parse(stock.availableFrom) >= Date.parse(stock.availableUntil)
  ) {
    throw new Error(`${stock.filmStockId}: invalid availability window`)
  }
  if (stock.evergreen && (stock.availableFrom !== null || stock.availableUntil !== null)) {
    throw new Error(`${stock.filmStockId}: evergreen stocks cannot have rotation windows`)
  }
}

const assetFiles = (await filesBelow(assetsRoot)).filter((path) => !path.endsWith('immutable-lock.json'))
const seen = new Set()
for (const path of assetFiles) {
  const key = relative(assetsRoot, path).replaceAll('\\', '/')
  const bytes = await readFile(path)
  if (lock[key] !== sha256(bytes)) {
    throw new Error(`${key} differs from its immutable lock. Publish a visual change under a new filmStockId.`)
  }
  seen.add(key)
}
for (const key of Object.keys(lock)) if (!seen.has(key)) throw new Error(`Immutable filmstock asset is missing: ${key}`)

for (const stock of catalogue.filmstocks) {
  const recipeBytes = await readFile(join(assetsRoot, stock.recipePath))
  const recipe = JSON.parse(recipeBytes.toString('utf8'))
  if (recipe.schemaVersion === 1) {
    if (
      recipe.filmStockId !== stock.filmStockId ||
      !Array.isArray(recipe.colorMatrix) ||
      recipe.colorMatrix.length !== 20 ||
      recipe.colorMatrix.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new Error(`${stock.recipePath}: invalid legacy matrix recipe`)
    }
    continue
  }

  assertSchema(recipeSchema, recipe, stock.recipePath)
  validateLutRecipe(recipe, stock.filmStockId)
  if (recipe.minimumEngineVersion !== stock.minimumEngineVersion) {
    throw new Error(`${stock.filmStockId}: catalogue and recipe engine versions differ`)
  }
  if (stock.previewPaths.length === 0) throw new Error(`${stock.filmStockId}: LUT package requires a preview`)
  const recipeDirectory = dirname(stock.recipePath).replaceAll('\\', '/')
  // Catalogue asset keys use URL/POSIX separators even when validation runs on Windows.
  const runtimeKey = posix.resolve('/', recipeDirectory, recipe.lut.uri).slice(1)
  if (!runtimeKey.startsWith(`${recipeDirectory}/`) || !lock[runtimeKey]) {
    throw new Error(`${stock.filmStockId}: LUT URI escapes or is not immutable-locked`)
  }
  const runtime = await readFile(join(assetsRoot, runtimeKey))
  parseRuntimeLut(runtime)
  if (sha256(runtime) !== recipe.lut.sha256) throw new Error(`${stock.filmStockId}: LUT checksum mismatch`)
  const archivedRoot = join(sourceArchiveRoot, stock.filmStockId)
  const sourceRecipe = JSON.parse(await readFile(join(archivedRoot, 'recipe.json'), 'utf8'))
  assertSchema(recipeSchema, sourceRecipe, `${stock.filmStockId} source recipe`)
  validateLutRecipe(sourceRecipe, stock.filmStockId)
  const { uri: _uri, sha256: _hash, ...publishedLut } = recipe.lut
  if (JSON.stringify({ ...recipe, lut: publishedLut }) !== JSON.stringify(sourceRecipe)) {
    throw new Error(`${stock.filmStockId}: published recipe differs from its internal source recipe`)
  }
  const sourceCube = parseCube(await readFile(join(archivedRoot, 'source', `${stock.filmStockId}.cube`), 'utf8'))
  if (sha256(compileRuntimeLut(sourceCube)) !== recipe.lut.sha256) {
    throw new Error(`${stock.filmStockId}: runtime LUT differs from its internal CUBE source`)
  }
  await readFile(join(archivedRoot, 'authoring-notes.md'))
  const attributionKey = `${recipeDirectory}/attribution.txt`
  if (!lock[attributionKey]) throw new Error(`${stock.filmStockId}: attribution is missing from immutable assets`)
  const deployedAttribution = await readFile(join(assetsRoot, attributionKey))
  validateAttribution(deployedAttribution.toString('utf8'))
  if (sha256(deployedAttribution) !== sha256(await readFile(join(archivedRoot, 'attribution.txt')))) {
    throw new Error(`${stock.filmStockId}: deployed attribution differs from its internal source`)
  }
}

console.log(`Validated ${catalogue.filmstocks.length} filmstocks and ${seen.size} immutable assets.`)

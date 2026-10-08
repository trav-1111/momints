import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeCube,
  compileRuntimeLut,
  FILMSTOCK_ID,
  parseCube,
  sha256,
  validateAttribution,
  validateLutRecipe,
} from './lib/filmstock-package.mjs'
import { validateCanonicalImages } from './lib/filmstock-validation.mjs'
import { assertSchema } from './lib/json-schema.mjs'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(workerRoot, 'filmstock-assets')
const cataloguePath = join(workerRoot, 'filmstock-catalogue.json')
const lockPath = join(assetsRoot, 'immutable-lock.json')
const sourceArchiveRoot = join(workerRoot, 'filmstock-sources')
const recipeSchema = JSON.parse(await readFile(join(workerRoot, 'filmstock-recipe.schema.json'), 'utf8'))
const catalogueSchema = JSON.parse(await readFile(join(workerRoot, 'filmstock-catalogue.schema.json'), 'utf8'))

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const packageArgument = argument('--package')
if (!packageArgument)
  throw new Error('Usage: node scripts/publish-filmstock.mjs --package <filmstock-package-directory>')
const packageRoot = resolve(process.cwd(), packageArgument)
const filmStockId = basename(packageRoot)
if (!FILMSTOCK_ID.test(filmStockId)) throw new Error(`Invalid filmStockId directory: ${filmStockId}`)

const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'))
if (catalogue.filmstocks.some((stock) => stock.filmStockId === filmStockId)) {
  throw new Error(`${filmStockId} is already published. Change its schedule separately or create a new versioned ID.`)
}

const attribution = await readFile(join(packageRoot, 'attribution.txt'), 'utf8')
validateAttribution(attribution)
await stat(join(packageRoot, 'authoring-notes.md'))
const sourcePath = join(packageRoot, 'source', `${filmStockId}.cube`)
const cube = parseCube(await readFile(sourcePath, 'utf8'))
const diagnostics = analyzeCube(cube)
const runtime = compileRuntimeLut(cube)

const recipeSource = JSON.parse(await readFile(join(packageRoot, 'recipe.json'), 'utf8'))
assertSchema(recipeSchema, recipeSource, 'recipe.json')
validateLutRecipe(recipeSource, filmStockId)
if (
  typeof recipeSource.displayName !== 'string' ||
  typeof recipeSource.shortDescription !== 'string' ||
  !Array.isArray(recipeSource.characteristics) ||
  recipeSource.characteristics.some((value) => typeof value !== 'string')
) {
  throw new Error('recipe.json requires displayName, shortDescription and string characteristics')
}

const previewSource = join(packageRoot, 'previews')
const previewNames = (await readdir(previewSource)).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name)).sort()
if (previewNames.length < 1) throw new Error('At least one preview image is required')
const testImagesRoot = argument('--test-images') ?? process.env.FILMSTOCK_CANONICAL_TEST_DIR
if (!testImagesRoot) {
  throw new Error('--test-images or FILMSTOCK_CANONICAL_TEST_DIR is required for canonical image validation')
}
const imageValidation = await validateCanonicalImages({
  cube,
  filmStockId,
  testRoot: resolve(process.cwd(), testImagesRoot),
  outputRoot: join(workerRoot, 'filmstock-validation', filmStockId),
})

const assetPrefix = `filmstocks/${filmStockId}`
const outputRoot = join(assetsRoot, assetPrefix)
const sourceOutputRoot = join(sourceArchiveRoot, filmStockId)
const runtimeName = `${filmStockId}.lut`
const runtimeHash = sha256(runtime)
const publishedRecipe = {
  ...recipeSource,
  lut: {
    ...recipeSource.lut,
    uri: `runtime/${runtimeName}`,
    sha256: runtimeHash,
  },
}

try {
  await stat(outputRoot)
  throw new Error(`Generated asset directory already exists: ${assetPrefix}. Refusing to overwrite it.`)
} catch (error) {
  if (error instanceof Error && !('code' in error)) throw error
  if (error?.code !== 'ENOENT') throw error
}
try {
  await stat(sourceOutputRoot)
  throw new Error(`Internal source archive already exists for ${filmStockId}. Refusing to overwrite it.`)
} catch (error) {
  if (error instanceof Error && !('code' in error)) throw error
  if (error?.code !== 'ENOENT') throw error
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const prospectiveKeys = [
  `${assetPrefix}/runtime/${runtimeName}`,
  `${assetPrefix}/recipe.json`,
  `${assetPrefix}/attribution.txt`,
  ...previewNames.map((name) => `${assetPrefix}/previews/${name}`),
]
for (const key of prospectiveKeys) {
  if (lock[key]) throw new Error(`Immutable asset already exists in lock: ${key}`)
}

const normalizeDateArgument = (name) => {
  const raw = argument(name)
  if (raw === undefined || raw === 'null') return null
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new Error(`${name} requires an ISO date with timezone`)
  }
  return new Date(raw).toISOString()
}
const evergreen = argument('--evergreen') === 'true'
const availableFrom = normalizeDateArgument('--available-from')
const availableUntil = normalizeDateArgument('--available-until')
if (evergreen && (availableFrom !== null || availableUntil !== null)) {
  throw new Error('Evergreen filmstocks cannot have rotation windows')
}
catalogue.filmstocks.push({
  filmStockId,
  displayName: recipeSource.displayName,
  shortDescription: recipeSource.shortDescription,
  characteristics: recipeSource.characteristics,
  previewPaths: previewNames.map((name) => `${assetPrefix}/previews/${name}`),
  recipePath: `${assetPrefix}/recipe.json`,
  availableFrom,
  availableUntil,
  evergreen,
  minimumEngineVersion: recipeSource.minimumEngineVersion,
  baseMode: recipeSource.baseMode,
})
catalogue.catalogueUpdatedAt = new Date().toISOString()
catalogue.filmstocks.sort((a, b) => a.filmStockId.localeCompare(b.filmStockId))
assertSchema(catalogueSchema, catalogue, 'filmstock-catalogue.json')

await mkdir(join(outputRoot, 'runtime'), { recursive: true })
await mkdir(join(outputRoot, 'previews'), { recursive: true })
await mkdir(join(sourceOutputRoot, 'source'), { recursive: true })
await writeFile(join(outputRoot, 'runtime', runtimeName), runtime)
await writeFile(join(outputRoot, 'recipe.json'), `${JSON.stringify(publishedRecipe, null, 2)}\n`)
await cp(join(packageRoot, 'attribution.txt'), join(outputRoot, 'attribution.txt'))
for (const name of previewNames) await cp(join(previewSource, name), join(outputRoot, 'previews', name))
await cp(sourcePath, join(sourceOutputRoot, 'source', `${filmStockId}.cube`))
await cp(join(packageRoot, 'recipe.json'), join(sourceOutputRoot, 'recipe.json'))
await cp(join(packageRoot, 'attribution.txt'), join(sourceOutputRoot, 'attribution.txt'))
await cp(join(packageRoot, 'authoring-notes.md'), join(sourceOutputRoot, 'authoring-notes.md'))

const publishedFiles = [
  join(outputRoot, 'runtime', runtimeName),
  join(outputRoot, 'recipe.json'),
  join(outputRoot, 'attribution.txt'),
  ...previewNames.map((name) => join(outputRoot, 'previews', name)),
]
for (const path of publishedFiles) {
  const relative = path.slice(assetsRoot.length + 1).replaceAll('\\', '/')
  lock[relative] = sha256(await readFile(path))
}

const sortedLock = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)))
await writeFile(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`)
await writeFile(lockPath, `${JSON.stringify(sortedLock, null, 2)}\n`)

console.log(`Published ${filmStockId} locally (${runtime.length} runtime bytes).`)
for (const warning of diagnostics.warnings) console.warn(`Warning: ${warning}`)
for (const warning of imageValidation.warnings) console.warn(`Warning: ${warning}`)
console.log('Review the generated catalogue/assets, run the filmstock tests, then use npm run deploy.')

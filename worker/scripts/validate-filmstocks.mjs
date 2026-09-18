import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(workerRoot, 'filmstock-assets')
const lock = JSON.parse(await readFile(join(assetsRoot, 'immutable-lock.json'), 'utf8'))

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? filesBelow(join(directory, entry.name)) : Promise.resolve([join(directory, entry.name)]),
    ),
  )
  return nested.flat()
}

const assetFiles = (await filesBelow(assetsRoot)).filter((path) => !path.endsWith('immutable-lock.json'))
const seen = new Set()
for (const path of assetFiles) {
  const key = relative(assetsRoot, path).replaceAll('\\', '/')
  const bytes = await readFile(path)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (lock[key] !== actual) {
    throw new Error(
      `${key} differs from its immutable lock. Publish a visually changed recipe under a new filmStockId.`,
    )
  }
  seen.add(key)

  if (key.startsWith('recipes/') && key.endsWith('.json')) {
    const recipe = JSON.parse(bytes.toString('utf8'))
    const expectedId = key.slice('recipes/'.length, -'.json'.length)
    if (recipe.schemaVersion !== 1 || recipe.filmStockId !== expectedId) {
      throw new Error(`${key} does not match its versioned recipe identity`)
    }
    if (!Array.isArray(recipe.colorMatrix) || recipe.colorMatrix.length !== 20) {
      throw new Error(`${key} must contain one 4x5 colorMatrix`)
    }
  }
}

for (const key of Object.keys(lock)) {
  if (!seen.has(key)) throw new Error(`Immutable filmstock asset is missing: ${key}`)
}

console.log(`Validated ${seen.size} immutable filmstock assets.`)

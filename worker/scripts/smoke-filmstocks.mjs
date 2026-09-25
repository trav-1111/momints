import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuntimeLut } from './lib/filmstock-package.mjs'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(join(workerRoot, 'filmstock-assets', 'immutable-lock.json'), 'utf8'))
const baseUrl = (process.argv[2] ?? process.env.FILMSTOCK_SMOKE_BASE_URL)?.replace(/\/$/, '')
if (!baseUrl) throw new Error('Usage: node scripts/smoke-filmstocks.mjs <isolated-worker-base-url>')

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const catalogueResponse = await fetch(`${baseUrl}/v1/filmstocks`, { cache: 'no-store' })
if (!catalogueResponse.ok) throw new Error(`Catalogue returned ${catalogueResponse.status}`)
const catalogue = await catalogueResponse.json()
if (!Array.isArray(catalogue.filmstocks)) throw new Error('Catalogue response is malformed')

for (const [key, expectedHash] of Object.entries(lock)) {
  const response = await fetch(`${baseUrl}/v1/filmstocks/assets/${key}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${key} returned ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (hash(bytes) !== expectedHash) throw new Error(`${key} failed immutable-lock checksum`)
  if (key.endsWith('.lut')) parseRuntimeLut(bytes)
}

for (const stock of catalogue.filmstocks) {
  const recipeResponse = await fetch(stock.recipeUrl, { cache: 'no-store' })
  if (!recipeResponse.ok) throw new Error(`${stock.filmStockId} recipe returned ${recipeResponse.status}`)
  const recipe = await recipeResponse.json()
  if (recipe.filmStockId !== stock.filmStockId) throw new Error(`${stock.filmStockId} recipe identity mismatch`)
  if (recipe.schemaVersion === 2) {
    const lutResponse = await fetch(new URL(recipe.lut.uri, recipeResponse.url), { cache: 'no-store' })
    if (!lutResponse.ok) throw new Error(`${stock.filmStockId} LUT returned ${lutResponse.status}`)
    const bytes = new Uint8Array(await lutResponse.arrayBuffer())
    parseRuntimeLut(bytes)
    if (hash(bytes) !== recipe.lut.sha256) throw new Error(`${stock.filmStockId} recipe LUT checksum mismatch`)
  }
  for (const previewUrl of stock.previewImageUrls) {
    const response = await fetch(previewUrl, { cache: 'no-store' })
    if (!response.ok || !(await response.arrayBuffer()).byteLength) {
      throw new Error(`${stock.filmStockId} preview is missing or empty`)
    }
  }
}

console.log(`Smoke-tested ${catalogue.filmstocks.length} catalogue entries and ${Object.keys(lock).length} assets.`)

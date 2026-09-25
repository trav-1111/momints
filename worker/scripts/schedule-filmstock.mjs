import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSchema } from './lib/json-schema.mjs'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cataloguePath = resolve(workerRoot, 'filmstock-catalogue.json')
const catalogueSchema = JSON.parse(await readFile(resolve(workerRoot, 'filmstock-catalogue.schema.json'), 'utf8'))
const value = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const id = value('--id')
if (!id) throw new Error('Usage: node scripts/schedule-filmstock.mjs --id <id> [--from ISO|null] [--until ISO|null]')
const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'))
const stock = catalogue.filmstocks.find((candidate) => candidate.filmStockId === id)
if (!stock) throw new Error(`Unknown filmStockId: ${id}`)
if (stock.evergreen) throw new Error('House films do not use rotation windows')
const parseDate = (raw, previous) => {
  if (raw === undefined) return previous
  if (raw === 'null') return null
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new Error(`Invalid ISO date with timezone: ${raw}`)
  }
  return new Date(raw).toISOString()
}
stock.availableFrom = parseDate(value('--from'), stock.availableFrom)
stock.availableUntil = parseDate(value('--until'), stock.availableUntil)
if (
  stock.availableFrom &&
  stock.availableUntil &&
  Date.parse(stock.availableFrom) >= Date.parse(stock.availableUntil)
) {
  throw new Error('availableFrom must be earlier than availableUntil')
}
catalogue.catalogueUpdatedAt = new Date().toISOString()
assertSchema(catalogueSchema, catalogue, 'filmstock-catalogue.json')
await writeFile(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`)
console.log(`Updated ${id}: ${stock.availableFrom ?? 'open'} → ${stock.availableUntil ?? 'open'}`)

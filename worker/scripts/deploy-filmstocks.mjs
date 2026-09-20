import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(workerRoot, 'filmstock-assets')
const bucket = 'momints-filmstocks'
const baseUrl = process.env.FILMSTOCK_SMOKE_BASE_URL?.replace(/\/$/, '')
if (!baseUrl) throw new Error('FILMSTOCK_SMOKE_BASE_URL is required for immutable remote preflight and smoke tests')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workerRoot, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const lock = JSON.parse(await readFile(join(assetsRoot, 'immutable-lock.json'), 'utf8'))
const contentType = (key) => {
  const extension = extname(key).toLowerCase()
  return extension === '.json'
    ? 'application/json'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.txt'
            ? 'text/plain; charset=utf-8'
            : 'application/octet-stream'
}

run(process.execPath, ['scripts/validate-filmstocks.mjs'])
for (const [key, expectedHash] of Object.entries(lock)) {
  const publicUrl = `${baseUrl}/v1/filmstocks/assets/${key}`
  const existing = await fetch(publicUrl, { cache: 'no-store' })
  if (existing.ok) {
    const remoteHash = hash(new Uint8Array(await existing.arrayBuffer()))
    if (remoteHash !== expectedHash) throw new Error(`Refusing to replace immutable R2 object ${key}`)
    continue
  }
  if (existing.status !== 404) throw new Error(`R2 preflight failed for ${key} (${existing.status})`)
  run('npx', [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    '--file',
    join(assetsRoot, key),
    '--content-type',
    contentType(key),
    '--remote',
  ])
}

run('npx', ['wrangler', 'deploy'])
const catalogueResponse = await fetch(`${baseUrl}/v1/filmstocks`, { cache: 'no-store' })
if (!catalogueResponse.ok) throw new Error(`Production catalogue smoke test failed (${catalogueResponse.status})`)
const catalogue = await catalogueResponse.json()
if (!Array.isArray(catalogue.filmstocks)) throw new Error('Production catalogue response is malformed')
for (const stock of catalogue.filmstocks) {
  const response = await fetch(stock.recipeUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Production recipe smoke test failed for ${stock.filmStockId}`)
  const recipe = await response.json()
  if (recipe.schemaVersion === 2) {
    const lutResponse = await fetch(new URL(recipe.lut.uri, response.url), { cache: 'no-store' })
    if (!lutResponse.ok) throw new Error(`Production LUT smoke test failed for ${stock.filmStockId}`)
    const lutHash = hash(new Uint8Array(await lutResponse.arrayBuffer()))
    if (lutHash !== recipe.lut.sha256) throw new Error(`Production LUT checksum failed for ${stock.filmStockId}`)
  }
  for (const previewUrl of stock.previewImageUrls) {
    const preview = await fetch(previewUrl, { cache: 'no-store' })
    if (!preview.ok) throw new Error(`Production preview smoke test failed for ${stock.filmStockId}`)
  }
}
console.log(`Deployed and smoke-tested ${catalogue.filmstocks.length} filmstocks.`)

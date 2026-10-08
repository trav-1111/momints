import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDeployTarget } from './lib/deploy-target.mjs'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = join(workerRoot, 'filmstock-assets')
const wranglerPath = join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const target = resolveDeployTarget(process.argv.slice(2), process.env, workerRoot)
const { bucket, baseUrl } = target

function smokeFetch(url, options = {}) {
  if (!target.connectIp) return fetch(url, options)
  return new Promise((resolveFetch, reject) => {
    const family = isIP(target.connectIp)
    const request = httpsRequest(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions?.all) callback(null, [{ address: target.connectIp, family }])
          else callback(null, target.connectIp, family)
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const result = new Response(Buffer.concat(chunks), {
            status: response.statusCode,
            statusText: response.statusMessage,
            headers: response.headers,
          })
          Object.defineProperty(result, 'url', { value: String(url) })
          resolveFetch(result)
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workerRoot, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

function runWrangler(args) {
  run(process.execPath, [wranglerPath, '--config', target.configPath, ...args])
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
  const existing = await smokeFetch(publicUrl, { cache: 'no-store' })
  if (existing.ok) {
    const remoteHash = hash(new Uint8Array(await existing.arrayBuffer()))
    if (remoteHash !== expectedHash) throw new Error(`Refusing to replace immutable R2 object ${key}`)
    continue
  }
  if (existing.status !== 404) throw new Error(`R2 preflight failed for ${key} (${existing.status})`)
  if (target.verifyOnly) throw new Error(`Immutable production asset is missing: ${key}`)
  runWrangler([
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

if (target.verifyOnly) {
  console.log(`Verified immutable filmstock objects on guarded ${target.name} target (${bucket}, ${baseUrl}).`)
} else {
  console.log(`Deploying filmstocks to guarded ${target.name} target (${bucket}, ${baseUrl}).`)
  runWrangler(['deploy'])
}
const catalogueResponse = await smokeFetch(`${baseUrl}/v1/filmstocks`, { cache: 'no-store' })
if (!catalogueResponse.ok) throw new Error(`${target.name} catalogue smoke test failed (${catalogueResponse.status})`)
const catalogue = await catalogueResponse.json()
if (!Array.isArray(catalogue.filmstocks)) throw new Error(`${target.name} catalogue response is malformed`)
for (const stock of catalogue.filmstocks) {
  const response = await smokeFetch(stock.recipeUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${target.name} recipe smoke test failed for ${stock.filmStockId}`)
  const recipe = await response.json()
  if (recipe.schemaVersion === 2) {
    const lutResponse = await smokeFetch(new URL(recipe.lut.uri, response.url), { cache: 'no-store' })
    if (!lutResponse.ok) throw new Error(`${target.name} LUT smoke test failed for ${stock.filmStockId}`)
    const lutHash = hash(new Uint8Array(await lutResponse.arrayBuffer()))
    if (lutHash !== recipe.lut.sha256) throw new Error(`${target.name} LUT checksum failed for ${stock.filmStockId}`)
  }
  for (const previewUrl of stock.previewImageUrls) {
    const preview = await smokeFetch(previewUrl, { cache: 'no-store' })
    if (!preview.ok) throw new Error(`${target.name} preview smoke test failed for ${stock.filmStockId}`)
  }
}
console.log(
  `${target.verifyOnly ? 'Verified' : 'Deployed and smoke-tested'} ${catalogue.filmstocks.length} filmstocks on ${target.name}.`,
)

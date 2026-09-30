import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'

const confirmation = '--confirm-read-only-production'
if (!process.argv.includes(confirmation)) {
  throw new Error(`Pass ${confirmation}; this suite expects the production Worker to be paused.`)
}

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = 'https://api.momints.xyz'
const evidenceRoot = join(workerRoot, '.production-evidence', '2026-09-30-cutover')
const results = []

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), { redirect: 'error', ...init })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // Plain-text root/404 responses are valid evidence too.
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body, text }
}

function record(name, expectedStatus, response, predicate = () => true) {
  const passed = response.status === expectedStatus && predicate(response)
  results.push({ name, expectedStatus, actualStatus: response.status, passed })
  assert.ok(passed, `${name}: expected ${expectedStatus}, got ${response.status}: ${response.text.slice(0, 300)}`)
  return response
}

const health = record('health remains readable', 200, await request('/health'), (r) => r.body?.ok === true)
assert.equal(health.body.checks.deployment, 'production')
assert.equal(health.body.checks.maintenance, true)
assert.equal(health.body.checks.d1, true)

record('fees remain readable', 200, await request('/fees'), (r) => Number.isInteger(r.body?.quickFeeLamports))
record(
  'catalogue remains readable at production origin',
  200,
  await request('/v1/filmstocks'),
  (r) =>
    r.body?.filmstocks?.length === 4 &&
    r.body.filmstocks.every((stock) => stock.recipeUrl.startsWith(`${baseUrl}/v1/filmstocks/assets/`)),
)
record(
  'read-only unlock route reaches validation',
  400,
  await request('/v1/filmstocks/unlocked', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ creatorAddress: 'not-an-address' }),
  }),
)

for (const path of ['/funding/status', '/treasury/status', '/ops/status', '/ops/dashboard/health']) {
  record(`${path} remains operator protected`, 401, await request(path))
}

const collection = Keypair.generate().publicKey.toBase58()
const mutations = [
  ['create roll', '/rolls', 'POST'],
  ['mint frame', `/rolls/${collection}/frames`, 'POST'],
  ['authorize legacy roll', `/rolls/${collection}/authorize`, 'POST'],
  ['complete roll', `/rolls/${collection}/complete`, 'POST'],
  ['stage Quick image', '/quick/stage', 'POST'],
  ['finalize Quick mint', '/quick/finalize', 'POST'],
  ['release Quick stage', '/quick/stage/00000000-0000-4000-8000-000000000000', 'DELETE'],
  ['issue SKR quote', '/skr/quote', 'POST'],
  ['send operator alert', '/ops/test-alert', 'GET'],
  ['run Quick redrive', '/ops/sweep-quick-mints', 'GET'],
]

for (const [name, path, method] of mutations) {
  record(
    `maintenance blocks ${name}`,
    503,
    await request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : 'x',
    }),
    (r) => r.body?.maintenance === true && r.headers['retry-after'] === '300',
  )
}

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  readOnly: true,
  paidOperations: false,
  notificationsInvoked: false,
  results,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(join(evidenceRoot, 'maintenance-http-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `Production maintenance checks passed: ${results.filter((result) => result.passed).length}/${results.length}`,
)

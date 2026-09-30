import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACCOUNT_ID = '722d3248891665c30e47acd64086e876'
const ZONE_ID = '0a4e1935d60dd95e21e9d40b9d6b5dea'
const PROMOTED_WORKER = 'momints-roll-worker-staging'
const RETIRED_WORKER = 'momints-roll-worker'
const mode = process.argv.includes('--expect-active-paused')
  ? 'active-paused'
  : process.argv.includes('--expect-active')
    ? 'active'
    : 'maintenance'
const queues = [
  ['momints-quick-finalize', 'de3666de7bb54a459dee4dfc1ed2927f'],
  ['momints-quick-finalize-dlq', 'c64c36f46301441890f2683614354e2b'],
  ['momints-quick-finalize-staging', 'a4559b90aae6467499531501625c5493'],
  ['momints-quick-finalize-staging-dlq', 'f35895ee0f124cb5a88aba3a55ed06ef'],
]

function parseTomlString(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))
  return match?.[1]
}

const wranglerConfig = await readFile(join(homedir(), '.wrangler', 'config', 'default.toml'), 'utf8')
const token = parseTomlString(wranglerConfig, 'oauth_token')
assert.ok(token, 'Wrangler OAuth token is unavailable')

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json()
  assert.equal(response.ok && body.success !== false, true, `${path}: ${JSON.stringify(body.errors ?? body)}`)
  return body.result
}

const [promotedSchedules, retiredSchedules, promotedSubdomain, retiredSubdomain, domains, routes] = await Promise.all([
  cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${PROMOTED_WORKER}/schedules`),
  cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${RETIRED_WORKER}/schedules`),
  cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${PROMOTED_WORKER}/subdomain`),
  cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${RETIRED_WORKER}/subdomain`),
  cloudflare(`/accounts/${ACCOUNT_ID}/workers/domains`),
  cloudflare(`/zones/${ZONE_ID}/workers/routes`),
])

const queueState = []
for (const [name, id] of queues) {
  const [queue, metrics] = await Promise.all([
    cloudflare(`/accounts/${ACCOUNT_ID}/queues/${id}`),
    cloudflare(`/accounts/${ACCOUNT_ID}/queues/${id}/metrics`),
  ])
  queueState.push({
    name,
    id,
    deliveryPaused: queue.settings?.delivery_paused === true,
    producers: queue.producers_total_count ?? queue.producers?.length ?? 0,
    consumers: queue.consumers_total_count ?? queue.consumers?.length ?? 0,
    backlogCount: metrics.backlog_count,
    backlogBytes: metrics.backlog_bytes,
  })
}

const promotedCrons = promotedSchedules.schedules?.map((item) => item.cron) ?? []
const retiredCrons = retiredSchedules.schedules?.map((item) => item.cron) ?? []
const relevantDomains = domains
  .filter((domain) => domain.service === PROMOTED_WORKER || domain.service === RETIRED_WORKER)
  .map(({ hostname, service, environment }) => ({ hostname, service, environment }))
const relevantRoutes = routes
  .filter((route) => route.script === PROMOTED_WORKER || route.script === RETIRED_WORKER)
  .map(({ pattern, script }) => ({ pattern, script }))

const expectedCrons = mode === 'maintenance' ? [] : ['0 */3 * * *', '0 */6 * * *']
assert.deepEqual(promotedCrons.toSorted(), expectedCrons, `Promoted Worker schedules do not match ${mode} mode`)
assert.deepEqual(retiredCrons, [], 'Retired Worker must have no schedules')
assert.deepEqual(promotedSubdomain, { enabled: false, previews_enabled: false })
assert.deepEqual(retiredSubdomain, { enabled: false, previews_enabled: false })
assert.deepEqual(relevantRoutes, [], 'Neither Worker may retain a zone route')
assert.deepEqual(relevantDomains, [
  { hostname: 'api.momints.xyz', service: PROMOTED_WORKER, environment: 'production' },
])
for (const queue of queueState) {
  const isProduction = queue.name === 'momints-quick-finalize' || queue.name === 'momints-quick-finalize-dlq'
  const expectedPaused = mode === 'active' && isProduction ? false : true
  const expectedProducers = mode !== 'maintenance' && queue.name === 'momints-quick-finalize' ? 1 : 0
  const expectedConsumers = mode !== 'maintenance' && isProduction ? 1 : 0
  assert.equal(queue.deliveryPaused, expectedPaused, `${queue.name} pause state does not match ${mode} mode`)
  assert.equal(queue.producers, expectedProducers, `${queue.name} producer count does not match ${mode} mode`)
  assert.equal(queue.consumers, expectedConsumers, `${queue.name} consumer count does not match ${mode} mode`)
  assert.equal(queue.backlogCount, 0, `${queue.name} has queued messages before activation`)
}

console.log(
  JSON.stringify(
    {
      promoted: { schedules: promotedCrons, subdomain: promotedSubdomain },
      retired: { schedules: retiredCrons, subdomain: retiredSubdomain },
      domains: relevantDomains,
      zoneRoutes: relevantRoutes,
      queues: queueState,
      mode,
    },
    null,
    2,
  ),
)

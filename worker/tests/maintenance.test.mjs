import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  isHttpRouteBlockedByMaintenance,
  isMaintenanceMode,
  MAINTENANCE_QUEUE_RETRY_SECONDS,
} from '../src/maintenance.ts'

const workerRoot = resolve(import.meta.dirname, '..')

test('maintenance remains active even when real-looking secrets are present', () => {
  const secretsPresent = {
    MAINTENANCE_MODE: 'true',
    IRYS_FUNDING_KEY: 'secret-present',
    SOLANA_RPC_URL: 'https://mainnet.example.invalid',
    OPS_AUTH_TOKEN: 'operator-secret-present',
  }
  assert.equal(isMaintenanceMode(secretsPresent), true)
  assert.equal(isMaintenanceMode({ ...secretsPresent, MAINTENANCE_MODE: 'false' }), false)
  assert.equal(isMaintenanceMode({ ...secretsPresent, MAINTENANCE_MODE: 'TRUE' }), false)
})

test('maintenance blocks every spending or mint-state HTTP path and keeps safe reads available', () => {
  for (const kind of [
    'ops-test-alert',
    'ops-sweep-quick-mints',
    'create-roll',
    'mint-frame',
    'authorize-roll',
    'complete-roll',
    'stage-quick',
    'finalize-quick',
    'release-quick',
    'skr-quote',
  ]) {
    assert.equal(isHttpRouteBlockedByMaintenance(kind), true, kind)
  }

  for (const kind of [
    'filmstock-catalogue',
    'filmstock-unlocked',
    'filmstock-asset',
    'funding-status',
    'treasury-status',
    'fees',
    'ops-status',
    'ops-recompute-fees',
    'open-roll',
    'get-roll',
    'get-quick',
    'identity-skr',
    'ops-dashboard-wallets',
    'ops-dashboard-health',
    'ops-dashboard-metrics',
  ]) {
    assert.equal(isHttpRouteBlockedByMaintenance(kind), false, kind)
  }
})

test('a secrets-present maintenance dispatch never calls mocked spending providers', async () => {
  const env = {
    MAINTENANCE_MODE: 'true',
    IRYS_FUNDING_KEY: 'secret-present',
    SOLANA_RPC_URL: 'https://mainnet.example.invalid',
  }
  const calls = { storage: 0, signer: 0, queue: 0, notification: 0 }
  const providers = {
    storage: async () => calls.storage++,
    signer: async () => calls.signer++,
    queue: async () => calls.queue++,
    notification: async () => calls.notification++,
  }

  for (const route of ['create-roll', 'mint-frame', 'finalize-quick', 'ops-test-alert']) {
    if (!isMaintenanceMode(env) || !isHttpRouteBlockedByMaintenance(route)) {
      await Promise.all(Object.values(providers).map((provider) => provider()))
    }
  }
  assert.deepEqual(calls, { storage: 0, signer: 0, queue: 0, notification: 0 })
})

test('HTTP, Queue and Cron guards run before providers or credentials are constructed', async () => {
  const source = await readFile(resolve(workerRoot, 'src/index.ts'), 'utf8')
  const fetchGuard = source.indexOf('isHttpRouteBlockedByMaintenance(route.kind)')
  const fetchContext = source.indexOf('const ctx = new WorkerContext(validateEnv(env))', fetchGuard)
  assert.ok(fetchGuard > 0 && fetchContext > fetchGuard)

  const queueStart = source.indexOf('async queue(')
  const queueGuard = source.indexOf('if (isMaintenanceMode(env))', queueStart)
  const queueContext = source.indexOf('const ctx = new WorkerContext(validateEnv(env))', queueStart)
  assert.ok(queueGuard > queueStart && queueContext > queueGuard)
  assert.match(source.slice(queueGuard, queueContext), new RegExp(`delaySeconds: MAINTENANCE_QUEUE_RETRY_SECONDS`))
  assert.equal(MAINTENANCE_QUEUE_RETRY_SECONDS, 900)

  const scheduledStart = source.indexOf('async scheduled(')
  const scheduledGuard = source.indexOf('if (isMaintenanceMode(env))', scheduledStart)
  const scheduledContext = source.indexOf('ctx = new WorkerContext(validateEnv(env))', scheduledStart)
  assert.ok(scheduledGuard > scheduledStart && scheduledContext > scheduledGuard)
})

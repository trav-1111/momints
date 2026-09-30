import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const workerRoot = resolve(import.meta.dirname, '..')

test('former staging configuration cannot target the promoted production service', async () => {
  const config = await readFile(resolve(workerRoot, 'wrangler.staging.toml'), 'utf8')
  assert.match(config, /name = "momints-roll-worker-sandbox"/)
  assert.match(config, /MAINTENANCE_MODE = "true"/)
  assert.match(config, /workers_dev = false/)
  assert.match(config, /preview_urls = false/)
  assert.doesNotMatch(config, /^name = "momints-roll-worker-staging"$/m)
  assert.doesNotMatch(config, /staging-api\.momints\.xyz/)
  assert.doesNotMatch(config, /api\.momints\.xyz/)
  assert.doesNotMatch(config, /^\[triggers\]$/m)
  assert.doesNotMatch(config, /\[\[queues\.(?:producers|consumers)\]\]/)
})

test('retired staging mutation helpers fail before reading credentials or Cloudflare state', async () => {
  const secretHelper = await readFile(resolve(workerRoot, 'scripts/configure-staging-secrets.mjs'), 'utf8')
  assert.match(secretHelper, /Disabled after promotion/)
  assert.doesNotMatch(secretHelper, /readFile/)

  const remoteSuite = await readFile(resolve(workerRoot, 'scripts/test-staging-deployment.mjs'), 'utf8')
  const guard = remoteSuite.indexOf("if (!process.argv.includes('--confirm-new-sandbox'))")
  const firstCredentialRead = remoteSuite.indexOf('readFile(credentialsPath')
  assert.ok(guard > 0 && firstCredentialRead > guard)
})

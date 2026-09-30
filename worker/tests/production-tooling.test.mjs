import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { resolveDeployTarget } from '../scripts/lib/deploy-target.mjs'

const workerRoot = resolve(import.meta.dirname, '..')

test('filmstock deployer targets only the promoted production service and exact origin', () => {
  const production = resolveDeployTarget([], { FILMSTOCK_SMOKE_BASE_URL: 'https://api.momints.xyz' }, workerRoot)
  assert.equal(production.name, 'production')
  assert.equal(production.bucket, 'momints-filmstocks')
  assert.equal(production.configPath, resolve(workerRoot, 'wrangler.toml'))

  assert.throws(
    () => resolveDeployTarget([], { FILMSTOCK_SMOKE_BASE_URL: 'https://staging-api.momints.xyz' }, workerRoot),
    /unexpected origin/,
  )
  assert.throws(
    () =>
      resolveDeployTarget(
        ['--target', 'staging'],
        { FILMSTOCK_SMOKE_BASE_URL: 'https://staging-api.momints.xyz' },
        workerRoot,
      ),
    /former staging service was promoted/,
  )
  assert.equal(
    resolveDeployTarget(
      ['--target', 'production', '--verify-only', '--connect-ip', '104.21.38.216'],
      { FILMSTOCK_SMOKE_BASE_URL: 'https://api.momints.xyz' },
      workerRoot,
    ).verifyOnly,
    true,
  )
})

test('default production config is paused and binds only preserved production resources', async () => {
  const config = await readFile(resolve(workerRoot, 'wrangler.toml'), 'utf8')
  assert.match(config, /name = "momints-roll-worker-staging"/)
  assert.match(config, /pattern = "api\.momints\.xyz"/)
  assert.match(config, /DEPLOYMENT_ENV = "production"/)
  assert.match(config, /MAINTENANCE_MODE = "true"/)
  assert.match(config, /database_id = "c4897487-5eef-4569-87a4-14306d4eac72"/)
  assert.match(config, /bucket_name = "momints-quick-staging"/)
  assert.match(config, /bucket_name = "momints-filmstocks"/)
  assert.doesNotMatch(config, /momints-rolls-staging/)
  assert.doesNotMatch(config, /momints-quick-staging-test/)
  assert.doesNotMatch(config, /^\[triggers\]$/m)
  assert.doesNotMatch(config, /\[\[queues\.(?:producers|consumers)\]\]/)
})

test('activation and rollback configs remain explicit and mutually safe', async () => {
  const [active, rollback] = await Promise.all([
    readFile(resolve(workerRoot, 'wrangler.production-active.toml'), 'utf8'),
    readFile(resolve(workerRoot, 'wrangler.rollback.toml'), 'utf8'),
  ])
  assert.match(active, /name = "momints-roll-worker-staging"/)
  assert.match(active, /MAINTENANCE_MODE = "false"/)
  assert.match(active, /^\[triggers\]$/m)
  assert.equal((active.match(/\[\[queues\.consumers\]\]/g) ?? []).length, 2)
  assert.doesNotMatch(active, /momints-rolls-staging/)

  assert.match(rollback, /name = "momints-roll-worker"/)
  assert.match(rollback, /MAINTENANCE_MODE = "true"/)
  assert.match(rollback, /workers_dev = false/)
  assert.match(rollback, /preview_urls = false/)
  assert.doesNotMatch(rollback, /api\.momints\.xyz/)
  assert.doesNotMatch(rollback, /^\[triggers\]$/m)
  assert.doesNotMatch(rollback, /\[\[queues\.(?:producers|consumers)\]\]/)
})

test('activation helper requires an exact owner-confirmation flag', async () => {
  const script = await readFile(resolve(workerRoot, 'scripts/deploy-production-active.mjs'), 'utf8')
  assert.match(script, /--confirm-owner-secrets-and-production-activation/)
  assert.match(script, /wrangler\.production-active\.toml/)
  assert.match(script, /momints-rolls-staging/)
})

test('operator funding and treasury routes remain bearer protected', async () => {
  const source = await readFile(resolve(workerRoot, 'src/index.ts'), 'utf8')
  const fundingCase = source.slice(source.indexOf("case 'funding-status':"), source.indexOf("case 'treasury-status':"))
  const treasuryCase = source.slice(source.indexOf("case 'treasury-status':"), source.indexOf("case 'fees':"))
  assert.ok(fundingCase.indexOf('requireOpsAuth(ctx, request)') < fundingCase.indexOf('ctx.storageSeams()'))
  assert.ok(treasuryCase.indexOf('requireOpsAuth(ctx, request)') < treasuryCase.indexOf('ctx.treasury.status()'))
})

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(workerRoot, 'wrangler.production-active.toml')
const wranglerPath = join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const confirmation = '--confirm-owner-secrets-and-production-activation'

if (!process.argv.includes(confirmation)) {
  throw new Error(
    `Refusing to activate paid production paths. Pass ${confirmation} only after completing Phase 3 of the cutover runbook.`,
  )
}

const config = await readFile(configPath, 'utf8')
for (const required of [
  'name = "momints-roll-worker-staging"',
  'pattern = "api.momints.xyz"',
  'DEPLOYMENT_ENV = "production"',
  'MAINTENANCE_MODE = "false"',
  'database_id = "c4897487-5eef-4569-87a4-14306d4eac72"',
  'queue = "momints-quick-finalize"',
  'queue = "momints-quick-finalize-dlq"',
  '[triggers]',
]) {
  if (!config.includes(required)) throw new Error(`Active production config guard failed: missing ${required}`)
}
for (const forbidden of ['momints-rolls-staging', 'momints-quick-staging-test', 'momints-filmstocks-staging']) {
  if (config.includes(forbidden)) throw new Error(`Active production config guard failed: found ${forbidden}`)
}

const result = spawnSync(process.execPath, [wranglerPath, '--config', configPath, 'deploy'], {
  cwd: workerRoot,
  stdio: 'inherit',
  shell: false,
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error('Production activation deployment failed')

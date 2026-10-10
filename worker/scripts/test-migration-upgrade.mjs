import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerPath = join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const stateRoot = await mkdtemp(join(workerRoot, 'node_modules', '.migration-upgrade-'))

function wrangler(args, { json = false } = {}) {
  const result = spawnSync(
    process.execPath,
    [
      wranglerPath,
      '--config',
      join(workerRoot, 'wrangler.staging.toml'),
      'd1',
      'execute',
      'momints-rolls-staging',
      '--local',
      '--persist-to',
      stateRoot,
      ...args,
    ],
    {
      cwd: workerRoot,
      encoding: 'utf8',
      shell: false,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(stateRoot, 'logs') },
    },
  )
  if (result.status !== 0) {
    throw new Error(`Wrangler D1 command failed:\n${result.stdout}\n${result.stderr}`)
  }
  if (!json) return
  return JSON.parse(result.stdout)
}

try {
  for (let version = 1; version <= 8; version += 1) {
    const prefix = String(version).padStart(4, '0')
    const filename = {
      '0001': '0001_init.sql',
      '0002': '0002_ops_alerts.sql',
      '0003': '0003_quick_mints.sql',
      '0004': '0004_roll_handoff.sql',
      '0005': '0005_roll_fee_signature.sql',
      '0006': '0006_frame_lock.sql',
      '0007': '0007_fee_cache.sql',
      '0008': '0008_skr_payment.sql',
    }[prefix]
    wrangler(['--file', join(workerRoot, 'migrations', filename), '--yes'])
  }
  wrangler(['--file', join(workerRoot, 'tests', 'fixtures', 'pre-contract-legacy.sql'), '--yes'])
  wrangler(['--file', join(workerRoot, 'migrations', '0009_roll_frame_contract.sql'), '--yes'])
  wrangler(['--file', join(workerRoot, 'migrations', '0010_quick_image_artifact.sql'), '--yes'])
  wrangler(['--file', join(workerRoot, 'migrations', '0011_roll_purchase_recovery.sql'), '--yes'])
  wrangler(['--file', join(workerRoot, 'migrations', '0012_quick_recovery_evidence.sql'), '--yes'])

  const query = [
    'SELECT r.protocol_version, r.auth_hash,',
    'f.mime AS frame_mime, f.byte_length AS frame_bytes, f.width AS frame_width,',
    'f.height AS frame_height, f.image_hash AS frame_hash,',
    'q.byte_length AS quick_bytes, q.width AS quick_width,',
    'q.height AS quick_height, q.image_hash AS quick_hash',
    'FROM rolls r JOIN frames f ON f.collection_address = r.collection_address',
    "JOIN quick_mints q ON q.id = '00000000-0000-4000-8000-000000000001'",
    "WHERE r.collection_address = '22222222222222222222222222222222'",
  ].join(' ')
  const response = wrangler(['--command', query, '--json'], { json: true })
  const row = response[0]?.results?.[0]
  assert.ok(row, 'migrated synthetic legacy row was not returned')
  assert.deepEqual(row, {
    protocol_version: 1,
    auth_hash: null,
    frame_mime: null,
    frame_bytes: null,
    frame_width: null,
    frame_height: null,
    frame_hash: null,
    quick_bytes: null,
    quick_width: null,
    quick_height: null,
    quick_hash: null,
  })
  const recovery = wrangler(
    [
      '--command',
      'SELECT film_stock_id, aspect, fee_lamports, close_reason FROM rolls; SELECT payment_state, verify_attempts FROM quick_mints; SELECT COUNT(*) AS n FROM roll_creations; SELECT COUNT(*) AS n FROM job_heartbeats',
      '--json',
    ],
    { json: true },
  )
  assert.equal(recovery[0].results[0].film_stock_id, null)
  assert.equal(recovery[0].results[0].close_reason, null)
  assert.equal(recovery[1].results[0].payment_state, 'UNKNOWN')
  assert.equal(recovery[1].results[0].verify_attempts, 0)
  assert.equal(recovery[2].results[0].n, 0)
  assert.equal(recovery[3].results[0].n, 0)
  console.log(
    'Verified synthetic pre-contract rows through migrations 0009–0012; historical payment state remains unknown.',
  )
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

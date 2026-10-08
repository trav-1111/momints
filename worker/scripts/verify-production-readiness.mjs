import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_SIGNER = '6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V'
const RETIRED_STAGING_SIGNER = 'CDWnMvHWENsJumumcZMdnP5CS3T7HiKGxMwJgogKEhBQ'
const EXPECTED_TREASURY = 'o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW'
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const BASE_URL = 'https://api.momints.xyz'
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(workerRoot, '.production-evidence', '2026-09-30-cutover')

const expectActive = process.argv.includes('--confirm-active-readiness')
if (!expectActive && !process.argv.includes('--confirm-maintenance-readiness')) {
  throw new Error('Pass --confirm-maintenance-readiness or --confirm-active-readiness.')
}

function parseVars(source) {
  const values = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const split = line.indexOf('=')
    if (split < 1) continue
    const key = line.slice(0, split).trim()
    let value = line.slice(split + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

async function request(path, token) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: response.status, body, text }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  })
  assert.equal(response.ok, true, `RPC ${method} returned HTTP ${response.status}`)
  const body = await response.json()
  assert.equal(body.error, undefined, `RPC ${method} failed: ${body.error?.message ?? 'unknown error'}`)
  return body.result
}

const vars = parseVars(await readFile(join(workerRoot, '.dev.vars'), 'utf8'))
assert.ok(vars.OPS_AUTH_TOKEN, 'OPS_AUTH_TOKEN is missing from worker/.dev.vars')
assert.ok(vars.SOLANA_RPC_URL, 'SOLANA_RPC_URL is missing from worker/.dev.vars')

const health = await request('/health')
assert.equal(health.status, 200)
assert.equal(health.body?.checks?.deployment, 'production')
assert.equal(health.body?.checks?.maintenance, !expectActive)
assert.equal(health.body?.checks?.d1, true)
assert.equal(health.body?.checks?.discordWebhookConfigured, false)

const protectedPaths = [
  '/funding/status',
  '/treasury/status',
  '/ops/status',
  '/ops/recompute-fees',
  '/ops/dashboard/wallets',
  '/ops/dashboard/health',
  '/ops/dashboard/metrics?window=all',
]
for (const path of protectedPaths) {
  const unauthenticated = await request(path)
  assert.equal(unauthenticated.status, 401, `${path} was not protected from unauthenticated access`)
}
const wrongToken = await request('/ops/dashboard/wallets', `${vars.OPS_AUTH_TOKEN}-wrong`)
assert.equal(wrongToken.status, 401, 'Wrong operator token was not rejected')

const [wallets, funding, treasury, ops, dashboardHealth, metrics, feesBefore] = await Promise.all([
  request('/ops/dashboard/wallets', vars.OPS_AUTH_TOKEN),
  request('/funding/status', vars.OPS_AUTH_TOKEN),
  request('/treasury/status', vars.OPS_AUTH_TOKEN),
  request('/ops/status', vars.OPS_AUTH_TOKEN),
  request('/ops/dashboard/health', vars.OPS_AUTH_TOKEN),
  request('/ops/dashboard/metrics?window=all', vars.OPS_AUTH_TOKEN),
  request('/fees'),
])
for (const [name, response] of [
  ['wallets', wallets],
  ['funding', funding],
  ['treasury', treasury],
  ['ops', ops],
  ['dashboard health', dashboardHealth],
  ['metrics', metrics],
  ['fees', feesBefore],
]) {
  assert.equal(response.status, 200, `${name} failed: ${response.status} ${response.text.slice(0, 300)}`)
}

assert.equal(wallets.body.signer.address, EXPECTED_SIGNER)
assert.notEqual(wallets.body.signer.address, RETIRED_STAGING_SIGNER)
assert.equal(wallets.body.treasury.address, EXPECTED_TREASURY)
assert.equal(wallets.body.signer.turbo.balanceAtomic, funding.body.balanceAtomic)
assert.equal(wallets.body.signer.turbo.rollsRemaining, funding.body.rollsRemaining)
assert.equal(funding.body.sufficient, true, 'Turbo balance does not cover one permanent image')
assert.ok(funding.body.rollsRemaining >= 1, 'Turbo balance does not cover one conservative 24-frame roll')
assert.ok(wallets.body.signer.solLamports > 0, 'Production signer has no SOL')
assert.equal(ops.body.discordConfigured, false)
assert.equal(ops.body.operatorMentionConfigured, false)
assert.equal(dashboardHealth.body.quickMints.deferredPendingRecovery, 0)
assert.equal(dashboardHealth.body.quickMints.dead, 0)
assert.equal(dashboardHealth.body.rolls.stuckHandoffs, 0)

const [genesisHash, localSignerBalance, localTreasuryBalance, localSkrBalance, turboResponse] = await Promise.all([
  rpc(vars.SOLANA_RPC_URL, 'getGenesisHash'),
  rpc(vars.SOLANA_RPC_URL, 'getBalance', [EXPECTED_SIGNER]),
  rpc(vars.SOLANA_RPC_URL, 'getBalance', [EXPECTED_TREASURY]),
  rpc(vars.SOLANA_RPC_URL, 'getTokenAccountBalance', [wallets.body.treasury.skr.ata]).catch((error) => {
    if (error.message.includes('could not find account')) return null
    throw error
  }),
  fetch(`https://payment.ardrive.io/v1/account/balance/solana?address=${EXPECTED_SIGNER}`, {
    signal: AbortSignal.timeout(20_000),
  }),
])
assert.equal(genesisHash, MAINNET_GENESIS)
assert.equal(localSignerBalance.value, wallets.body.signer.solLamports)
assert.equal(localTreasuryBalance.value, wallets.body.treasury.solLamports)
assert.equal(localSkrBalance?.value?.amount ?? '0', wallets.body.treasury.skr.atomic)
assert.equal(turboResponse.ok, true, `Turbo balance returned HTTP ${turboResponse.status}`)
const turbo = await turboResponse.json()
assert.equal(String(turbo.effectiveBalance ?? turbo.winc ?? '0'), funding.body.balanceAtomic)

let recompute = null
let feesAfter = feesBefore
if (!expectActive) {
  recompute = await request('/ops/recompute-fees', vars.OPS_AUTH_TOKEN)
  assert.equal(recompute.status, 200, `Fee recompute failed: ${recompute.status} ${recompute.text.slice(0, 500)}`)
  assert.equal(recompute.body?.ok, true)
  assert.equal(
    recompute.body.alertNotes.some((note) => note.startsWith('posted ')),
    false,
    'Fee recompute unexpectedly reported a delivered Discord alert',
  )

  feesAfter = await request('/fees')
  assert.equal(feesAfter.status, 200)
  assert.equal(feesAfter.body.lastGood, true)
  assert.deepEqual(
    {
      quickFeeLamports: feesAfter.body.quickFeeLamports,
      rollFee12Lamports: feesAfter.body.rollFee12Lamports,
      rollFee24Lamports: feesAfter.body.rollFee24Lamports,
    },
    recompute.body.fees,
  )
}
assert.equal(feesAfter.body.lastGood, true)

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  maintenance: !expectActive,
  signer: wallets.body.signer,
  treasury: wallets.body.treasury,
  funding: {
    sufficient: funding.body.sufficient,
    balanceAtomic: funding.body.balanceAtomic,
    balanceCredits: funding.body.balanceCredits,
    rollsRemaining: funding.body.rollsRemaining,
    level: funding.body.level,
  },
  protectedRoutes: { unauthenticatedRejected: protectedPaths.length, wrongTokenRejected: true },
  workload: dashboardHealth.body,
  metrics: {
    mints: metrics.body.mints,
    rolls: metrics.body.rolls,
    uniqueWallets: metrics.body.uniqueWallets,
  },
  treasuryLedger: treasury.body,
  rpc: { genesisHash, balancesMatchDeployedWorker: true },
  fees: { before: feesBefore.body, recompute: recompute?.body ?? null, after: feesAfter.body },
  discordConfigured: false,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(
  join(evidenceRoot, expectActive ? 'phase3-active.json' : 'phase3-readiness.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)

console.log(
  JSON.stringify(
    {
      signer: report.signer,
      treasury: report.treasury,
      funding: report.funding,
      protectedRoutes: report.protectedRoutes,
      workload: {
        quickMints: report.workload.quickMints,
        rolls: report.workload.rolls,
      },
      rpc: report.rpc,
      fees: report.fees.after,
      discordConfigured: report.discordConfigured,
    },
    null,
    2,
  ),
)

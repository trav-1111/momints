const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

test('missing Discord delivery cannot suppress the job attempt heartbeat or change delivered-alert hysteresis', async () => {
  const load = sourceLoader()
  const { withJobHeartbeat } = load('worker/src/ops/heartbeat.ts')
  const { runTreasuryMonitor } = load('worker/src/ops/monitor.ts')
  const writes = []
  let alerts = 0
  const result = await withJobHeartbeat(
    {
      start: async (...args) => writes.push(['start', ...args]),
      finish: async (...args) => writes.push(['finish', ...args]),
    },
    'treasury-monitor',
    () =>
      runTreasuryMonitor({
        env: {},
        alerts: {
          get: async () => ({ last_level: 'critical' }),
          record: async () => {
            alerts++
          },
        },
        getFunding: async () => ({
          balanceStatus: async () => ({
            balanceAtomic: '144000000',
            requiredAtomic: '1000000',
            anticipatedBytes: 3145728,
            sufficient: true,
          }),
        }),
      }),
    (value) => value.checks.every((check) => check.ok),
  )
  assert.equal(result.checks[0].ok, false)
  assert.equal(writes[0][0], 'start')
  assert.equal(writes[1][0], 'finish')
  assert.equal(writes[1][3], false)
  assert.equal(alerts, 0)
})

test('a thrown recovery job records failure and the next job can still run', async () => {
  const { withJobHeartbeat } = sourceLoader()('worker/src/ops/heartbeat.ts')
  const outcomes = []
  const store = { start: async () => {}, finish: async (job, _, ok) => outcomes.push([job, ok]) }
  await assert.rejects(
    withJobHeartbeat(store, 'quick-sweep', async () => {
      throw Error('Queue unavailable')
    }),
  )
  await withJobHeartbeat(store, 'roll-handoff', async () => true)
  assert.deepEqual(outcomes, [
    ['quick-sweep', false],
    ['roll-handoff', true],
  ])
})

test('dashboard health reads job attempts independently of stale alert-delivery state', async () => {
  const { getHealthSnapshot } = sourceLoader()('worker/src/ops/dashboard.ts')
  const result = await getHealthSnapshot({
    db: {
      getQuickMintCounts: async () => [],
      getDeferredQuickMintCount: async () => 6,
      getStuckRollHandoffCount: async () => 1,
      getQuickRecoveryCounts: async () => ({ unknown: 7, confirmed: 0, rejected: 0, review: 1 }),
    },
    feeCache: { get: async () => ({}) },
    opsAlerts: { get: async () => ({ updated_at: '2026-10-02T00:00:00Z', last_level: 'critical' }) },
    jobs: {
      list: async () => [{ job: 'treasury-monitor', last_attempt_at: '2026-10-11T00:00:00Z', last_attempt_ok: 0 }],
    },
    discordWebhookConfigured: false,
  })
  assert.equal(result.crons.treasuryMonitorAndSweep.lastRunAt, '2026-10-11T00:00:00Z')
  assert.equal(result.notifications.lastAlertStateAt, '2026-10-02T00:00:00Z')
  assert.equal(result.notifications.discordWebhookConfigured, false)
  assert.equal(result.quickRecovery.confirmed, 0)
  assert.doesNotMatch(JSON.stringify(result), /wallet/)
})

test('only finalized expiry with absent historical signature, transaction and asset permits a fresh quick payment', async () => {
  const original = global.fetch
  const replies = {
    getSignatureStatuses: { value: [null] },
    getAccountInfo: { value: null },
    getBlockHeight: 101,
    getTransaction: null,
  }
  global.fetch = async (_, opts) => new Response(JSON.stringify({ result: replies[JSON.parse(opts.body).method] }))
  try {
    const { quickAttemptDidNotLand } = sourceLoader({
      'src/store/network.ts': { getClusterRpc: () => 'https://example.test' },
    })('src/services/quickAttemptOutcome.ts')
    const entry = { signature: 'receipt', assetAddress: 'asset', lastValidBlockHeight: '100' }
    assert.equal(await quickAttemptDidNotLand(entry), true)
    replies.getAccountInfo.value = { data: ['', 'base64'] }
    assert.equal(await quickAttemptDidNotLand(entry), false)
    replies.getAccountInfo.value = null
    replies.getSignatureStatuses.value = [{ confirmationStatus: 'finalized', err: null }]
    assert.equal(await quickAttemptDidNotLand(entry), false)
    replies.getSignatureStatuses.value = [null]
    replies.getBlockHeight = 100
    assert.equal(await quickAttemptDidNotLand(entry), false)
    global.fetch = async () => {
      throw Error('RPC offline')
    }
    assert.equal(await quickAttemptDidNotLand(entry), false)
  } finally {
    global.fetch = original
  }
})

test('paid image retention copies and verifies bytes before changing the D1 pointer', async () => {
  const { preserveQuickAttempt } = sourceLoader()('worker/src/quick/preserve.ts')
  const calls = [],
    object = { size: 3, body: Uint8Array.of(1, 2, 3), httpMetadata: { contentType: 'image/jpeg' } }
  let copied = false
  const db = { preserveQuickStaging: async (...args) => calls.push(['pointer', ...args]) }
  const bucket = {
    head: async () => (copied ? object : null),
    get: async () => object,
    put: async () => {
      copied = true
      calls.push(['copy'])
    },
  }
  await preserveQuickAttempt(db, bucket, { id: 'id', staging_key: 'quick-staging/wallet/id' })
  assert.deepEqual(calls, [['copy'], ['pointer', 'id', 'quick-staging/wallet/id', 'quick-recovery/id']])
})

test('missing retention bytes leave the original pointer intact', async () => {
  const { preserveQuickAttempt } = sourceLoader()('worker/src/quick/preserve.ts')
  let changed = false
  await assert.rejects(
    preserveQuickAttempt(
      {
        preserveQuickStaging: async () => {
          changed = true
        },
      },
      { head: async () => null, get: async () => null },
      { id: 'id', staging_key: 'quick-staging/wallet/id' },
    ),
    (e) => e.status === 503,
  )
  assert.equal(changed, false)
})

test('an old unverified quick attempt is flagged for review and still reconciled even if notification fails', async () => {
  let attempts = 0
  const states = []
  const { redriveDeferredFinalizes } = sourceLoader({
    'worker/src/quick/finalize.ts': {
      finalizeQuickMint: async () => {
        attempts++
        throw Error('RPC unavailable')
      },
    },
  })('worker/src/quick/sweep.ts')
  const result = await redriveDeferredFinalizes({
    db: {
      listDeferredFinalizeQuickMints: async () => [
        {
          id: 'id',
          signature: 'signature',
          asset_address: 'asset',
          created_at: new Date(Date.now() - 25 * 3600000).toISOString(),
        },
      ],
      recordQuickVerification: async (...args) => states.push(args),
      markQuickMintDead: async () => {
        throw Error('Age must not mark a payment dead')
      },
    },
    alert: async () => {
      throw Error('Discord offline')
    },
  })
  assert.equal(attempts, 1)
  assert.equal(result.stillDeferred, 1)
  assert.equal(result.needsReview, 1)
  assert.deepEqual(states, [['id', 'UNKNOWN', 'REVIEW_REQUIRED']])
})

test('a quick receipt alone cannot authorize paid retention, an upload or treasury accrual', async () => {
  const states = []
  const { finalizeQuickMint } = sourceLoader({
    '@metaplex-foundation/umi': { publicKey: (x) => x },
    'worker/src/quick/verify.ts': {
      verifyQuickMintPayment: async () => ({ ok: false, retryable: true, reason: 'Signature absent' }),
    },
    'worker/src/quick/preserve.ts': {
      preserveQuickAttempt: async () => {
        throw Error('Unverified payment must not buy retention')
      },
    },
  })('worker/src/quick/finalize.ts')
  await assert.rejects(
    finalizeQuickMint(
      {
        db: {
          getQuickMint: async () => ({ id: 'id', status: 'STAGED', fee_currency: 'SOL' }),
          recordFinalizeAttempt: async () => {},
          recordQuickVerification: async (...args) => states.push(args),
        },
        getUmi: async () => ({}),
        queue: {
          send: async () => {
            throw Error('Must not enqueue')
          },
        },
        treasury: {
          record: async () => {
            throw Error('Must not accrue')
          },
        },
      },
      { stagingKey: 'id', signature: 'a'.repeat(88), assetAddress: '2'.repeat(32) },
    ),
    (e) => e.status === 503,
  )
  assert.deepEqual(states, [['id', 'UNKNOWN', 'RPC_PENDING']])
})

test('SEC-002: quick payment verification enforces staging key memo binding', async () => {
  const victimStage = 'victim-staging-key-123'
  const attackerStage = 'attacker-staging-key-456'
  const wallet = '11111111111111111111111111111111'
  const treasury = '22222222222222222222222222222222'
  const asset = '33333333333333333333333333333333'

  const makeVerifier = (memos) =>
    sourceLoader({
      'worker/src/solana/confirm.ts': {
        getTransaction: async () => ({
          blockTime: Math.floor(Date.now() / 1000),
          transaction: {
            message: {
              accountKeys: [{ pubkey: wallet }, { pubkey: treasury }, { pubkey: asset }],
            },
          },
          meta: { err: null, preBalances: [1000, 0, 0], postBalances: [500, 500, 1] },
        }),
        extractTransactionMemos: () => memos,
      },
      '@metaplex-foundation/mpl-core': {
        safeFetchAssetV1: async () => ({
          uri: 'https://arweave.net/placeholder',
          owner: { toString: () => wallet },
          updateAuthority: { type: 'Address', address: { toString: () => 'worker-authority' } },
        }),
      },
      '@metaplex-foundation/umi': {
        publicKey: (x) => x,
      },
    })('worker/src/quick/verify.ts').verifyQuickMintPayment

  const umi = { identity: { publicKey: { toString: () => 'worker-authority' } } }

  // Case 1: Matching staging key memo -> OK
  const legitimate = await makeVerifier([`momints:quick:${victimStage}`])(umi, 'unused', {
    signature: 'a'.repeat(88),
    assetAddress: asset,
    wallet,
    treasury,
    placeholderUri: 'https://arweave.net/placeholder',
    requiredLamports: 500,
    expectedStagingKey: victimStage,
  })
  assert.equal(legitimate.ok, true)

  // Case 2: Attacker attempting image substitution with attacker staging key -> REJECTED
  const substituted = await makeVerifier([`momints:quick:${victimStage}`])(umi, 'unused', {
    signature: 'a'.repeat(88),
    assetAddress: asset,
    wallet,
    treasury,
    placeholderUri: 'https://arweave.net/placeholder',
    requiredLamports: 500,
    expectedStagingKey: attackerStage,
  })
  assert.equal(substituted.ok, false)
  assert.match(substituted.reason, /different staged image/)

  // Case 3: Missing memo binding -> REJECTED
  const missingMemo = await makeVerifier([])(umi, 'unused', {
    signature: 'a'.repeat(88),
    assetAddress: asset,
    wallet,
    treasury,
    placeholderUri: 'https://arweave.net/placeholder',
    requiredLamports: 500,
    expectedStagingKey: victimStage,
  })
  assert.equal(missingMemo.ok, false)
  assert.match(missingMemo.reason, /missing quick staging memo binding/)
})


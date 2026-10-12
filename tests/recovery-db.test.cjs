/* global __dirname */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')
const { sourceLoader } = require('./helpers/load-source.cjs')

function database() {
  const sqlite = new DatabaseSync(':memory:')
  const migrations = path.join(__dirname, '../worker/migrations')
  for (const file of fs
    .readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  const db = {
    prepare(sql) {
      let args = []
      const bindings = () =>
        /\?\d/.test(sql) ? [Object.fromEntries(args.map((value, index) => [String(index + 1), value]))] : args
      return {
        bind(...values) {
          args = values
          return this
        },
        async run() {
          const info = sqlite.prepare(sql).run(...bindings())
          return { meta: { changes: Number(info.changes) } }
        },
        async first() {
          return sqlite.prepare(sql).get(...bindings()) ?? null
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...bindings()) }
        },
      }
    },
  }
  return { sqlite, db }
}

test('actual SQL reserves one pending receipt per wallet and fences stale lease owners', async () => {
  const { sqlite, db } = database()
  try {
    const { RollCreationStore } = sourceLoader()('worker/src/rolls/creationStore.ts')
    const store = new RollCreationStore(db)
    assert.equal(await store.hasPendingWallet('wallet'), false)
    await store.reserve('first', { wallet: 'wallet', name: 'original' })
    assert.equal(await store.hasPendingWallet('wallet'), true)
    await assert.rejects(store.reserve('second', { wallet: 'wallet', name: 'other' }), (e) => e.status === 409)
    assert.equal(await store.claim('first', 'owner1'), true)
    assert.equal(await store.claim('first', 'owner2'), false)
    await assert.rejects(
      store.checkpoint('first', 'owner2', { wallet: 'wallet', name: 'wrong' }),
      (e) => e.status === 503,
    )
    assert.equal((await store.get('first')).name, 'original')
    await store.release('first', 'owner2')
    assert.equal(await store.claim('first', 'owner2'), false)
    await store.release('first', 'owner1')
    assert.equal(await store.claim('first', 'owner2'), true)
    await store.finish('first')
    assert.equal(await store.hasPendingWallet('wallet'), false)
    await store.reserve('second', { wallet: 'wallet', name: 'next' })
    assert.equal((await store.get('second')).name, 'next')
  } finally {
    sqlite.close()
  }
})

test('actual SQL records one treasury entry per roll receipt across retries', async () => {
  const { sqlite, db } = database()
  try {
    const { ManualSink } = sourceLoader()('worker/src/providers/treasury/manual.ts')
    const sink = new ManualSink(db)
    const context = { kind: 'roll_fee', feeSignature: 'receipt', wallet: 'wallet', collection: 'collection', size: 12 }
    await sink.record(100, context)
    await sink.record(100, context)
    assert.equal((await sink.status()).pendingLamports, 100)
    assert.equal((await sink.status()).pendingCount, 1)
  } finally {
    sqlite.close()
  }
})

test('a roll committed while another receipt verifies cannot admit a second creation', async () => {
  const { sqlite, db } = database()
  try {
    const load = sourceLoader()
    const rolls = new (load('worker/src/db/index.ts').RollDb)(db)
    const store = new (load('worker/src/rolls/creationStore.ts').RollCreationStore)(db)
    await rolls.insertRoll({
      collectionAddress: 'first-collection',
      protocolVersion: 2,
      authHash: 'hash',
      wallet: 'wallet',
      name: '2026-10-11.01',
      size: 12,
      artist: 'Original',
      skrIdentity: 'wallet',
      coverUri: 'cover',
      metadataUri: 'metadata',
      createSignature: 'create',
      feeSignature: 'paid',
    })
    await assert.rejects(store.reserve('late-receipt', { wallet: 'wallet', name: 'second' }), (e) => e.status === 409)
    assert.equal(await store.get('late-receipt'), null)
    assert.equal(await store.hasPendingWallet('wallet'), false)
  } finally {
    sqlite.close()
  }
})

test('roll persistence includes immutable recovery settings and closure audits remain idempotent', async () => {
  const { sqlite, db } = database()
  try {
    const { RollDb } = sourceLoader()('worker/src/db/index.ts')
    const rolls = new RollDb(db)
    await rolls.insertRoll({
      collectionAddress: 'collection',
      wallet: 'wallet',
      name: '2026-10-11.01',
      size: 12,
      artist: 'Original',
      skrIdentity: 'original.skr',
      coverUri: 'cover',
      metadataUri: 'metadata',
      createSignature: 'create',
      feeSignature: 'paid',
      protocolVersion: 2,
      authHash: 'hash',
      filmStockId: 'martha-v1',
      filmMode: 'bw',
      aspect: '4:3',
      feeLamports: 100,
    })
    const saved = await rolls.getRoll('collection')
    assert.equal(saved.film_stock_id, 'martha-v1')
    assert.equal(saved.aspect, '4:3')
    assert.equal(saved.fee_lamports, 100)
    await rolls.closeRoll('collection', 'user-discard')
    await rolls.closeRoll('collection', 'user-close-unused')
    const closed = sqlite.prepare('SELECT status,close_reason,closed_by,closed_at FROM rolls').get()
    assert.equal(closed.status, 'COMPLETE')
    assert.equal(closed.close_reason, 'user-discard')
    assert.equal(closed.closed_by, 'capability-holder')
    assert.ok(closed.closed_at)
    for (let i = 1; i <= 12; i++)
      sqlite
        .prepare("INSERT INTO frames (collection_address,frame_index,status) VALUES ('collection',?,'MINTED')")
        .run(i)
    await rolls.syncMintedCount('collection')
    assert.equal(sqlite.prepare('SELECT close_reason FROM rolls').get().close_reason, 'user-discard')
  } finally {
    sqlite.close()
  }
})

test('actual SQL preserves review state during transient verification and records independent job outcomes', async () => {
  const { sqlite, db } = database()
  try {
    const load = sourceLoader()
    const { RollDb } = load('worker/src/db/index.ts')
    const rolls = new RollDb(db)
    sqlite.exec(
      "INSERT INTO quick_mints (id,wallet,metadata_json,staging_key,mime,status) VALUES ('id','wallet','{}','quick-staging/id','image/jpeg','STAGED')",
    )
    await rolls.recordFinalizeAttempt('id', 'asset', 'signature')
    await rolls.recordQuickVerification('id', 'UNKNOWN', 'REVIEW_REQUIRED')
    await rolls.recordQuickVerification('id', 'UNKNOWN', 'RPC_PENDING')
    assert.equal((await rolls.getQuickMint('id')).recovery_reason, 'REVIEW_REQUIRED')
    assert.deepEqual(
      { ...(await rolls.getQuickRecoveryCounts()) },
      { unknown: 1, confirmed: 0, rejected: 0, review: 1 },
    )
    const { JobHeartbeatStore } = load('worker/src/ops/heartbeat.ts')
    const jobs = new JobHeartbeatStore(db)
    await jobs.start('treasury-monitor', '2026-10-11T00:00:00Z')
    await jobs.finish('treasury-monitor', '2026-10-11T00:00:00Z', false)
    await jobs.start('quick-sweep', '2026-10-11T00:00:01Z')
    await jobs.finish('quick-sweep', '2026-10-11T00:00:01Z', true)
    const rows = await jobs.list()
    assert.equal(rows.find((row) => row.job === 'treasury-monitor').last_attempt_ok, 0)
    assert.equal(rows.find((row) => row.job === 'quick-sweep').last_success_at, '2026-10-11T00:00:01Z')
  } finally {
    sqlite.close()
  }
})

test('SEC-002: markQuickMintDead releases unique receipt fields so rejected attempts cannot poison receipts', async () => {
  const { sqlite, db } = database()
  try {
    const { RollDb } = sourceLoader()('worker/src/db/index.ts')
    const rolls = new RollDb(db)
    // Stage two distinct quick mint rows
    sqlite.exec(
      "INSERT INTO quick_mints (id,wallet,metadata_json,staging_key,mime,status) VALUES ('attacker-stage','attacker-wallet','{}','quick-staging/att','image/jpeg','STAGED')",
    )
    sqlite.exec(
      "INSERT INTO quick_mints (id,wallet,metadata_json,staging_key,mime,status) VALUES ('victim-stage','victim-wallet','{}','quick-staging/vic','image/jpeg','STAGED')",
    )

    // Attacker submits victim receipt -> records attempt on attacker-stage
    await rolls.recordFinalizeAttempt('attacker-stage', 'victim-asset', 'victim-signature')

    // Attacker attempt is rejected -> markQuickMintDead is called
    await rolls.markQuickMintDead('attacker-stage')

    const attackerRow = await rolls.getQuickMint('attacker-stage')
    assert.equal(attackerRow.status, 'DEAD')
    assert.equal(attackerRow.signature, null)
    assert.equal(attackerRow.asset_address, null)

    // Legitimate victim attempt can now claim the signature without 409 UNIQUE constraint conflict
    await rolls.recordFinalizeAttempt('victim-stage', 'victim-asset', 'victim-signature')
    const victimRow = await rolls.getQuickMint('victim-stage')
    assert.equal(victimRow.signature, 'victim-signature')
    assert.equal(victimRow.asset_address, 'victim-asset')
  } finally {
    sqlite.close()
  }
})


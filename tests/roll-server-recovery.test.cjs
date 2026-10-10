const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { sourceLoader } = require('./helpers/load-source.cjs')
const wallet = '4v18dR8ragCoz6mvUki7Vf6sAHbDLd2MnzvbwkinWuZM'
const capability = 'a'.repeat(43)
const authHash = createHash('sha256').update(capability).digest('hex')
const req = {
  wallet,
  size: 12,
  filmStockId: 'martha-v1',
  feeSignature: 'paid-receipt',
  rollCapability: capability,
  localDate: '2020-01-01',
}
const row = {
  collection_address: 'BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9',
  wallet,
  size: 12,
  film_stock_id: 'martha-v1',
  fee_currency: 'SOL',
  auth_hash: authHash,
  status: 'COMPLETE',
  name: '2026-10-11.01',
  minted_count: 0,
  fee_lamports: 100,
  artist: 'Tester',
  skr_identity: wallet,
  cover_uri: 'https://arweave.net/cover',
  metadata_uri: 'https://arweave.net/meta',
  create_signature: 'created',
  fee_signature: req.feeSignature,
}
function loader(mocks = {}) {
  return sourceLoader({
    '@metaplex-foundation/umi': { publicKey: (x) => x },
    'worker/src/rolls/cover.ts': {},
    'worker/src/filmstocks/catalogue.ts': { knownFilmStock: () => true },
    ...mocks,
  })
}
const deps = {
  db: {
    getRollByFeeSignature: async () => row,
    getOpenRoll: async () => {
      throw Error('Replay must precede open/date checks')
    },
  },
  treasury: { record: async () => {} },
  creations: { finish: async () => {} },
}

test('receipt replay returns COMPLETE without reopening, including after the original date expires', async () => {
  const result = await loader()('worker/src/rolls/create.ts').createRoll(deps, req)
  assert.equal(result.collectionAddress, row.collection_address)
  assert.equal(result.status, 'COMPLETE')
})
test('a public receipt alone does not authorize replay', async () => {
  await assert.rejects(
    loader()('worker/src/rolls/create.ts').createRoll(deps, { ...req, rollCapability: 'b'.repeat(43) }),
    (e) => e.status === 403,
  )
})
test('replay cannot change purchased size or currency', async () => {
  const { createRoll } = loader()('worker/src/rolls/create.ts')
  for (const changed of [{ size: 24 }, { payment: 'SKR' }, { filmStockId: 'other' }]) {
    await assert.rejects(createRoll(deps, { ...req, ...changed }), (e) => e.status === 409)
  }
})
test('a timely SKR payment remains verifiable after quote expiry', async () => {
  const now = Date.now()
  const load = loader({
    'worker/src/solana/confirm.ts': {
      getTransaction: async () => ({
        blockTime: Math.floor((now - 120000) / 1000),
        transaction: { message: { accountKeys: [{ pubkey: wallet }] } },
        meta: { err: null },
      }),
    },
    'worker/src/skr/verify.ts': { checkSkrTransfer: () => ({ ok: true }) },
  })
  const result = await load('worker/src/rolls/verify.ts').verifyRollFeePayment('unused', {
    signature: 'receipt',
    wallet,
    treasury: wallet,
    size: 12,
    requiredLamports: 0,
    skr: { treasurySkrAta: wallet, requiredAtomic: 100, quoteExpiresAt: new Date(now - 60000).toISOString() },
  })
  assert.equal(result.ok, true)
})

test('a pending verified creation blocks a new quote before another wallet payment', async () => {
  const { prepareRollPurchase } = loader()('worker/src/rolls/purchaseQuote.ts')
  await assert.rejects(
    prepareRollPurchase(
      {
        db: { getOpenRoll: async () => null },
        creations: { hasPendingWallet: async () => true },
        feeCache: {
          get: async () => {
            throw Error('Must not issue another payable quote')
          },
        },
      },
      { wallet, size: 12, payment: 'SOL', rollCapability: capability },
    ),
    (e) => e.status === 409,
  )
})

function creationHarness() {
  let checkpoint = null,
    lease = null,
    saved = null,
    collectionState = null,
    sends = 0,
    images = 0,
    metadata = 0,
    verification = 0,
    crashAfterSend = false
  const feeRecords = new Set()
  const creations = {
    get: async () => checkpoint && structuredClone(checkpoint),
    reserve: async (_, data) => {
      checkpoint ??= structuredClone(data)
    },
    claim: async (_, token) => {
      if (lease) return false
      lease = token
      return true
    },
    checkpoint: async (_, token, data) => {
      assert.equal(token, lease)
      checkpoint = structuredClone(data)
    },
    finish: async () => {},
    release: async (_, token) => {
      if (lease === token) lease = null
    },
  }
  const umi = {
    identity: { publicKey: 'worker' },
    rpc: { getLatestBlockhash: async () => ({ blockhash: 'hash', lastValidBlockHeight: 100 }) },
    transactions: { serialize: () => Uint8Array.of(1, 2, 3), deserialize: () => ({ fixtureTransaction: true }) },
  }
  const load = loader({
    '@metaplex-foundation/mpl-core': {
      safeFetchCollectionV1: async () => collectionState,
      createCollection: () => ({
        setBlockhash() {
          return this
        },
        buildAndSign: async () => ({ signatures: [Uint8Array.of(1)] }),
      }),
    },
    'worker/src/solana/client.ts': {
      rollCollectionSigner: async () => ({ publicKey: row.collection_address }),
      signatureToBase58: () => 'creation-signature',
    },
    'worker/src/solana/confirm.ts': {
      getSignatureStatus: async () => null,
      getFinalizedBlockHeight: async () => 50,
      sendAndConfirm: async () => {
        assert.equal(checkpoint.signedTransaction, 'AQID', 'signed bytes must precede broadcast')
        sends++
        collectionState = {
          uri: checkpoint.metadataUri,
          name: checkpoint.name,
          updateAuthority: wallet,
          updateDelegate: { authority: { type: 'Address', address: 'worker' } },
        }
        if (crashAfterSend) throw Error('Confirmation connection lost')
        return 'creation-signature'
      },
    },
    'worker/src/rolls/verify.ts': {
      verifyRollFeePayment: async () => {
        verification++
        return { ok: true, feeLamports: 100, paidAt: Date.now() }
      },
    },
    'worker/src/rolls/cover.ts': { generateCover: async () => ({ bytes: Uint8Array.of(1), mime: 'image/jpeg' }) },
    'worker/src/lib/royalties.ts': { royaltiesPlugin: () => ({}) },
  })
  return {
    create: load('worker/src/rolls/create.ts').createRoll,
    deps: {
      creations,
      db: {
        getRollByFeeSignature: async () => saved,
        getOpenRoll: async () => null,
        countRollsForDay: async () => 0,
        insertRoll: async (data) => {
          assert.equal(saved, null)
          saved = { ...row, status: 'OPEN', name: data.name, create_signature: data.createSignature }
        },
      },
      feeCache: { get: async () => ({ rollFee12Lamports: 100 }) },
      getUmi: async () => umi,
      getSeams: async () => ({
        funding: { ensureFunded: async () => ({ sufficient: true, warning: null }) },
        storage: {
          uploadImage: async () => {
            images++
            return row.cover_uri
          },
          uploadJSON: async () => {
            metadata++
            return row.metadata_uri
          },
        },
      }),
      treasury: { record: async (_, context) => feeRecords.add(context.feeSignature) },
    },
    request: { ...req, localDate: new Date().toISOString().slice(0, 10) },
    crash: () => {
      crashAfterSend = true
    },
    get counts() {
      return { sends, images, metadata, verification, fees: feeRecords.size }
    },
  }
}

test('lost confirmation after chain creation resumes the same collection with no repeated upload or send', async () => {
  const h = creationHarness()
  h.crash()
  await assert.rejects(h.create(h.deps, h.request), /connection lost/)
  const recovered = await h.create(h.deps, h.request)
  assert.equal(recovered.collectionAddress, row.collection_address)
  assert.deepEqual(h.counts, { sends: 1, images: 1, metadata: 1, verification: 1, fees: 1 })
})

test('concurrent receipt replays cannot create two collections', async () => {
  const h = creationHarness()
  const results = await Promise.allSettled([h.create(h.deps, h.request), h.create(h.deps, h.request)])
  assert.ok(results.some((result) => result.status === 'fulfilled'))
  assert.equal(h.counts.sends, 1)
  assert.equal(h.counts.fees, 1)
})

test('real Umi derives a stable domain-separated collection signer and round-trips a signed create transaction', async () => {
  const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults')
  const { keypairIdentity, publicKey } = require('@metaplex-foundation/umi')
  const { createCollection, mplCore } = require('@metaplex-foundation/mpl-core')
  const umi = createUmi('https://example.test').use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSeed(new Uint8Array(32).fill(7))))
  const { rollCollectionSigner, signatureToBase58 } = sourceLoader()('worker/src/solana/client.ts')
  const one = await rollCollectionSigner(umi, 'receipt-one')
  const again = await rollCollectionSigner(umi, 'receipt-one')
  const two = await rollCollectionSigner(umi, 'receipt-two')
  assert.equal(one.publicKey, again.publicKey)
  assert.notEqual(one.publicKey, two.publicKey)
  assert.notEqual(one.publicKey, umi.identity.publicKey)
  const tx = await createCollection(umi, {
    collection: one,
    name: 'Recovery fixture',
    uri: 'https://arweave.net/fixture',
    updateAuthority: publicKey(wallet),
  })
    .setBlockhash({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 })
    .buildAndSign(umi)
  const decoded = umi.transactions.deserialize(umi.transactions.serialize(tx))
  assert.equal(signatureToBase58(decoded.signatures[0]), signatureToBase58(tx.signatures[0]))
  assert.deepEqual(decoded.serializedMessage, tx.serializedMessage)
})

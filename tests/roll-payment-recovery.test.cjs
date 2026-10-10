const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

const wallet = '4v18dR8ragCoz6mvUki7Vf6sAHbDLd2MnzvbwkinWuZM'
const collection = 'BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9'
const opts = {
  size: 12,
  artist: 'Tester',
  skrIdentity: wallet,
  film: { mode: 'color', filmStockId: 'martha-v1' },
  aspect: '4:3',
  payment: 'SOL',
}

function harness() {
  const disk = new Map()
  let payments = 0,
    requests = [],
    failWrite = false,
    loseResponse = true
  const mocks = {
    'expo-secure-store': {
      getItemAsync: async (k) => disk.get(k) ?? null,
      setItemAsync: async (k, v) => {
        if (failWrite) throw Error('Storage unavailable')
        disk.set(k, v)
      },
      deleteItemAsync: async (k) => disk.delete(k),
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    },
    'react-native-quick-crypto': require('node:crypto'),
    'src/config/rollApi.ts': { localDateLabel: () => '2026-10-11' },
    'src/services/quickAttemptOutcome.ts': { quickAttemptDidNotLand: async () => false },
    'src/services/rollApi.ts': {
      getOpenWorkerRoll: async () => null,
      prepareWorkerRoll: async () => ({ quoteId: 'quote', amount: 100, expiresAt: '2026-10-11T10:00:00Z' }),
      createWorkerRoll: async (body) => {
        requests.push(body)
        if (loseResponse) throw Error('Network request failed')
        return {
          collectionAddress: collection,
          name: '2026-10-11.01',
          status: 'OPEN',
          mintedCount: 0,
          size: 12,
          filmStockId: 'martha-v1',
        }
      },
    },
  }
  const pay = async (_, onSigned) => {
    payments++
    await onSigned({ signature: 'receipt', blockhash: 'blockhash', lastValidBlockHeight: '100' })
    return 'receipt'
  }
  return {
    load: () => sourceLoader(mocks)('src/services/rollCreation.ts'),
    disk,
    pay,
    get payments() {
      return payments
    },
    get requests() {
      return requests
    },
    failWrite: () => {
      failWrite = true
    },
    recover: () => {
      loseResponse = false
    },
  }
}

test('paid retry across restart reuses receipt, capability and pinned options', async () => {
  const h = harness()
  await assert.rejects(h.load().createOrRecoverRoll(wallet, opts, h.pay), /receipt/)
  h.recover()
  const result = await h.load().createOrRecoverRoll(wallet, { ...opts, size: 24, artist: 'Changed' }, h.pay)
  assert.equal(h.payments, 1)
  assert.equal(result.roll.collectionAddress, collection)
  assert.equal(result.purchase.size, 12)
  assert.equal(h.requests[0].rollCapability, h.requests[1].rollCapability)
  assert.equal(h.requests[1].feeSignature, 'receipt')
})

test('storage failure before payment fails closed', async () => {
  const h = harness()
  h.failWrite()
  await assert.rejects(h.load().createOrRecoverRoll(wallet, opts, h.pay), /Storage/)
  assert.equal(h.payments, 0)
})

test('concurrent taps share one purchase', async () => {
  const h = harness()
  h.recover()
  const service = h.load()
  await Promise.all([
    service.createOrRecoverRoll(wallet, opts, h.pay),
    service.createOrRecoverRoll(wallet, opts, h.pay),
  ])
  assert.equal(h.payments, 1)
})

test('uncertain signing outcome survives restart and never automatically pays again', async () => {
  const h = harness()
  await assert.rejects(
    h.load().createOrRecoverRoll(wallet, opts, async () => {
      throw Error('Wallet disconnected')
    }),
  )
  await assert.rejects(h.load().createOrRecoverRoll(wallet, opts, h.pay), /wallet|signature|pending/i)
  assert.equal(h.payments, 0)
})

test('a wallet cancellation before broadcast can safely retry the saved purchase', async () => {
  const h = harness()
  h.recover()
  const service = h.load()
  await assert.rejects(
    service.createOrRecoverRoll(wallet, opts, async () => {
      throw new service.RollPaymentNotSentError('Cancelled before send')
    }),
  )
  await h.load().createOrRecoverRoll(wallet, opts, h.pay)
  assert.equal(h.payments, 1)
})

test('failure saving the signed receipt prevents broadcast', async () => {
  const h = harness()
  let broadcasts = 0
  await assert.rejects(
    h.load().createOrRecoverRoll(wallet, opts, async (_, onSigned) => {
      h.failWrite()
      await onSigned({ signature: 'receipt', blockhash: 'hash', lastValidBlockHeight: '100' })
      broadcasts++
      return 'receipt'
    }),
  )
  assert.equal(broadcasts, 0)
})

test('only an unpaid prepared purchase can be explicitly cancelled', async () => {
  const h = harness()
  const service = h.load()
  await assert.rejects(
    service.createOrRecoverRoll(wallet, opts, async () => {
      throw new service.RollPaymentNotSentError('Cancelled')
    }),
  )
  await service.cancelUnpaidRollPurchase(wallet)
  assert.equal(await service.getPendingRollPurchase(wallet), null)
  await assert.rejects(service.createOrRecoverRoll(wallet, opts, h.pay))
  await assert.rejects(service.cancelUnpaidRollPurchase(wallet), /recovery/)
  assert.equal((await service.getPendingRollPurchase(wallet)).signature, 'receipt')
})

test('corrupt saved purchase state blocks another payment', async () => {
  const h = harness()
  await assert.rejects(h.load().createOrRecoverRoll(wallet, opts, h.pay))
  const purchaseKey = [...h.disk.keys()].find((key) => key.startsWith('roll-purchase-'))
  h.disk.set(purchaseKey, '{broken')
  await assert.rejects(h.load().createOrRecoverRoll(wallet, opts, h.pay))
  assert.equal(h.payments, 1)
})

test('old quick-mint receipt remains pending through transient RPC failure', async () => {
  const entry = {
    stagingKey: 'stage',
    signature: 'signature',
    assetAddress: collection,
    photoId: 'photo',
    createdAt: Date.now() - 86400000,
    attempts: 0,
  }
  let stored = JSON.stringify([entry])
  class File {
    get exists() {
      return true
    }
    async text() {
      return stored
    }
    write(value) {
      stored = value
    }
  }
  class RollApiError extends Error {
    constructor(status, message) {
      super(message)
      this.status = status
    }
  }
  const service = sourceLoader({
    'expo-file-system': { Paths: { document: '/fixture' }, File },
    'src/services/quickMintApi.ts': {
      finalizeQuickMint: async () => {
        throw new RollApiError(503, 'RPC unavailable')
      },
    },
    'src/services/rollApi.ts': { RollApiError },
    'src/services/permanentAsset.ts': {},
    'src/store/mintQueue.ts': {},
  })('src/store/quickFinalize.ts')
  assert.equal((await service.checkPriorAttempt('photo')).action, 'wait')
  assert.equal(await service.countPendingFinalizes(), 1)
})

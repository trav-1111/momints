const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { act, create } = require('react-test-renderer')
const { sourceLoader } = require('./helpers/load-source.cjs')
global.IS_REACT_ACT_ENVIRONMENT = true
const wallet = '4v18dR8ragCoz6mvUki7Vf6sAHbDLd2MnzvbwkinWuZM'
const collection = 'BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9'

async function harness({ frames = [], active = null, status = 'OPEN', pending = null } = {}) {
  let value,
    root,
    startArgs,
    resumed = 0
  const session = {
    activeRoll: active,
    startRoll: (...args) => {
      startArgs = args
      return true
    },
    resumeRoll: () => {
      resumed++
    },
  }
  const detail = {
    collectionAddress: collection,
    wallet,
    name: '2026-10-11.01',
    size: 12,
    filmStockId: 'original-film',
    filmMode: 'bw',
    aspect: '4:3',
    artist: 'Original Artist',
    skrIdentity: 'original.skr',
    createdAt: '2026-10-10T14:00:00Z',
    frames,
    status,
    mintedCount: 0,
  }
  const load = sourceLoader({
    '@wallet-ui/react-native-kit': { useMobileWallet: () => ({ account: { address: wallet } }) },
    'src/services/rollCollection.ts': {
      payRollFee: async () => {
        throw Error('Recovery must not pay')
      },
    },
    'src/services/rollApi.ts': { getWorkerRoll: async () => detail },
    'src/services/rollCreation.ts': {
      getPendingRollPurchase: async () => pending,
      createOrRecoverRoll: async () => ({ roll: detail, purchase: pending }),
    },
    'src/store/session.ts': { useSessionStore: { getState: () => session } },
    'src/store/rollRegistry.ts': { useRollRegistry: { getState: () => ({ addRoll: () => {} }) } },
    'src/services/filmstocks.ts': { ensureFilmStockRecipe: async () => {} },
    'src/store/filmstocks.ts': {
      useFilmStockStore: {
        getState: () => ({ catalogue: [{ filmStockId: 'original-film', baseMode: 'bw' }], recordUse: () => {} }),
      },
    },
  })
  const { useCreateRoll } = load('src/hooks/useCreateRoll.ts')
  function Probe() {
    value = useCreateRoll()
    return null
  }
  await act(async () => {
    root = create(React.createElement(Probe))
  })
  return {
    get value() {
      return value
    },
    get startArgs() {
      return startArgs
    },
    get resumed() {
      return resumed
    },
    recover: async () => {
      let result
      await act(async () => {
        result = await value.recoverRoll(collection)
      })
      return result
    },
    close: () => act(async () => root.unmount()),
  }
}

test('an empty stranded roll resumes with its original film, size and aspect, without payment', async () => {
  const h = await harness()
  try {
    assert.equal(await h.recover(), true)
    assert.deepEqual(h.startArgs, [
      '2026-10-11.01',
      12,
      { mode: 'bw', filmStockId: 'original-film' },
      '4:3',
      collection,
    ])
  } finally {
    await h.close()
  }
})
test('a remote pending frame reserves its index even when mintedCount is zero', async () => {
  const h = await harness({ frames: [{ frameIndex: 1, status: 'MINT_PENDING' }] })
  try {
    assert.equal(await h.recover(), false)
    assert.equal(h.startArgs, undefined)
    assert.match(h.value.error, /original device vault/)
  } finally {
    await h.close()
  }
})
test('recovering a known local roll preserves every existing local frame', async () => {
  const active = { collectionAddress: collection, frameIds: ['private-frame-one', 'private-frame-two'] }
  const h = await harness({ active })
  try {
    assert.equal(await h.recover(), true)
    assert.equal(h.resumed, 1)
    assert.equal(h.startArgs, undefined)
    assert.deepEqual(active.frameIds, ['private-frame-one', 'private-frame-two'])
  } finally {
    await h.close()
  }
})
test('recovery never reopens a completed paid roll', async () => {
  const h = await harness({ status: 'COMPLETE' })
  try {
    assert.equal(await h.recover(), false)
    assert.equal(h.startArgs, undefined)
    assert.match(h.value.error, /already closed/)
  } finally {
    await h.close()
  }
})

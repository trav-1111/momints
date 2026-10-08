const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

function roll(overrides = {}) {
  return {
    collectionAddress: 'roll-a',
    wallet: 'wallet',
    name: '2026-10-01.01',
    size: 24,
    artist: 'Artist',
    skrIdentity: 'artist.skr',
    film: 'color',
    filmStockId: 'momints-color-v1',
    framesMinted: 0,
    status: 'open',
    createdAt: 1,
    ...overrides,
  }
}

function frame(number, overrides = {}) {
  return {
    id: `photo-${number}`,
    mintAddress: `asset-${number}`,
    imageUri: `https://arweave.net/image-${number}`,
    transactionSignature: `signature-${number}`,
    title: `Frame ${number}`,
    artist: 'Artist',
    mintedAt: '2026-10-01T00:00:00Z',
    imageHash: `hash-${number}`,
    filmUsed: 'Bali 400',
    rollContext: {
      collectionAddress: 'roll-a',
      rollId: 'local-roll',
      rollName: 'Roll',
      frameNumber: number,
      totalFrames: 24,
    },
    ...overrides,
  }
}

async function harness(persisted = []) {
  const files = new Map([['documents/roll-registry.json', JSON.stringify(persisted)]])
  class File {
    constructor(...parts) {
      this.path = parts.join('/')
    }
    get exists() {
      return files.has(this.path)
    }
    async text() {
      return files.get(this.path)
    }
    write(value) {
      files.set(this.path, value)
    }
    delete() {
      files.delete(this.path)
    }
  }
  const load = sourceLoader({
    'expo-file-system': { Paths: { document: 'documents' }, File },
    uuid: { v4: () => 'queue-id' },
    'src/services/permanentAsset.ts': { resolvePermanentImageUri: async ({ imageUri }) => imageUri },
    'src/services/imagePrivacy.ts': {
      isPermanentArweaveUri: (uri) => uri.startsWith('https://arweave.net/'),
      normalizeArweaveUri: (uri) => uri,
    },
  })
  const registry = load('src/store/rollRegistry.ts')
  const queue = load('src/store/mintQueue.ts')
  const { recordMintSuccess } = load('src/services/recordMintSuccess.ts')
  await Promise.all([registry.rollRegistryHydrated, queue.historyHydrated])
  return { registry: registry.useRollRegistry, queue: queue.useMintQueue, recordMintSuccess, files }
}

test('Worker reconciliation followed by late success does not overcount a partial roll', async () => {
  const h = await harness([roll()])
  h.registry.getState().setFramesMinted('roll-a', 8)
  h.recordMintSuccess(frame(8))
  h.recordMintSuccess(frame(8))
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 8)
  assert.equal(h.queue.getState().mintHistory.length, 1)
})

test('all 24 frames plus duplicate callbacks remain 24/24 in either reconciliation order', async () => {
  for (const reconcileFirst of [true, false]) {
    const h = await harness([roll()])
    if (reconcileFirst) h.registry.getState().setFramesMinted('roll-a', 24)
    for (let number = 1; number <= 24; number++) {
      h.recordMintSuccess(frame(number))
      h.recordMintSuccess(frame(number))
    }
    if (!reconcileFirst) h.registry.getState().setFramesMinted('roll-a', 24)
    h.recordMintSuccess(frame(24))
    assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 24)
    assert.equal(h.queue.getState().mintHistory.length, 24)
  }
})

test('late callback with missing queue metadata preserves the reconciled history record', async () => {
  const h = await harness([roll()])
  const original = frame(1)
  h.queue.getState().addToHistory(original)
  const result = h.recordMintSuccess(
    frame(1, {
      title: 'Untitled',
      artist: '',
      rollContext: undefined,
      filmUsed: 'Color',
      imageHash: undefined,
    }),
  )
  assert.deepEqual(result, original)
  assert.deepEqual(h.queue.getState().mintHistory, [original])
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 1)
  // The same asset delivered under another local id is also a replay.
  h.recordMintSuccess(frame(1, { id: 'late-photo-id', rollContext: undefined }))
  assert.deepEqual(h.queue.getState().mintHistory, [original])
})

test('counts unique valid frame numbers per collection, excluding Quick and foreign frames', async () => {
  const h = await harness([roll(), roll({ collectionAddress: 'roll-b', size: 12 })])
  h.recordMintSuccess(frame(1))
  h.recordMintSuccess(frame(1, { id: 'duplicate', mintAddress: 'duplicate-asset' }))
  h.recordMintSuccess(frame(2, { rollContext: undefined }))
  h.recordMintSuccess(frame(3, { rollContext: { ...frame(3).rollContext, collectionAddress: 'roll-b' } }))
  h.recordMintSuccess(frame(25))
  h.recordMintSuccess(frame(0))
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 1)
  assert.equal(h.registry.getState().getRoll('roll-b').framesMinted, 1)
})

test('stale Worker totals and truncated history cannot decrease the known count', async () => {
  const h = await harness([roll({ framesMinted: 18 })])
  h.recordMintSuccess(frame(19))
  h.registry.getState().setFramesMinted('roll-a', 10)
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 18)
  h.registry.getState().setFramesMinted('roll-a', 19)
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 19)
})

test('hydration repairs and persists historical 25/24 and 13/12 records without changing lifecycle', async () => {
  const h = await harness([
    roll({ framesMinted: 25, status: 'closed' }),
    roll({ collectionAddress: 'roll-b', size: 12, framesMinted: 13 }),
  ])
  const saved = JSON.parse(h.files.get('documents/roll-registry.json'))
  assert.equal(saved[0].framesMinted, 24)
  assert.equal(saved[0].status, 'closed')
  assert.equal(saved[1].framesMinted, 12)
  assert.equal(saved[1].status, 'open')
  const restarted = await harness(saved)
  assert.deepEqual(restarted.registry.getState().rolls, h.registry.getState().rolls)
})

test('registry writes keep finite integer counts inside each roll size', async () => {
  const h = await harness()
  h.registry.getState().addRoll(roll({ size: 12, framesMinted: -1 }))
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 0)
  h.registry.getState().setFramesMinted('roll-a', 3.9)
  for (const value of [NaN, Infinity, -2]) h.registry.getState().setFramesMinted('roll-a', value)
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 3)
  h.registry.getState().setFramesMinted('roll-a', 25)
  assert.equal(h.registry.getState().getRoll('roll-a').framesMinted, 12)
})

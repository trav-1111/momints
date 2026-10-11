const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')
const { planRollFrameNumbers } = sourceLoader()('src/services/rollFrameNumbers.ts')
const { vaultHarness } = require('./helpers/roll-vault-memory.cjs')
const artifact = (id) => ({
  mime: 'image/jpeg',
  byteLength: 100,
  width: 20,
  height: 15,
  imageHash: id.repeat(64),
  renderer: 'native-egl-v2',
  recipeSha256: 'a'.repeat(64),
})
const local = [1, 2, 2, 4, 5, 5].map((frameNumber, i) => ({
  id: String(i + 1),
  frameNumber,
  artifact: artifact(String(i + 1)),
}))
const remote = (indices, status = 'MINTED') =>
  indices.map((i) => ({ frameIndex: local[i].frameNumber, status, ...local[i].artifact }))

test('repair fills frames 3 and 6 while preserving the successful frames 2 and 5', () => {
  const result = planRollFrameNumbers(local, remote([0, 1, 3, 4]), 12, new Set(['1', '2', '4', '5']))
  assert.deepEqual(
    local.map((frame) => result.get(frame.id)),
    [1, 2, 3, 4, 5, 6],
  )
})

test('an uploaded or mint-pending frame reserves its original bytes and slot too', () => {
  const result = planRollFrameNumbers(local, remote([0, 2, 3, 5], 'MINT_PENDING'), 12, new Set())
  assert.equal(result.get('3'), 2)
  assert.equal(result.get('6'), 5)
  assert.equal(result.get('2'), 3)
  assert.equal(result.get('5'), 6)
})

test('repair refuses missing receipts, ambiguous originals and unconfirmed local successes', () => {
  assert.throws(
    () => planRollFrameNumbers(local, [{ ...remote([1])[0], imageHash: null }], 12, new Set()),
    /matched uniquely/,
  )
  const ambiguous = local.map((f) => (f.id === '3' ? { ...f, artifact: local[1].artifact } : f))
  assert.throws(() => planRollFrameNumbers(ambiguous, remote([1]), 12, new Set()), /matched uniquely/)
  assert.throws(() => planRollFrameNumbers(local, remote([1]), 12, new Set(['5'])), /not confirmed/)
})

test('repair never exceeds the purchased size or overwrites another reserved frame', () => {
  assert.throws(() => planRollFrameNumbers(local, [], 5, new Set()), /invalid frame numbering/)
  assert.throws(() => planRollFrameNumbers(local, [...remote([1]), ...remote([1])], 12, new Set()), /inconsistent/)
  const numbered = local.map((f, i) => ({ ...f, frameNumber: i + 1 }))
  assert.deepEqual([...planRollFrameNumbers(numbered, [], 12, new Set()).values()], [1, 2, 3, 4, 5, 6])
})

test('vault repair persists new numbers without changing encrypted images and survives reload', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2),
    second = await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  const encryptedBefore = [...h.files].filter(([path]) => path.endsWith('.frame'))
  const numbers = await h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set(['1']))
  assert.equal(numbers.get('1'), 2)
  assert.equal(numbers.get('2'), 1)
  const restored = await h.vault.restoreRollVault(h.roll.id)
  assert.deepEqual(new Map(restored.photos.map((p) => [p.id, p.rollFrameNumber])), numbers)
  assert.deepEqual(
    [...h.files].filter(([path]) => path.endsWith('.frame')),
    encryptedBefore,
  )
  await h.vault.withDecryptedRollFrame(second.uri, async (_path, receipt, reference) => {
    assert.equal(reference.frameNumber, 1)
    assert.equal(receipt.imageHash, second.artifact.imageHash)
  })
  // Already committed numbering needs no network, including after a restart.
  h.detail = null
  assert.deepEqual(await h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set(['1'])), numbers)
})

test('failed repair preserves the previous encrypted manifest and refuses changed server reservations', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2)
  await h.add('2', 2)
  const original = new Map(h.files)
  h.detail = (read) => h.server(read === 1 ? [h.remote(first, 2)] : [h.remote(first, 3)])
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()), /server roll changed/)
  assert.deepEqual(h.files, original)
  h.detail = h.server([h.remote(first, 2)])
  h.failManifestWrite = true
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()), /disk full/)
  assert.deepEqual(h.files, original)
  h.inFlight = true
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()), /uploads to finish/)
})

test('metadata updates cannot overwrite a repaired manifest generation', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2)
  await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  await Promise.all([
    h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()),
    h.vault.updateStoredRollFrameMeta(h.roll.id, '2', { location: 'test location' }),
  ])
  const restored = await h.vault.restoreRollVault(h.roll.id)
  assert.equal(restored.photos.find((p) => p.id === '2').rollFrameNumber, 1)
  assert.equal(restored.photos.find((p) => p.id === '2').meta.location, 'test location')
})

test('repair coordinator updates queue and photo numbering from the durable vault without rewriting minted history', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2),
    second = await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  const { useSessionStore, sessionHydrated } = h.load('src/store/session.ts')
  const { usePhotoStore } = h.load('src/store/photos.ts')
  const { useMintQueue, historyHydrated } = h.load('src/store/mintQueue.ts')
  await Promise.all([sessionHydrated, historyHydrated])
  useSessionStore.setState({ activeRoll: h.roll })
  usePhotoStore.setState({ photos: [{ ...first, action: 'minted' }, second] })
  const mintedHistory = [{ id: first.id, mintAddress: 'existing-asset', rollContext: { frameNumber: 2 } }]
  useMintQueue.setState({
    mintHistory: mintedHistory,
    queue: [
      {
        photoId: second.id,
        photoUri: second.uri,
        title: 'old Frame 2',
        rollContext: { rollId: h.roll.id, collectionAddress: h.roll.collectionAddress, frameNumber: 2 },
      },
    ],
  })
  const { repairActiveRollFrameNumbers } = h.load('src/services/repairRollFrameNumbers.ts')
  await Promise.all([repairActiveRollFrameNumbers('owner'), repairActiveRollFrameNumbers('owner')])
  assert.equal(h.reads, 2, 'concurrent repair taps share the same operation')
  const queued = useMintQueue.getState().queue[0]
  assert.equal(queued.rollContext.frameNumber, 1)
  assert.equal(queued.title, '2026-10-11.01 — Frame 1')
  assert.equal(usePhotoStore.getState().photos.find((p) => p.id === second.id).rollFrameNumber, 1)
  assert.deepEqual(useMintQueue.getState().mintHistory, mintedHistory)
  await h.vault.withDecryptedRollFrame(queued.photoUri, async (_path, receipt, reference) => {
    assert.equal(reference.frameNumber, queued.rollContext.frameNumber)
    assert.equal(receipt.imageHash, second.artifact.imageHash)
  })
})

test('repair refuses another wallet and corrupted encrypted originals without changing the manifest', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2)
  await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'other-wallet', new Set()), /original wallet/)
  const path = [...h.files.keys()].find((key) => key.endsWith('/2.frame'))
  h.files.get(path)[50] ^= 1
  const original = new Map(h.files)
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()))
  assert.deepEqual(h.files, original)
})

test('restart after vault commit but before queue update recovers the same numbering offline', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2),
    second = await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  const numbers = await h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set(['1']))
  // Simulate the previous screen/queue still holding old numbers after interruption.
  const { useSessionStore, sessionHydrated } = h.load('src/store/session.ts')
  const { usePhotoStore } = h.load('src/store/photos.ts')
  const { useMintQueue, historyHydrated } = h.load('src/store/mintQueue.ts')
  await Promise.all([sessionHydrated, historyHydrated])
  useSessionStore.setState({ activeRoll: h.roll })
  usePhotoStore.setState({ photos: [first, second] })
  useMintQueue.setState({ queue: [{ photoId: second.id, rollContext: { rollId: h.roll.id, frameNumber: 2 } }] })
  h.detail = null
  await h.load('src/services/repairRollFrameNumbers.ts').repairActiveRollFrameNumbers('owner')
  assert.equal(useMintQueue.getState().queue[0].rollContext.frameNumber, numbers.get(second.id))
  assert.equal(h.reads, 2)
})

test('a torn numbering-manifest write leaves the previous generation recoverable', async () => {
  const h = vaultHarness()
  const first = await h.add('1', 2)
  await h.add('2', 2)
  h.detail = h.server([h.remote(first, 2)])
  h.failManifestWrite = 'torn'
  await assert.rejects(h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set()), /could not be verified/)
  const restored = await h.vault.restoreRollVault(h.roll.id)
  assert.deepEqual(
    restored.photos.map((p) => p.rollFrameNumber),
    [2, 2],
  )
  h.failManifestWrite = false
  const numbers = await h.vault.repairRollVaultFrameNumbers(h.roll, 'owner', new Set())
  assert.equal(numbers.get('2'), 1)
})

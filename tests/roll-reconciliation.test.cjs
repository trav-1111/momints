'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { readyWorkerFrames, reconciledFrameCount } = require('../src/services/rollReconciliationPolicy.cjs')

function frame(frameIndex, overrides = {}) {
  return {
    frameIndex,
    status: 'MINTED',
    assetAddress: `asset-${frameIndex}`,
    imageUri: `https://arweave.net/image-${frameIndex}`,
    signature: `signature-${frameIndex}`,
    ...overrides,
  }
}

test('checkpointed Worker frames map to their stable local photo ids', () => {
  const candidates = readyWorkerFrames(['photo-1', 'photo-2', 'photo-3'], [], [frame(3), frame(1), frame(2)])
  assert.deepEqual(
    candidates.map((candidate) => [candidate.photoId, candidate.frame.frameIndex]),
    [
      ['photo-3', 3],
      ['photo-1', 1],
      ['photo-2', 2],
    ],
  )
})

test('reconciliation skips incomplete, malformed and already-recorded frames', () => {
  const history = [{ id: 'photo-1', mintAddress: 'asset-1' }]
  const candidates = readyWorkerFrames(['photo-1', 'photo-2', 'photo-3'], history, [
    frame(1),
    frame(2, { status: 'MINT_PENDING' }),
    frame(3, { signature: null }),
    frame(4),
  ])
  assert.deepEqual(candidates, [])
})

test('roll completion counts unique frames from only the expected collection', () => {
  const history = [
    { id: 'photo-1', mintAddress: 'a', rollContext: { collectionAddress: 'roll', frameNumber: 1 } },
    { id: 'photo-1', mintAddress: 'a2', rollContext: { collectionAddress: 'roll', frameNumber: 1 } },
    { id: 'photo-2', mintAddress: 'b', rollContext: { collectionAddress: 'other', frameNumber: 2 } },
    { id: 'foreign', mintAddress: 'c', rollContext: { collectionAddress: 'roll', frameNumber: 2 } },
    { id: 'photo-2', mintAddress: 'd', rollContext: { collectionAddress: 'roll', frameNumber: 2 } },
  ]
  assert.equal(reconciledFrameCount(history, 'roll', ['photo-1', 'photo-2']), 2)
})

test('app polls for forty minutes and History exposes manual refresh', () => {
  const layout = readFileSync(join(__dirname, '../src/app/_layout.tsx'), 'utf8')
  const history = readFileSync(join(__dirname, '../src/app/past-mints.tsx'), 'utf8')
  const progress = readFileSync(join(__dirname, '../src/app/mint/progress.tsx'), 'utf8')
  const service = readFileSync(join(__dirname, '../src/services/rollReconciliation.ts'), 'utf8')
  assert.match(service, /ROLL_RECONCILIATION_WINDOW_MS = 40 \* 60_000/)
  assert.match(layout, /reconcileActiveRollFrames\(wallet\)/)
  assert.match(layout, /AppState\.addEventListener\('change'/)
  assert.match(history, /onRefresh=\{handleRefresh\}/)
  assert.match(history, /drainPendingFinalizes\(\)/)
  assert.doesNotMatch(service, /mintWorkerFrame/)
  assert.match(service, /verifyAndDiscardCompletedRollVault/)
  assert.match(progress, /if \(item\.status === 'success'\) return \[\]/)
})

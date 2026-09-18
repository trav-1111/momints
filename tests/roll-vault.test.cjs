'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { mayPurgeVerifiedRoll } = require('../src/services/rollVaultPolicy.cjs')

const completeEvidence = {
  expectedFrames: 12,
  verifiedFrames: 12,
  workerComplete: true,
  finalizedAssets: true,
  ownerAndCollectionMatch: true,
  metadataAndHashesMatch: true,
}

test('vault purge requires the complete independent evidence set', () => {
  assert.equal(mayPurgeVerifiedRoll(completeEvidence), true)
  for (const key of ['workerComplete', 'finalizedAssets', 'ownerAndCollectionMatch', 'metadataAndHashesMatch']) {
    assert.equal(mayPurgeVerifiedRoll({ ...completeEvidence, [key]: false }), false, key)
  }
  assert.equal(mayPurgeVerifiedRoll({ ...completeEvidence, verifiedFrames: 11 }), false)
  assert.equal(mayPurgeVerifiedRoll({ ...completeEvidence, expectedFrames: 0, verifiedFrames: 0 }), false)
})

test('startup privacy sweep never targets the durable encrypted roll vault', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/imagePrivacy.ts'), 'utf8')
  assert.equal(source.includes('momints-roll-vaults'), false)
})

test('camera persists a roll frame before advancing its exposure counter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/camera.tsx'), 'utf8')
  const persist = source.indexOf('await persistRollFrame(storedPhoto')
  const advance = source.indexOf('addFrameToRoll(photoId)', persist)
  assert.ok(persist >= 0)
  assert.ok(advance > persist)
})

test('verification receipt is written before vault destruction', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/rollVault.ts'), 'utf8')
  const verifier = source.indexOf('export async function verifyAndDiscardCompletedRollVault')
  const receipt = source.indexOf('VERIFIED_RECEIPT.write(', verifier)
  const destroy = source.indexOf('await discardRollVault(activeRoll.id)', receipt)
  assert.ok(verifier >= 0)
  assert.ok(receipt > verifier)
  assert.ok(destroy > receipt)
})

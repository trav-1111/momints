'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { mayPurgeVerifiedRoll } = require('../src/services/rollVaultPolicy.cjs')
const {
  createRollVaultUri,
  parseRollVaultUri,
  isRollVaultUri,
  jpegDimensions,
} = require('../src/services/rollVaultFormat.cjs')

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

test('vault references are strict and contain no local filesystem path', () => {
  const uri = createRollVaultUri('roll_123', 'photo-456')
  assert.equal(uri, 'momints-roll-vault://roll_123/photo-456')
  assert.deepEqual(parseRollVaultUri(uri), { rollId: 'roll_123', photoId: 'photo-456' })
  assert.equal(isRollVaultUri(uri), true)
  assert.equal(isRollVaultUri('file:///data/user/0/app/photo.jpg'), false)
  assert.equal(parseRollVaultUri('momints-roll-vault://../photo'), null)
})

test('header-only JPEG parser returns stored dimensions and rejects truncation', () => {
  const jpeg = Buffer.alloc(21)
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x09, 0x90, 0x0c, 0xc0])
  assert.deepEqual(jpegDimensions(jpeg), { width: 3264, height: 2448 })
  assert.equal(jpegDimensions(jpeg.subarray(0, 10)), null)
  assert.equal(jpegDimensions(Buffer.from('not a jpeg')), null)
})

test('vault v2 deletes plaintext after manifest commit and restores metadata only', () => {
  const vault = fs.readFileSync(path.join(__dirname, '../src/services/rollVault.ts'), 'utf8')
  const persist = vault.indexOf('export async function persistRollFrame')
  const manifest = vault.indexOf('await writeManifest(', persist)
  const committed = vault.indexOf('manifestCommitted = true', manifest)
  const cleanup = vault.indexOf('deleteCapture(photo.uri)', committed)
  assert.ok(manifest > persist)
  assert.ok(committed > manifest)
  assert.ok(cleanup > committed)

  const restore = vault.slice(
    vault.indexOf('export async function restoreRollVault'),
    vault.indexOf('export async function withDecryptedRollFrame'),
  )
  assert.match(restore, /createRollVaultUri\(rollId, frame\.id\)/)
  assert.doesNotMatch(restore, /output\.write\(plaintext\)/)
})

test('roll upload plaintext is bounded by the awaited operation and finally cleanup', () => {
  const vault = fs.readFileSync(path.join(__dirname, '../src/services/rollVault.ts'), 'utf8')
  const jit = vault.slice(vault.indexOf('export async function withDecryptedRollFrame'))
  const write = jit.indexOf('output.write(plaintext)')
  const operation = jit.indexOf('return await operation(', write)
  const cleanup = jit.indexOf('deleteCapture(output.uri)', operation)
  assert.ok(write >= 0)
  assert.ok(operation > write)
  assert.ok(cleanup > operation)

  const mint = fs.readFileSync(path.join(__dirname, '../src/hooks/useMint.ts'), 'utf8')
  assert.match(mint, /withDecryptedRollFrame\(item\.photoUri/)
  assert.match(mint, /reference\.frameNumber !== frameNumber/)
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

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import bs58 from 'bs58'
import { readFile } from 'node:fs/promises'

const buildDir = await mkdtemp(path.resolve('node_modules/.roll-contract-test-'))
await build({
  entryPoints: [
    'src/rolls/auth.ts',
    'src/rolls/imageArtifact.ts',
    'src/rolls/frames.ts',
    'src/rolls/complete.ts',
    'src/quick/stage.ts',
  ],
  outdir: buildDir,
  outbase: 'src/rolls',
  entryNames: '[name]',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
})
const auth = await import(pathToFileURL(path.join(buildDir, 'auth.js')).href)
const artifacts = await import(pathToFileURL(path.join(buildDir, 'imageArtifact.js')).href)
const quickStage = await import(pathToFileURL(path.join(buildDir, 'stage.js')).href)
const frames = await import(pathToFileURL(path.join(buildDir, 'frames.js')).href)
const completion = await import(pathToFileURL(path.join(buildDir, 'complete.js')).href)
after(() => rm(buildDir, { recursive: true, force: true }))

const capability = 'a'.repeat(43)
const collection = '2'.repeat(32)

function jpeg(width, height, byteLength = 64) {
  const header = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
  ])
  if (byteLength < header.length + 3) throw new Error('fixture is too small')
  const bytes = new Uint8Array(byteLength)
  bytes.set(header)
  bytes[header.length] = 0x00
  bytes[byteLength - 2] = 0xff
  bytes[byteLength - 1] = 0xd9
  return bytes
}

async function rejectsStatus(operation, status) {
  await assert.rejects(operation, (error) => error?.status === status)
}

test('roll capabilities are hashed and authorize only the matching v2 roll', async () => {
  const authHash = await auth.hashRollCapability(capability)
  const roll = { protocol_version: 2, auth_hash: authHash }
  const db = { getRoll: async (address) => (address === collection ? roll : null) }
  const request = new Request('https://example.test', { headers: { Authorization: `Roll ${capability}` } })
  assert.equal(await auth.authorizeRollRequest(db, request, collection), roll)

  await rejectsStatus(() => auth.authorizeRollRequest(db, new Request('https://example.test'), collection), 401)
  await rejectsStatus(
    () =>
      auth.authorizeRollRequest(
        db,
        new Request('https://example.test', { headers: { Authorization: `Roll ${'b'.repeat(43)}` } }),
        collection,
      ),
    403,
  )
})

test('pre-contract rolls never silently receive mutation authorization', async () => {
  const db = { getRoll: async () => ({ protocol_version: 1, auth_hash: null }) }
  const request = new Request('https://example.test', { headers: { Authorization: `Roll ${capability}` } })
  await rejectsStatus(() => auth.authorizeRollRequest(db, request, collection), 428)
})

test('a fresh wallet signature can bind a capability to a pre-contract roll', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const wallet = bs58.encode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  const capabilityHash = await auth.hashRollCapability(capability)
  const issuedAt = new Date().toISOString()
  const message = auth.legacyClaimMessage({ collectionAddress: collection, wallet, capabilityHash, issuedAt })
  const signed = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(message)),
  )
  assert.equal(
    await auth.verifyLegacyClaimSignature({
      collectionAddress: collection,
      wallet,
      capabilityHash,
      issuedAt,
      signature: Buffer.from(signed).toString('base64'),
    }),
    true,
  )
  const otherKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const otherWallet = bs58.encode(new Uint8Array(await crypto.subtle.exportKey('raw', otherKeys.publicKey)))
  assert.equal(
    await auth.verifyLegacyClaimSignature({
      collectionAddress: collection,
      wallet: otherWallet,
      capabilityHash,
      issuedAt,
      signature: Buffer.from(signed).toString('base64'),
    }),
    false,
  )
  assert.equal(
    await auth.verifyLegacyClaimSignature({
      collectionAddress: '3'.repeat(32),
      wallet,
      capabilityHash,
      issuedAt,
      signature: Buffer.from(signed).toString('base64'),
    }),
    false,
  )
  await rejectsStatus(
    () =>
      auth.verifyLegacyClaimSignature({
        collectionAddress: collection,
        wallet,
        capabilityHash,
        issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        signature: Buffer.from(signed).toString('base64'),
      }),
    400,
  )
})

test('new-roll JPEG boundary, dimensions and SHA-256 are Worker-derived', async () => {
  assert.equal((await artifacts.verifyFrameArtifact(jpeg(4000, 3000, 2_900_000), 2)).byteLength, 2_900_000)
  const bytes = jpeg(4000, 3000, 3 * 1024 * 1024)
  const receipt = await artifacts.verifyFrameArtifact(bytes, 2)
  assert.deepEqual(
    { mime: receipt.mime, byteLength: receipt.byteLength, width: receipt.width, height: receipt.height },
    { mime: 'image/jpeg', byteLength: bytes.length, width: 4000, height: 3000 },
  )
  assert.match(receipt.imageHash, /^[0-9a-f]{64}$/)
  await rejectsStatus(() => artifacts.verifyFrameArtifact(jpeg(4000, 3000, bytes.length + 1), 2), 413)
})

test('frame authorization and validation precede body parsing and mutations', async () => {
  const indexSource = await readFile('src/index.ts', 'utf8')
  const handler = indexSource.slice(
    indexSource.indexOf('async function handleMintFrame'),
    indexSource.indexOf('async function handleGetRoll'),
  )
  assert.ok(handler.indexOf('authorizeRollRequest') < handler.indexOf('request.formData()'))
  assert.ok(handler.indexOf('verifyFrameArtifact') < handler.indexOf('mintFrame('))

  const frameSource = await readFile('src/rolls/frames.ts', 'utf8')
  const mint = frameSource.slice(
    frameSource.indexOf('export async function mintFrame'),
    frameSource.indexOf('async function mintFrameLocked'),
  )
  assert.ok(mint.indexOf('assertArtifactMatches') < mint.indexOf('claimFrameLock'))
})

test('roll completion is idempotent and every retry re-drives handoff recovery', async () => {
  const calls = []
  const deps = {
    closeRoll: async (address) => calls.push(`close:${address}`),
    retryHandoff: async (address) => calls.push(`handoff:${address}`),
  }
  const base = {
    collection_address: collection,
    name: 'QA Roll',
    size: 12,
    minted_count: 12,
  }
  const first = await completion.completeAuthorizedRoll(deps, { ...base, status: 'OPEN' })
  const retry = await completion.completeAuthorizedRoll(deps, { ...base, status: 'COMPLETE' })
  assert.deepEqual(first, {
    collectionAddress: collection,
    name: 'QA Roll',
    size: 12,
    mintedCount: 12,
    status: 'COMPLETE',
    alreadyComplete: false,
  })
  assert.equal(retry.alreadyComplete, true)
  assert.deepEqual(calls, [`close:${collection}`, `handoff:${collection}`, `handoff:${collection}`])
})

test('legacy byte allowance is bounded and does not weaken geometry checks', async () => {
  assert.equal((await artifacts.verifyFrameArtifact(jpeg(4000, 3000, 8 * 1024 * 1024), 1)).byteLength, 8 * 1024 * 1024)
  await rejectsStatus(() => artifacts.verifyFrameArtifact(jpeg(4000, 3000, 8 * 1024 * 1024 + 1), 1), 413)
  await rejectsStatus(() => artifacts.verifyFrameArtifact(jpeg(4001, 2999), 1), 413)
})

test('malformed, truncated and MIME-spoofed content is rejected as bytes', async () => {
  const truncated = jpeg(1024, 768)
  truncated[truncated.length - 1] = 0
  await rejectsStatus(() => artifacts.verifyFrameArtifact(truncated, 2), 400)
  await rejectsStatus(() => artifacts.verifyFrameArtifact(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 2), 400)

  const noScan = jpeg(1024, 768)
  noScan[21] = 0xe1 // replace SOS with APP1; no complete image scan remains
  await rejectsStatus(() => artifacts.verifyFrameArtifact(noScan, 2), 400)
})

test('quick staging persists the Worker receipt and replaces spoofed artifact traits', async () => {
  const bytes = jpeg(1200, 900, 100_000)
  const artifact = await artifacts.verifyFrameArtifact(bytes, 2)
  let inserted
  const db = {
    countQuickStagesSince: async () => 0,
    insertQuickMint: async (row) => {
      inserted = row
    },
  }
  const bucket = { put: async () => undefined, delete: async () => undefined }
  const feeCache = { get: async () => ({ quickFeeLamports: 123 }) }
  const result = await quickStage.stageQuickMint(
    {
      db,
      bucket,
      placeholderUri: 'https://arweave.net/placeholder',
      treasury: '3'.repeat(32),
      workerPubkey: '4'.repeat(32),
      feeCache,
    },
    {
      wallet: '5'.repeat(32),
      imageBytes: bytes,
      mime: artifact.mime,
      artifact,
      metadata: {
        name: 'Receipt test',
        attributes: [{ trait_type: 'image_sha256', value: 'client-spoof' }],
      },
    },
  )
  assert.equal(result.imageHash, artifact.imageHash)
  assert.equal(inserted.imageHash, artifact.imageHash)
  assert.equal(inserted.byteLength, artifact.byteLength)
  const metadata = JSON.parse(inserted.metadataJson)
  assert.equal(metadata.attributes.filter((item) => item.trait_type === 'image_sha256').length, 1)
  assert.equal(metadata.attributes.find((item) => item.trait_type === 'image_sha256').value, artifact.imageHash)
})

test('an idempotent minted-frame retry is D1-only and byte-bound', async () => {
  const artifact = await artifacts.verifyFrameArtifact(jpeg(1200, 900, 100_000), 2)
  const roll = {
    collection_address: collection,
    wallet: '5'.repeat(32),
    name: '2026-09-29.01',
    size: 12,
    status: 'OPEN',
    minted_count: 1,
  }
  const frame = {
    frame_index: 1,
    status: 'MINTED',
    asset_address: '6'.repeat(32),
    image_uri: 'https://arweave.net/image',
    metadata_uri: 'https://arweave.net/metadata',
    mint_signature: 'signature',
    mime: artifact.mime,
    byte_length: artifact.byteLength,
    width: artifact.width,
    height: artifact.height,
    image_hash: artifact.imageHash,
  }
  let locks = 0
  let seams = 0
  const db = {
    getRoll: async () => roll,
    getFrame: async () => frame,
    claimFrameLock: async () => {
      locks++
      return true
    },
    releaseFrameLock: async () => undefined,
  }
  const request = {
    collectionAddress: collection,
    frameIndex: 1,
    imageBytes: jpeg(1200, 900, 100_000),
    artifact,
    mime: artifact.mime,
  }
  const result = await frames.mintFrame(
    {
      db,
      rpcUrl: 'unused',
      getUmi: async () => assert.fail('Umi must not be constructed'),
      getSeams: async () => {
        seams++
        assert.fail('Storage must not be touched')
      },
    },
    request,
  )
  assert.equal(result.alreadyMinted, true)
  assert.equal(locks, 1)
  assert.equal(seams, 0)

  await rejectsStatus(
    () =>
      frames.mintFrame(
        { db, rpcUrl: 'unused', getUmi: async () => assert.fail(), getSeams: async () => assert.fail() },
        { ...request, artifact: { ...artifact, imageHash: '0'.repeat(64) } },
      ),
    409,
  )
  assert.equal(locks, 1, 'mismatched retry must be rejected before the D1 lock mutation')
})

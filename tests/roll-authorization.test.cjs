'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

const COLLECTION = '9ybS1vSt3EkAQs8RTUXHqubusumc1ZMDeVM9oEsk2zB1'
const WALLET = '4Nd1mBQtrMJVYVfKf2PJy9NZNLdEOPO63ftK5GZPPvYX'

function createHarness() {
  const secureStore = new Map()
  let requests = []
  let signCalls = 0

  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (global.fetchError) throw global.fetchError
    return new Response(
      JSON.stringify({ collectionAddress: COLLECTION, protocolVersion: 1, alreadyAuthorized: false }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  const crypto = require('node:crypto')
  const load = sourceLoader({
    'react-native-quick-crypto': crypto,
    'expo-secure-store': {
      getItemAsync: async (key) => secureStore.get(key) ?? null,
      setItemAsync: async (key, val) => {
        secureStore.set(key, val)
      },
      deleteItemAsync: async (key) => {
        secureStore.delete(key)
      },
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    },
    'src/config/rollApi.ts': {
      ROLL_API_BASE: 'https://api.momints.xyz',
    },
  })

  const rollApi = load('src/services/rollApi.ts')
  return { rollApi, secureStore, getRequests: () => requests, getSignCalls: () => signCalls }
}

test('extractSignatureBytes extracts 64-byte signature from standard and MWA payloads', () => {
  const { rollApi } = createHarness()
  const rawSig = new Uint8Array(64).fill(0xab)

  // Exact 64-byte payload
  const exact = rollApi.extractSignatureBytes(rawSig)
  assert.equal(exact.length, 64)
  assert.deepEqual(exact, rawSig)

  // MWA concatenated payload: message (30 bytes) + signature (64 bytes)
  const messageBytes = new TextEncoder().encode('Momints roll authorization message')
  const mwaPayload = new Uint8Array(messageBytes.length + 64)
  mwaPayload.set(messageBytes, 0)
  mwaPayload.set(rawSig, messageBytes.length)

  const extracted = rollApi.extractSignatureBytes(mwaPayload)
  assert.equal(extracted.length, 64)
  assert.deepEqual(extracted, rawSig)

  // Malformed payload (< 64 bytes)
  assert.throws(() => rollApi.extractSignatureBytes(new Uint8Array(32)), /expected at least 64 bytes/)
})

test('ensureWorkerRollAuthorization extracts signature and persists capability only after successful Worker response', async () => {
  const h = createHarness()
  global.fetchError = null

  const dummyMessage = 'Test message'
  const dummySignature = new Uint8Array(64).fill(0x42)
  // Simulate MWA returning message + signature (length > 64)
  const mwaPayload = new Uint8Array(dummyMessage.length + 64)
  mwaPayload.set(new TextEncoder().encode(dummyMessage), 0)
  mwaPayload.set(dummySignature, dummyMessage.length)

  let signCalled = false
  const signMessage = async (msg) => {
    signCalled = true
    return mwaPayload
  }

  await h.rollApi.ensureWorkerRollAuthorization(COLLECTION, WALLET, signMessage)

  assert.equal(signCalled, true)
  const reqs = h.getRequests()
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].url, `https://api.momints.xyz/rolls/${COLLECTION}/authorize`)

  const body = JSON.parse(reqs[0].options.body)
  assert.equal(body.wallet, WALLET)
  // Verify that the sent signature is base64 of exactly 64 bytes, NOT the full MWA payload
  const decodedSignature = Buffer.from(body.signature, 'base64')
  assert.equal(decodedSignature.length, 64)
  assert.deepEqual(Uint8Array.from(decodedSignature), dummySignature)

  // Verify capability is now stored and staging key is cleared
  assert.equal(h.secureStore.size, 1)
  assert.ok(h.secureStore.has(`roll-capability-${COLLECTION}`))
  assert.equal(h.secureStore.has(`recovery-roll-capability-${COLLECTION}`), false)
})

test('ensureWorkerRollAuthorization stages capability so retries reuse the same capability without 409 conflict', async () => {
  const h = createHarness()
  global.fetchError = new Error('Network timeout')

  const dummySig = new Uint8Array(64).fill(0x11)
  const signMessage = async () => dummySig

  await assert.rejects(
    () => h.rollApi.ensureWorkerRollAuthorization(COLLECTION, WALLET, signMessage),
    /Network timeout/,
  )

  // Verify roll-capability was NOT saved, but recovery staging key IS preserved
  assert.equal(h.secureStore.has(`roll-capability-${COLLECTION}`), false)
  assert.ok(h.secureStore.has(`recovery-roll-capability-${COLLECTION}`))
  const stagedCapability = h.secureStore.get(`recovery-roll-capability-${COLLECTION}`)

  // Capture capability sent in the first attempt
  const firstReqBody = JSON.parse(h.getRequests()[0].options.body)
  assert.equal(firstReqBody.rollCapability, stagedCapability)

  // Retry succeeds when network recovers — must reuse the EXACT same capability
  global.fetchError = null
  await h.rollApi.ensureWorkerRollAuthorization(COLLECTION, WALLET, signMessage)

  const reqs = h.getRequests()
  assert.equal(reqs.length, 2)
  const retryReqBody = JSON.parse(reqs[1].options.body)
  assert.equal(retryReqBody.rollCapability, stagedCapability) // Reused! Prevents 409

  // After success, capability is committed and staging key is cleared
  assert.equal(h.secureStore.size, 1)
  assert.equal(h.secureStore.get(`roll-capability-${COLLECTION}`), stagedCapability)
  assert.equal(h.secureStore.has(`recovery-roll-capability-${COLLECTION}`), false)
})

test('ensureWorkerRollAuthorization does not skip authorization if an unconfirmed capability exists locally', async () => {
  const h = createHarness()
  global.fetchError = null

  // Simulate an old prematurely saved capability from the previous buggy version
  const oldCapability = require('node:crypto').randomBytes(32).toString('base64url')
  h.secureStore.set(`roll-capability-${COLLECTION}`, oldCapability)

  let signCalls = 0
  const signMessage = async () => {
    signCalls++
    return new Uint8Array(64).fill(0x33)
  }

  // Must NOT early return with signs=0, requests=0; must authorize with Worker using the capability!
  await h.rollApi.ensureWorkerRollAuthorization(COLLECTION, WALLET, signMessage)

  assert.equal(signCalls, 1)
  const reqs = h.getRequests()
  assert.equal(reqs.length, 1)
  const body = JSON.parse(reqs[0].options.body)
  assert.equal(body.rollCapability, oldCapability)
  assert.equal(h.secureStore.get(`roll-capability-${COLLECTION}`), oldCapability)
})

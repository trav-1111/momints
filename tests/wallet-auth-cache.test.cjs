'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

const DUMMY_ADDRESS = '4Nd1mBQtrMJVYVfKf2PJy9NZNLdEOPO63ftK5GZPPvYX'
const DUMMY_AUTH = {
  accounts: [
    {
      address: DUMMY_ADDRESS,
      addressBase64: 'TkQxbUJRdHJNSlZZVmZLZjJQSnk5TlpOTGRFT1BPNjNmdEs1R1pQUHZSWD==',
    },
  ],
  authToken: 'secret-mwa-auth-token-12345',
  selectedAccount: {
    address: DUMMY_ADDRESS,
    addressBase64: 'TkQxbUJRdHJNSlZZVmZLZjJQSnk5TlpOTGRFT1BPNjNmdEs1R1pQUHZSWD==',
  },
}

function createHarness(options = {}) {
  const secureStore = new Map()
  const asyncStorage = new Map(Object.entries(options.initialAsyncStorage || {}))

  const load = sourceLoader({
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
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => asyncStorage.get(key) ?? null,
      setItem: async (key, val) => {
        asyncStorage.set(key, val)
      },
      removeItem: async (key) => {
        asyncStorage.delete(key)
      },
    },
    '@solana/kit': {
      address: (val) => String(val),
    },
  })

  const { createSecureWalletAuthCache } = load('src/services/walletAuthCache.ts')
  const cache = createSecureWalletAuthCache()
  return { cache, secureStore, asyncStorage }
}

test('walletAuthCache stores and retrieves auth data from encrypted SecureStore', async () => {
  const { cache, secureStore } = createHarness()

  assert.equal(await cache.get(), undefined)

  await cache.set(DUMMY_AUTH)
  assert.equal(secureStore.size, 1)
  assert.ok(secureStore.has('mwa-wallet-authorization'))

  const retrieved = await cache.get()
  assert.deepEqual(retrieved, DUMMY_AUTH)

  await cache.clear()
  assert.equal(await cache.get(), undefined)
  assert.equal(secureStore.size, 0)
})

test('walletAuthCache migrates legacy unencrypted AsyncStorage tokens to SecureStore', async () => {
  const { cache, secureStore, asyncStorage } = createHarness({
    initialAsyncStorage: {
      'authorization-cache': JSON.stringify(DUMMY_AUTH),
    },
  })

  // Prior to get, SecureStore has nothing, AsyncStorage has unencrypted token
  assert.equal(secureStore.size, 0)
  assert.equal(asyncStorage.size, 1)

  // First get() migrates into SecureStore and purges AsyncStorage
  const retrieved = await cache.get()
  assert.deepEqual(retrieved, DUMMY_AUTH)

  assert.equal(secureStore.size, 1)
  assert.ok(secureStore.has('mwa-wallet-authorization'))
  assert.equal(asyncStorage.has('authorization-cache'), false) // Purged from unencrypted storage
})

test('walletAuthCache clears both SecureStore and any legacy AsyncStorage keys', async () => {
  const { cache, secureStore, asyncStorage } = createHarness({
    initialAsyncStorage: {
      'authorization-cache': JSON.stringify(DUMMY_AUTH),
    },
  })

  await cache.clear()
  assert.equal(secureStore.size, 0)
  assert.equal(asyncStorage.size, 0)
})

test('walletAuthCache preserves legacy AsyncStorage token if SecureStore write fails', async () => {
  let shouldFailSecureWrite = true
  const secureStore = new Map()
  const asyncStorage = new Map([['authorization-cache', JSON.stringify(DUMMY_AUTH)]])

  const load = sourceLoader({
    'expo-secure-store': {
      getItemAsync: async (key) => secureStore.get(key) ?? null,
      setItemAsync: async (key, val) => {
        if (shouldFailSecureWrite) throw new Error('SecureStore disk error')
        secureStore.set(key, val)
      },
      deleteItemAsync: async (key) => {
        secureStore.delete(key)
      },
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => asyncStorage.get(key) ?? null,
      setItem: async (key, val) => {
        asyncStorage.set(key, val)
      },
      removeItem: async (key) => {
        asyncStorage.delete(key)
      },
    },
    '@solana/kit': {
      address: (val) => String(val),
    },
  })

  const { createSecureWalletAuthCache } = load('src/services/walletAuthCache.ts')
  const cache = createSecureWalletAuthCache()

  // First get() attempts migration, but SecureStore write fails
  const result = await cache.get()
  assert.equal(result, undefined)
  // Legacy copy MUST still exist in AsyncStorage!
  assert.equal(asyncStorage.has('authorization-cache'), true)
  assert.equal(secureStore.has('mwa-wallet-authorization'), false)

  // When SecureStore recovers, subsequent get() succeeds and safely purges AsyncStorage
  shouldFailSecureWrite = false
  const recovered = await cache.get()
  assert.deepEqual(recovered, DUMMY_AUTH)
  assert.equal(secureStore.has('mwa-wallet-authorization'), true)
  assert.equal(asyncStorage.has('authorization-cache'), false)
})

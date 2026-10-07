import * as SecureStore from 'expo-secure-store'
import { address } from '@solana/kit'
import type { Cache, WalletAuthorization } from '@wallet-ui/react-native-kit'

const KEYCHAIN_SERVICE = 'app.momints.wallet.auth.v1'
const STORAGE_KEY = 'mwa-wallet-authorization'
const LEGACY_ASYNC_STORAGE_KEY = 'authorization-cache'

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export function cacheReviver(key: string, value: unknown): unknown {
  if (key === 'address' && typeof value === 'string') {
    return address(value)
  }
  return value
}

async function tryGetAndPurgeLegacyAsyncStorage(): Promise<string | null> {
  try {
    // Dynamic best-effort resolution of nested peer dep
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage')
    const AsyncStorage = mod?.default ?? mod
    if (AsyncStorage?.getItem) {
      const legacy = await AsyncStorage.getItem(LEGACY_ASYNC_STORAGE_KEY)
      if (legacy) {
        await AsyncStorage.removeItem(LEGACY_ASYNC_STORAGE_KEY)
        return legacy
      }
    }
  } catch {
    // Not available or cannot access — safe fallback
  }
  return null
}

async function tryPurgeLegacyAsyncStorage(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage')
    const AsyncStorage = mod?.default ?? mod
    if (AsyncStorage?.removeItem) {
      await AsyncStorage.removeItem(LEGACY_ASYNC_STORAGE_KEY)
    }
  } catch {}
}

export function createSecureWalletAuthCache(
  storageKey = STORAGE_KEY,
  options = secureStoreOptions,
): Cache<WalletAuthorization | undefined> {
  return {
    async clear(): Promise<void> {
      try {
        await SecureStore.deleteItemAsync(storageKey, { keychainService: options.keychainService })
      } catch (err) {
        console.warn('[walletAuthCache] Failed to clear SecureStore:', err)
      }
      await tryPurgeLegacyAsyncStorage()
    },

    async get(): Promise<WalletAuthorization | undefined> {
      try {
        const raw = await SecureStore.getItemAsync(storageKey, options)
        if (raw) {
          await tryPurgeLegacyAsyncStorage()
          return JSON.parse(raw, cacheReviver) as WalletAuthorization
        }
      } catch (err) {
        console.warn('[walletAuthCache] Failed to read from SecureStore:', err)
      }

      // Migration: check for legacy unencrypted token in AsyncStorage
      const legacy = await tryGetAndPurgeLegacyAsyncStorage()
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy, cacheReviver) as WalletAuthorization
          if (parsed && typeof parsed === 'object') {
            await SecureStore.setItemAsync(storageKey, JSON.stringify(parsed), options)
            return parsed
          }
        } catch (err) {
          console.warn('[walletAuthCache] Failed to parse legacy auth token:', err)
        }
      }

      return undefined
    },

    async set(value: WalletAuthorization | undefined): Promise<void> {
      if (!value) {
        await this.clear()
        return
      }
      try {
        await SecureStore.setItemAsync(storageKey, JSON.stringify(value), options)
        await tryPurgeLegacyAsyncStorage()
      } catch (err) {
        console.error('[walletAuthCache] Failed to persist secure auth token:', err)
      }
    },
  }
}

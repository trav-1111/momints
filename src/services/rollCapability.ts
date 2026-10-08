import * as SecureStore from 'expo-secure-store'
import { Buffer } from '@craftzdog/react-native-buffer'
import { createHash, randomBytes } from 'react-native-quick-crypto'

const KEYCHAIN_SERVICE = 'app.momints.roll-capabilities.v1'
const KEY_PREFIX = 'roll-capability-'
const PENDING_KEY_PREFIX = 'pending-roll-capability-'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const options: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

function keyForCollection(collectionAddress: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(collectionAddress)) {
    throw new Error('Cannot access a roll capability for an invalid collection address.')
  }
  return `${KEY_PREFIX}${collectionAddress}`
}

function keyForWallet(wallet: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    throw new Error('Cannot stage a roll capability for an invalid wallet address.')
  }
  return `${PENDING_KEY_PREFIX}${wallet}`
}

/** Create a 256-bit bearer capability. Only its SHA-256 hash is sent to D1. */
export function createRollCapability(): string {
  return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

export function assertRollCapability(capability: string): void {
  if (!TOKEN_PATTERN.test(capability)) {
    throw new Error('Roll capability must be a 256-bit base64url token.')
  }
}

export function hashRollCapability(capability: string): string {
  assertRollCapability(capability)
  return createHash('sha256').update(Buffer.from(capability, 'utf8')).digest().toString('hex')
}

export async function saveRollCapability(collectionAddress: string, capability: string): Promise<void> {
  assertRollCapability(capability)
  await SecureStore.setItemAsync(keyForCollection(collectionAddress), capability, options)
}

export async function getRollCapability(collectionAddress: string): Promise<string | null> {
  const capability = await SecureStore.getItemAsync(keyForCollection(collectionAddress), options)
  if (capability === null) return null
  assertRollCapability(capability)
  return capability
}

export async function deleteRollCapability(collectionAddress: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyForCollection(collectionAddress), { keychainService: KEYCHAIN_SERVICE })
}

/**
 * Persist before the paid create request. The one-open-roll invariant lets a
 * response lost after creation recover this token from wallet -> collection.
 */
export async function stageRollCapability(wallet: string, capability: string): Promise<void> {
  assertRollCapability(capability)
  await SecureStore.setItemAsync(keyForWallet(wallet), capability, options)
}

export async function bindStagedRollCapability(wallet: string, collectionAddress: string): Promise<boolean> {
  const pendingKey = keyForWallet(wallet)
  const capability = await SecureStore.getItemAsync(pendingKey, options)
  if (capability === null) return false
  await saveRollCapability(collectionAddress, capability)
  await SecureStore.deleteItemAsync(pendingKey, { keychainService: KEYCHAIN_SERVICE })
  return true
}

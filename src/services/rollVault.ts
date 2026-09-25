import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'react-native-quick-crypto'
import { Buffer } from '@craftzdog/react-native-buffer'
import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import type { Photo, CaptureMeta } from '../store/photos'
import type { ActiveRoll, AspectRatio } from '../store/session'
import { createMintUmi } from './mint'
import { getClusterRpc } from '../store/network'
import { getWorkerRoll } from './rollApi'
import { CAPTURE_TEMP_DIRECTORY, isPermanentArweaveUri, normalizeArweaveUri } from './imagePrivacy'
import { mayPurgeVerifiedRoll } from './rollVaultPolicy.cjs'

const VAULT_ROOT = new Directory(Paths.document, 'momints-roll-vaults')
const KEY_NAME = 'momints.roll-vault-key.v1'
const KEYCHAIN_SERVICE = 'momints.roll-vault'
const ALGORITHM = 'aes-256-gcm'
const MAGIC = Buffer.from('MOMRLL01', 'ascii')
const IV_BYTES = 12
const TAG_BYTES = 16
const MANIFEST_VERSION = 1
const VERIFIED_RECEIPT = new File(Paths.document, 'roll-vault-verified.json')

interface StoredRollFrame {
  id: string
  fileName: string
  sha256: string
  capturedAt: number
  frameNumber: number
  aspect?: AspectRatio
  meta?: CaptureMeta
}

interface RollVaultManifest {
  version: 1
  revision: number
  rollId: string
  rollName: string
  frames: StoredRollFrame[]
}

export interface RestoredRollVault {
  photos: Photo[]
  frameIds: string[]
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}.`)
}

function ensureDirectory(directory: Directory): void {
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true })
}

function directoryForRoll(rollId: string): Directory {
  assertSafeId(rollId, 'roll id')
  return new Directory(VAULT_ROOT, rollId)
}

async function vaultKey(): Promise<Buffer> {
  const options: SecureStore.SecureStoreOptions = {
    keychainService: KEYCHAIN_SERVICE,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }
  const existing = await SecureStore.getItemAsync(KEY_NAME, options)
  if (existing) {
    const decoded = Buffer.from(existing, 'base64')
    if (decoded.length !== 32) throw new Error('The roll vault key is invalid.')
    return decoded
  }
  const created = randomBytes(32)
  await SecureStore.setItemAsync(KEY_NAME, created.toString('base64'), options)
  return created
}

function seal(plaintext: Uint8Array, key: Buffer): Uint8Array {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, iv, tag, ciphertext])
}

function open(envelope: Uint8Array, key: Buffer): Uint8Array {
  const bytes = Buffer.from(envelope)
  const headerBytes = MAGIC.length + IV_BYTES + TAG_BYTES
  if (bytes.length <= headerBytes || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('The roll vault file is invalid.')
  }
  const ivStart = MAGIC.length
  const tagStart = ivStart + IV_BYTES
  const dataStart = tagStart + TAG_BYTES
  const decipher = createDecipheriv(ALGORITHM, key, bytes.subarray(ivStart, tagStart))
  decipher.setAuthTag(bytes.subarray(tagStart, dataStart))
  return Buffer.concat([decipher.update(bytes.subarray(dataStart)), decipher.final()])
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest().toString('hex')
}

function parseFrame(raw: unknown): StoredRollFrame | null {
  if (raw === null || typeof raw !== 'object') return null
  const frame = raw as Record<string, unknown>
  if (
    typeof frame.id !== 'string' ||
    typeof frame.fileName !== 'string' ||
    typeof frame.sha256 !== 'string' ||
    typeof frame.capturedAt !== 'number' ||
    typeof frame.frameNumber !== 'number'
  ) {
    return null
  }
  if (!/^[A-Za-z0-9_-]+\.frame$/.test(frame.fileName)) return null
  const aspect = frame.aspect
  const parsedAspect =
    aspect === '1:1' || aspect === '4:3' || aspect === '16:9' || aspect === 'full' ? aspect : undefined
  const meta =
    frame.meta && typeof frame.meta === 'object' && typeof (frame.meta as Record<string, unknown>).location === 'string'
      ? { location: String((frame.meta as Record<string, unknown>).location) }
      : undefined
  return {
    id: frame.id,
    fileName: frame.fileName,
    sha256: frame.sha256,
    capturedAt: frame.capturedAt,
    frameNumber: frame.frameNumber,
    aspect: parsedAspect,
    meta,
  }
}

function parseManifest(raw: unknown, rollId: string): RollVaultManifest | null {
  if (raw === null || typeof raw !== 'object') return null
  const manifest = raw as Record<string, unknown>
  if (
    manifest.version !== MANIFEST_VERSION ||
    manifest.rollId !== rollId ||
    typeof manifest.rollName !== 'string' ||
    typeof manifest.revision !== 'number' ||
    !Array.isArray(manifest.frames)
  ) {
    return null
  }
  const frames = manifest.frames.map(parseFrame)
  if (frames.some((frame) => frame === null)) return null
  return {
    version: MANIFEST_VERSION,
    revision: manifest.revision,
    rollId,
    rollName: manifest.rollName,
    frames: (frames as StoredRollFrame[]).sort((a, b) => a.frameNumber - b.frameNumber),
  }
}

async function readManifest(rollId: string, key: Buffer): Promise<RollVaultManifest | null> {
  const directory = directoryForRoll(rollId)
  if (!directory.exists) return null
  const manifests: RollVaultManifest[] = []
  for (const name of ['manifest-a.enc', 'manifest-b.enc']) {
    try {
      const file = new File(directory, name)
      if (!file.exists) continue
      const decoded = open(await file.bytes(), key)
      const parsed = parseManifest(JSON.parse(Buffer.from(decoded).toString('utf8')), rollId)
      if (parsed) manifests.push(parsed)
    } catch {
      // The other generation remains a valid recovery point after a torn write.
    }
  }
  return manifests.sort((a, b) => b.revision - a.revision)[0] ?? null
}

async function writeManifest(manifest: RollVaultManifest, key: Buffer): Promise<void> {
  const directory = directoryForRoll(manifest.rollId)
  ensureDirectory(VAULT_ROOT)
  ensureDirectory(directory)
  const target = new File(directory, manifest.revision % 2 === 0 ? 'manifest-a.enc' : 'manifest-b.enc')
  target.write(seal(Buffer.from(JSON.stringify(manifest), 'utf8'), key))
}

export async function persistRollFrame(photo: Photo, frameNumber: number): Promise<void> {
  if (!photo.rollId || !photo.rollName) throw new Error('A roll frame must have roll membership.')
  assertSafeId(photo.id, 'photo id')
  const key = await vaultKey()
  const directory = directoryForRoll(photo.rollId)
  ensureDirectory(VAULT_ROOT)
  ensureDirectory(directory)
  const source = new File(photo.uri)
  const bytes = await source.bytes()
  const fileName = `${photo.id}.frame`
  const encryptedFrame = new File(directory, fileName)
  encryptedFrame.write(seal(bytes, key))

  try {
    const current = await readManifest(photo.rollId, key)
    const frame: StoredRollFrame = {
      id: photo.id,
      fileName,
      sha256: hashBytes(bytes),
      capturedAt: photo.capturedAt,
      frameNumber,
      aspect: photo.aspect,
      meta: photo.meta,
    }
    const frames = [...(current?.frames.filter((item) => item.id !== photo.id) ?? []), frame].sort(
      (a, b) => a.frameNumber - b.frameNumber,
    )
    await writeManifest(
      {
        version: MANIFEST_VERSION,
        revision: (current?.revision ?? 0) + 1,
        rollId: photo.rollId,
        rollName: photo.rollName,
        frames,
      },
      key,
    )
  } catch (error) {
    try {
      if (encryptedFrame.exists) encryptedFrame.delete()
    } catch {}
    throw error
  }
}

export async function updateStoredRollFrameMeta(rollId: string, photoId: string, meta: CaptureMeta): Promise<void> {
  if (!directoryForRoll(rollId).exists) return
  const key = await vaultKey()
  const current = await readManifest(rollId, key)
  if (!current || !current.frames.some((frame) => frame.id === photoId)) return
  await writeManifest(
    {
      ...current,
      revision: current.revision + 1,
      frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, meta } : frame)),
    },
    key,
  )
}

export async function restoreRollVault(rollId: string): Promise<RestoredRollVault> {
  const key = await vaultKey()
  const manifest = await readManifest(rollId, key)
  if (!manifest) return { photos: [], frameIds: [] }
  ensureDirectory(CAPTURE_TEMP_DIRECTORY)
  const directory = directoryForRoll(rollId)
  const photos: Photo[] = []
  for (const frame of manifest.frames) {
    const encrypted = new File(directory, frame.fileName)
    if (!encrypted.exists) throw new Error(`Encrypted roll frame ${frame.frameNumber} is missing.`)
    const plaintext = open(await encrypted.bytes(), key)
    if (hashBytes(plaintext) !== frame.sha256)
      throw new Error(`Encrypted roll frame ${frame.frameNumber} failed integrity.`)
    const output = new File(CAPTURE_TEMP_DIRECTORY, `roll-${rollId}-${frame.id}.jpg`)
    output.write(plaintext)
    photos.push({
      id: frame.id,
      uri: output.uri,
      capturedAt: frame.capturedAt,
      action: 'mint',
      aspect: frame.aspect,
      meta: frame.meta,
      rollId,
      rollName: manifest.rollName,
      rollFrameNumber: frame.frameNumber,
    })
  }
  return { photos, frameIds: photos.map((photo) => photo.id) }
}

export async function discardRollVault(rollId: string): Promise<void> {
  const directory = directoryForRoll(rollId)
  if (directory.exists) directory.delete()
  await SecureStore.deleteItemAsync(KEY_NAME, { keychainService: KEYCHAIN_SERVICE })
}

interface VerifiedReceipt {
  rollId: string
  collectionAddress: string
  verifiedAt: string
}

function readVerifiedReceipt(): VerifiedReceipt | null {
  try {
    if (!VERIFIED_RECEIPT.exists) return null
    const raw: unknown = JSON.parse(VERIFIED_RECEIPT.textSync())
    if (raw === null || typeof raw !== 'object') return null
    const receipt = raw as Record<string, unknown>
    if (
      typeof receipt.rollId !== 'string' ||
      typeof receipt.collectionAddress !== 'string' ||
      typeof receipt.verifiedAt !== 'string'
    ) {
      return null
    }
    return receipt as unknown as VerifiedReceipt
  } catch {
    return null
  }
}

export async function consumeVerifiedRollReceipt(activeRoll: ActiveRoll): Promise<boolean> {
  const receipt = readVerifiedReceipt()
  if (!receipt || receipt.rollId !== activeRoll.id || receipt.collectionAddress !== activeRoll.collectionAddress) {
    return false
  }
  await discardRollVault(activeRoll.id)
  if (VERIFIED_RECEIPT.exists) VERIFIED_RECEIPT.delete()
  return true
}

export function acknowledgeVerifiedRollCompletion(): void {
  try {
    if (VERIFIED_RECEIPT.exists) VERIFIED_RECEIPT.delete()
  } catch {
    // Startup will consume the already-verified receipt idempotently.
  }
}

async function fetchAndHash(uri: string): Promise<string> {
  const normalized = normalizeArweaveUri(uri)
  if (!isPermanentArweaveUri(normalized)) throw new Error('A roll frame does not have a permanent Arweave URI.')
  const response = await fetch(normalized, { headers: { 'Cache-Control': 'no-store' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Permanent roll image is not retrievable yet (${response.status}).`)
  return hashBytes(new Uint8Array(await response.arrayBuffer()))
}

/**
 * Independently prove every prepaid frame is finalized, belongs to the wallet
 * and collection, and resolves to the exact bytes captured locally. The vault
 * is destroyed only after the complete set passes in one verification run.
 */
export async function verifyAndDiscardCompletedRollVault(activeRoll: ActiveRoll, wallet: string): Promise<void> {
  if (!activeRoll.collectionAddress) throw new Error('The roll has no collection address.')
  const key = await vaultKey()
  const manifest = await readManifest(activeRoll.id, key)
  if (!manifest || manifest.frames.length !== activeRoll.size) {
    throw new Error(`The encrypted roll contains ${manifest?.frames.length ?? 0} of ${activeRoll.size} frames.`)
  }
  const detail = await getWorkerRoll(activeRoll.collectionAddress)
  if (
    detail.wallet !== wallet ||
    detail.status !== 'COMPLETE' ||
    detail.mintedCount !== activeRoll.size ||
    !detail.developedOnChain
  ) {
    throw new Error('The Worker has not confirmed the complete prepaid roll yet.')
  }
  const { umi } = createMintUmi(wallet, getClusterRpc())
  let verifiedFrames = 0
  for (const local of manifest.frames) {
    const remote = detail.frames.find((frame) => frame.frameIndex === local.frameNumber)
    if (
      !remote ||
      remote.status !== 'MINTED' ||
      !remote.assetAddress ||
      !remote.metadataUri ||
      !remote.imageUri ||
      !isPermanentArweaveUri(normalizeArweaveUri(remote.metadataUri))
    ) {
      throw new Error(`Frame ${local.frameNumber} is not permanently complete.`)
    }
    const asset = await fetchAssetV1(umi, publicKey(remote.assetAddress), { commitment: 'finalized' })
    if (String(asset.owner) !== wallet) throw new Error(`Frame ${local.frameNumber} has the wrong owner.`)
    if (
      asset.updateAuthority.type !== 'Collection' ||
      String(asset.updateAuthority.address) !== activeRoll.collectionAddress
    ) {
      throw new Error(`Frame ${local.frameNumber} is not in the expected roll collection.`)
    }
    if (normalizeArweaveUri(asset.uri) !== normalizeArweaveUri(remote.metadataUri)) {
      throw new Error(`Frame ${local.frameNumber} metadata does not match the finalized asset.`)
    }
    const metadataResponse = await fetch(normalizeArweaveUri(remote.metadataUri), {
      headers: { 'Cache-Control': 'no-store' },
      cache: 'no-store',
    })
    if (!metadataResponse.ok) throw new Error(`Frame ${local.frameNumber} metadata is not retrievable yet.`)
    const metadata = (await metadataResponse.json()) as { image?: unknown }
    if (
      typeof metadata.image !== 'string' ||
      normalizeArweaveUri(metadata.image) !== normalizeArweaveUri(remote.imageUri)
    ) {
      throw new Error(`Frame ${local.frameNumber} metadata points to the wrong image.`)
    }
    if ((await fetchAndHash(remote.imageUri)) !== local.sha256) {
      throw new Error(`Frame ${local.frameNumber} permanent image does not match the encrypted original.`)
    }
    verifiedFrames++
  }
  if (
    !mayPurgeVerifiedRoll({
      expectedFrames: activeRoll.size,
      verifiedFrames,
      workerComplete: detail.status === 'COMPLETE' && detail.mintedCount === activeRoll.size,
      finalizedAssets: true,
      ownerAndCollectionMatch: true,
      metadataAndHashesMatch: true,
    })
  ) {
    throw new Error('The roll did not satisfy the local vault deletion policy.')
  }
  VERIFIED_RECEIPT.write(
    JSON.stringify({
      rollId: activeRoll.id,
      collectionAddress: activeRoll.collectionAddress,
      verifiedAt: new Date().toISOString(),
    }),
  )
  await discardRollVault(activeRoll.id)
}

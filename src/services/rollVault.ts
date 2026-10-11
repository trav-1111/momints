import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'react-native-quick-crypto'
import { Buffer } from '@craftzdog/react-native-buffer'
import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import type { Photo, CaptureMeta, PhotoArtifact } from '../store/photos'
import type { ActiveRoll, AspectRatio } from '../store/session'
import { createMintUmi } from './mint'
import { getClusterRpc } from '../store/network'
import { getWorkerRoll, hasInFlightRollFrameMints } from './rollApi'
import { planRollFrameNumbers } from './rollFrameNumbers'
import { deleteRollCapability } from './rollCapability'
import { CAPTURE_TEMP_DIRECTORY, deleteCapture, isPermanentArweaveUri, normalizeArweaveUri } from './imagePrivacy'
import { assertPermanentImageArtifact } from '../config/imageArtifact'
import { mayPurgeVerifiedRoll } from './rollVaultPolicy.cjs'
import { createRollVaultUri, jpegDimensions, parseRollVaultUri } from './rollVaultFormat.cjs'

const VAULT_ROOT = new Directory(Paths.document, 'momints-roll-vaults')
const KEY_NAME = 'momints.roll-vault-key.v1'
const KEYCHAIN_SERVICE = 'momints.roll-vault'
const ALGORITHM = 'aes-256-gcm'
const MAGIC = Buffer.from('MOMRLL01', 'ascii')
const IV_BYTES = 12
const TAG_BYTES = 16
const MANIFEST_VERSION = 2
const VERIFIED_RECEIPT = new File(Paths.document, 'roll-vault-verified.json')
const manifestMutations = new Map<string, Promise<unknown>>()

// Metadata updates and frame commits must not overwrite a numbering repair
// with an older manifest generation (or overwrite each other).
function mutateManifest<T>(rollId: string, operation: () => Promise<T>): Promise<T> {
  const previous = manifestMutations.get(rollId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(operation)
  manifestMutations.set(rollId, next)
  void next
    .finally(() => {
      if (manifestMutations.get(rollId) === next) manifestMutations.delete(rollId)
    })
    .catch(() => {})
  return next
}

interface StoredRollFrame {
  id: string
  fileName: string
  sha256: string
  capturedAt: number
  frameNumber: number
  aspect?: AspectRatio
  meta?: CaptureMeta
  filmStockId?: string
  artifact?: PhotoArtifact
}

interface RollVaultManifest {
  version: 1 | 2
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

function parseArtifact(raw: unknown): PhotoArtifact | null {
  if (raw === null || typeof raw !== 'object') return null
  const artifact = raw as Record<string, unknown>
  const renderer = artifact.renderer
  const recipeSha256 = artifact.recipeSha256
  const lutSha256 = artifact.lutSha256
  if (
    artifact.mime !== 'image/jpeg' ||
    typeof artifact.byteLength !== 'number' ||
    typeof artifact.width !== 'number' ||
    typeof artifact.height !== 'number' ||
    typeof artifact.imageHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.imageHash) ||
    (renderer !== 'native-egl-v2' && renderer !== 'skia-v2' && renderer !== 'legacy-v1') ||
    (recipeSha256 !== undefined && (typeof recipeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(recipeSha256))) ||
    (lutSha256 !== null &&
      lutSha256 !== undefined &&
      (typeof lutSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(lutSha256)))
  ) {
    return null
  }
  return {
    mime: 'image/jpeg',
    byteLength: artifact.byteLength,
    width: artifact.width,
    height: artifact.height,
    imageHash: artifact.imageHash,
    renderer,
    recipeSha256: recipeSha256 as string | undefined,
    lutSha256: typeof lutSha256 === 'string' ? lutSha256 : null,
  }
}

function parseFrame(raw: unknown, version: 1 | 2): StoredRollFrame | null {
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
  if (!/^[A-Za-z0-9_-]+$/.test(frame.id) || !/^[A-Za-z0-9_-]+\.frame$/.test(frame.fileName)) return null
  if (!/^[a-f0-9]{64}$/.test(frame.sha256)) return null
  const aspect = frame.aspect
  const parsedAspect =
    aspect === '1:1' || aspect === '4:3' || aspect === '16:9' || aspect === 'full' ? aspect : undefined
  const meta =
    frame.meta && typeof frame.meta === 'object' && typeof (frame.meta as Record<string, unknown>).location === 'string'
      ? { location: String((frame.meta as Record<string, unknown>).location) }
      : undefined
  const filmStockId =
    typeof frame.filmStockId === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(frame.filmStockId)
      ? frame.filmStockId
      : undefined
  const artifact = parseArtifact(frame.artifact)
  if (version === 2 && (!filmStockId || !artifact || artifact.imageHash !== frame.sha256)) return null
  return {
    id: frame.id,
    fileName: frame.fileName,
    sha256: frame.sha256,
    capturedAt: frame.capturedAt,
    frameNumber: frame.frameNumber,
    aspect: parsedAspect,
    meta,
    filmStockId,
    artifact: artifact ?? undefined,
  }
}

function parseManifest(raw: unknown, rollId: string): RollVaultManifest | null {
  if (raw === null || typeof raw !== 'object') return null
  const manifest = raw as Record<string, unknown>
  if (
    (manifest.version !== 1 && manifest.version !== MANIFEST_VERSION) ||
    manifest.rollId !== rollId ||
    typeof manifest.rollName !== 'string' ||
    typeof manifest.revision !== 'number' ||
    !Array.isArray(manifest.frames)
  ) {
    return null
  }
  const version = manifest.version as 1 | 2
  const frames = manifest.frames.map((frame) => parseFrame(frame, version))
  if (frames.some((frame) => frame === null)) return null
  return {
    version,
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

function legacyArtifact(bytes: Uint8Array, expectedHash: string): PhotoArtifact {
  const dimensions = jpegDimensions(bytes) as { width: number; height: number } | null
  if (!dimensions) throw new Error('A legacy encrypted roll frame is not a complete JPEG.')
  const imageHash = hashBytes(bytes)
  if (imageHash !== expectedHash) throw new Error('A legacy encrypted roll frame failed integrity.')
  return {
    mime: 'image/jpeg',
    byteLength: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
    imageHash,
    renderer: 'legacy-v1',
    lutSha256: null,
  }
}

async function upgradeLegacyManifest(
  manifest: RollVaultManifest,
  key: Buffer,
  fallbackFilmStockId?: string,
): Promise<RollVaultManifest> {
  if (manifest.version === 2) return manifest
  if (!fallbackFilmStockId || !/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(fallbackFilmStockId)) {
    throw new Error('The legacy roll is missing its immutable film identity.')
  }
  const directory = directoryForRoll(manifest.rollId)
  const frames: StoredRollFrame[] = []
  for (const frame of manifest.frames) {
    const encrypted = new File(directory, frame.fileName)
    if (!encrypted.exists) throw new Error(`Encrypted roll frame ${frame.frameNumber} is missing.`)
    const plaintext = open(await encrypted.bytes(), key)
    frames.push({
      ...frame,
      filmStockId: fallbackFilmStockId,
      artifact: legacyArtifact(plaintext, frame.sha256),
    })
  }
  return { ...manifest, version: 2, revision: manifest.revision + 1, frames }
}

function verifiedPhotoArtifact(photo: Pick<Photo, 'artifact'>, bytes: Uint8Array): PhotoArtifact {
  const artifact = photo.artifact
  if (!artifact || artifact.renderer === 'legacy-v1' || !artifact.recipeSha256) {
    throw new Error('The roll frame does not have a complete verified processing receipt.')
  }
  assertPermanentImageArtifact(artifact)
  const dimensions = jpegDimensions(bytes) as { width: number; height: number } | null
  if (!dimensions) throw new Error('The roll frame is not a complete JPEG.')
  if (
    artifact.byteLength !== bytes.length ||
    artifact.width !== dimensions.width ||
    artifact.height !== dimensions.height ||
    artifact.imageHash !== hashBytes(bytes)
  ) {
    throw new Error('The roll frame bytes do not match their verified processing receipt.')
  }
  return artifact
}

export async function persistRollFrame(photo: Photo, frameNumber: number): Promise<string> {
  if (!photo.rollId || !photo.rollName) throw new Error('A roll frame must have roll membership.')
  return mutateManifest(photo.rollId, async () => {
    if (!photo.rollId || !photo.rollName) throw new Error('A roll frame must have roll membership.')
    if (!photo.filmStockId) throw new Error('A roll frame must have immutable film identity.')
    assertSafeId(photo.id, 'photo id')
    const key = await vaultKey()
    const directory = directoryForRoll(photo.rollId)
    ensureDirectory(VAULT_ROOT)
    ensureDirectory(directory)
    const source = new File(photo.uri)
    const bytes = await source.bytes()
    const artifact = verifiedPhotoArtifact(photo, bytes)
    const fileName = `${photo.id}.frame`
    const encryptedFrame = new File(directory, fileName)
    encryptedFrame.write(seal(bytes, key))
    let manifestCommitted = false

    try {
      const persisted = open(await encryptedFrame.bytes(), key)
      if (hashBytes(persisted) !== artifact.imageHash)
        throw new Error('The encrypted roll frame failed commit verification.')
      const existing = await readManifest(photo.rollId, key)
      const current = existing ? await upgradeLegacyManifest(existing, key, photo.filmStockId) : null
      const frame: StoredRollFrame = {
        id: photo.id,
        fileName,
        sha256: artifact.imageHash,
        capturedAt: photo.capturedAt,
        frameNumber,
        aspect: photo.aspect,
        meta: photo.meta,
        filmStockId: photo.filmStockId,
        artifact,
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
      manifestCommitted = true
      if (!deleteCapture(photo.uri) && !deleteCapture(photo.uri)) {
        // Do not make a durably committed prepaid exposure look failed and invite
        // a duplicate frame. The exact capture directory is swept next startup.
        console.error('The encrypted roll frame was committed but plaintext cleanup needs the startup sweep.')
      }
      return createRollVaultUri(photo.rollId, photo.id) as string
    } catch (error) {
      try {
        if (!manifestCommitted && encryptedFrame.exists) encryptedFrame.delete()
      } catch {}
      throw error
    }
  })
}

export async function updateStoredRollFrameMeta(rollId: string, photoId: string, meta: CaptureMeta): Promise<void> {
  return mutateManifest(rollId, async () => {
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
  })
}

/** Local metadata repair only: no server writes, uploads, mints or image changes. */
export async function repairRollVaultFrameNumbers(
  roll: ActiveRoll,
  wallet: string,
  mintedPhotoIds: ReadonlySet<string>,
): Promise<Map<string, number>> {
  return mutateManifest(roll.id, async () => {
    const key = await vaultKey()
    const manifest = await readManifest(roll.id, key)
    if (!manifest || manifest.version !== 2)
      throw new Error('The encrypted originals are unavailable. The roll has been preserved.')
    if (
      manifest.frames.length !== roll.frameIds.length ||
      manifest.frames.some((frame) => !roll.frameIds.includes(frame.id))
    )
      throw new Error('The local roll and encrypted vault disagree. Restart to restore the vault before retrying.')
    const numbers = new Map(manifest.frames.map((frame) => [frame.id, frame.frameNumber]))
    if (new Set(numbers.values()).size === numbers.size) return numbers
    if (!roll.collectionAddress || (!roll.developed && roll.frameIds.length < roll.size))
      throw new Error('Finish shooting this roll before repairing its duplicate frame numbers.')
    const collection = roll.collectionAddress
    if (hasInFlightRollFrameMints(collection)) throw new Error('Wait for frame uploads to finish before retrying.')
    const detail = await getWorkerRoll(collection)
    if (
      detail.wallet !== wallet ||
      detail.collectionAddress !== collection ||
      detail.size !== roll.size ||
      detail.status !== 'OPEN'
    )
      throw new Error('Reconnect the original wallet to its open roll before repairing frame numbers.')
    const repaired = planRollFrameNumbers(manifest.frames, detail.frames, roll.size, mintedPhotoIds)
    // Validate the actual encrypted bytes before changing their slot metadata.
    for (const frame of manifest.frames) {
      const encrypted = new File(directoryForRoll(roll.id), frame.fileName)
      const bytes = open(await encrypted.bytes(), key)
      verifiedPhotoArtifact({ artifact: frame.artifact }, bytes)
    }
    const current = await getWorkerRoll(collection)
    if (hasInFlightRollFrameMints(collection) || JSON.stringify(current) !== JSON.stringify(detail))
      throw new Error('The server roll changed during repair. Wait for minting to finish and retry.')
    const updated = {
      ...manifest,
      revision: manifest.revision + 1,
      frames: manifest.frames.map((frame) => ({ ...frame, frameNumber: repaired.get(frame.id)! })),
    }
    await writeManifest(updated, key)
    const saved = await readManifest(roll.id, key)
    if (
      saved?.revision !== updated.revision ||
      saved.frames.some((frame) => frame.frameNumber !== repaired.get(frame.id))
    )
      throw new Error('Frame-number repair could not be verified. Keep the app data and restart before retrying.')
    return repaired
  })
}

export function isRollVaultPhotoUri(uri: unknown): boolean {
  return typeof uri === 'string' && parseRollVaultUri(uri) !== null
}

export async function restoreRollVault(rollId: string, fallbackFilmStockId?: string): Promise<RestoredRollVault> {
  const key = await vaultKey()
  const stored = await readManifest(rollId, key)
  if (!stored) return { photos: [], frameIds: [] }
  const manifest = await upgradeLegacyManifest(stored, key, fallbackFilmStockId)
  if (stored.version === 1) await writeManifest(manifest, key)
  const directory = directoryForRoll(rollId)
  const photos: Photo[] = []
  for (const frame of manifest.frames) {
    const encrypted = new File(directory, frame.fileName)
    if (!encrypted.exists) throw new Error(`Encrypted roll frame ${frame.frameNumber} is missing.`)
    if (!frame.artifact || !frame.filmStockId)
      throw new Error(`Encrypted roll frame ${frame.frameNumber} is incomplete.`)
    if (fallbackFilmStockId && frame.filmStockId !== fallbackFilmStockId) {
      throw new Error(`Encrypted roll frame ${frame.frameNumber} has the wrong film identity.`)
    }
    photos.push({
      id: frame.id,
      uri: createRollVaultUri(rollId, frame.id) as string,
      capturedAt: frame.capturedAt,
      action: 'mint',
      aspect: frame.aspect,
      filmStockId: frame.filmStockId,
      artifact: frame.artifact,
      meta: frame.meta,
      rollId,
      rollName: manifest.rollName,
      rollFrameNumber: frame.frameNumber,
    })
  }
  return { photos, frameIds: photos.map((photo) => photo.id) }
}

/**
 * Materialize exactly one authenticated frame for the lifetime of an upload or
 * bounded preview operation. The caller never owns the file and cannot extend
 * its lifetime beyond the awaited callback.
 */
export async function withDecryptedRollFrame<T>(
  vaultUri: string,
  operation: (
    temporaryUri: string,
    artifact: PhotoArtifact,
    reference: { rollId: string; photoId: string; frameNumber: number },
  ) => Promise<T>,
): Promise<T> {
  const reference = parseRollVaultUri(vaultUri) as { rollId: string; photoId: string } | null
  if (!reference) throw new Error('Invalid roll vault reference.')
  const key = await vaultKey()
  const manifest = await readManifest(reference.rollId, key)
  if (!manifest || manifest.version !== 2) throw new Error('The encrypted roll manifest is unavailable.')
  const frame = manifest.frames.find((item) => item.id === reference.photoId)
  if (!frame?.artifact) throw new Error('The encrypted roll frame metadata is unavailable.')
  const encrypted = new File(directoryForRoll(reference.rollId), frame.fileName)
  if (!encrypted.exists) throw new Error(`Encrypted roll frame ${frame.frameNumber} is missing.`)
  const plaintext = open(await encrypted.bytes(), key)
  const dimensions = jpegDimensions(plaintext) as { width: number; height: number } | null
  if (
    hashBytes(plaintext) !== frame.artifact.imageHash ||
    plaintext.length !== frame.artifact.byteLength ||
    !dimensions ||
    dimensions.width !== frame.artifact.width ||
    dimensions.height !== frame.artifact.height
  ) {
    throw new Error(`Encrypted roll frame ${frame.frameNumber} failed integrity.`)
  }
  ensureDirectory(CAPTURE_TEMP_DIRECTORY)
  const nonce = randomBytes(8).toString('hex')
  const output = new File(CAPTURE_TEMP_DIRECTORY, `roll-jit-${reference.rollId}-${reference.photoId}-${nonce}.jpg`)
  output.write(plaintext)
  try {
    return await operation(output.uri, frame.artifact, { ...reference, frameNumber: frame.frameNumber })
  } finally {
    deleteCapture(output.uri)
  }
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
  if (activeRoll.collectionAddress) await deleteRollCapability(activeRoll.collectionAddress)
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

async function fetchPermanentArtifact(uri: string): Promise<{ imageHash: string; width: number; height: number }> {
  const normalized = normalizeArweaveUri(uri)
  if (!isPermanentArweaveUri(normalized)) throw new Error('A roll frame does not have a permanent Arweave URI.')
  const response = await fetch(normalized, { headers: { 'Cache-Control': 'no-store' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Permanent roll image is not retrievable yet (${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const dimensions = jpegDimensions(bytes) as { width: number; height: number } | null
  if (!dimensions) throw new Error('Permanent roll image is not a complete JPEG.')
  return { imageHash: hashBytes(bytes), ...dimensions }
}

/**
 * Independently prove every prepaid frame is finalized, belongs to the wallet
 * and collection, and resolves to the exact bytes captured locally. The vault
 * is destroyed only after the complete set passes in one verification run.
 */
export async function verifyAndDiscardCompletedRollVault(activeRoll: ActiveRoll, wallet: string): Promise<void> {
  if (!activeRoll.collectionAddress) throw new Error('The roll has no collection address.')
  const key = await vaultKey()
  const stored = await readManifest(activeRoll.id, key)
  const manifest = stored ? await upgradeLegacyManifest(stored, key, activeRoll.film.filmStockId) : null
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
    if (!local.artifact) throw new Error(`Frame ${local.frameNumber} has no verified local artifact receipt.`)
    const localArtifact = local.artifact
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
    if (
      (remote.imageHash !== null && remote.imageHash !== localArtifact.imageHash) ||
      (remote.width !== null && remote.width !== localArtifact.width) ||
      (remote.height !== null && remote.height !== localArtifact.height)
    ) {
      throw new Error(`Frame ${local.frameNumber} Worker receipt does not match the encrypted original.`)
    }
    const permanent = await fetchPermanentArtifact(remote.imageUri)
    if (
      permanent.imageHash !== local.sha256 ||
      permanent.width !== localArtifact.width ||
      permanent.height !== localArtifact.height
    ) {
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
  await deleteRollCapability(activeRoll.collectionAddress)
}

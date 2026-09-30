import { Directory, File, Paths } from 'expo-file-system'
import { Image as ExpoImage } from 'expo-image'
import {
  isFileUriInsideDirectory,
  isLegacyRootCacheImageName,
  isPermanentArweaveUri as isPermanentArweaveUriGuard,
} from './privacyPathGuard.cjs'
import { deleteDisplayPreview, DISPLAY_PREVIEW_DIRECTORY } from './displayPreview'

export const CAPTURE_TEMP_DIRECTORY = new Directory(Paths.cache, 'momints-captures')
export const CONTACT_SHEET_INPUT_DIRECTORY = new Directory(Paths.cache, 'momints-contact-sheet-inputs')
export const CONTACT_SHEET_OUTPUT_DIRECTORY = new Directory(Paths.cache, 'momints-contact-sheet-outputs')
export const LEGACY_PHOTO_DIRECTORY = new Directory(Paths.document, 'photos')

const OWNED_DIRECTORIES = [
  CAPTURE_TEMP_DIRECTORY,
  CONTACT_SHEET_INPUT_DIRECTORY,
  CONTACT_SHEET_OUTPUT_DIRECTORY,
  DISPLAY_PREVIEW_DIRECTORY,
  LEGACY_PHOTO_DIRECTORY,
]

function ensureDirectory(directory: Directory): void {
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true })
}

export function isAppOwnedImageUri(uri: unknown): uri is string {
  return typeof uri === 'string' && OWNED_DIRECTORIES.some((directory) => isFileUriInsideDirectory(uri, directory.uri))
}

export function deleteAppOwnedImage(uri: unknown): boolean {
  if (!isAppOwnedImageUri(uri)) return false
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
    return true
  } catch {
    return false
  }
}

export function deleteCapture(uri: unknown): boolean {
  if (typeof uri !== 'string' || !isFileUriInsideDirectory(uri, CAPTURE_TEMP_DIRECTORY.uri)) return false
  deleteDisplayPreview(uri)
  return deleteAppOwnedImage(uri)
}

export function adoptTemporaryCapture(sourceUri: string): string {
  ensureDirectory(CAPTURE_TEMP_DIRECTORY)
  if (isFileUriInsideDirectory(sourceUri, CAPTURE_TEMP_DIRECTORY.uri)) return sourceUri

  const extension = sourceUri.toLowerCase().includes('.png') ? 'png' : 'jpg'
  const destination = new File(
    CAPTURE_TEMP_DIRECTORY,
    `capture-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
  )
  const source = new File(sourceUri)
  try {
    source.move(destination)
    return destination.uri
  } catch (error) {
    try {
      if (source.exists) source.delete()
    } catch {
      // The startup sweep cannot see Vision Camera's source directory.
    }
    throw error
  }
}

export function createContactSheetInputDirectory(): Directory {
  ensureDirectory(CONTACT_SHEET_INPUT_DIRECTORY)
  const directory = new Directory(
    CONTACT_SHEET_INPUT_DIRECTORY,
    `render-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  directory.create({ idempotent: true, intermediates: true })
  return directory
}

export function createContactSheetOutputFile(): File {
  ensureDirectory(CONTACT_SHEET_OUTPUT_DIRECTORY)
  return new File(
    CONTACT_SHEET_OUTPUT_DIRECTORY,
    `momints-contact-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  )
}

export function deleteOwnedDirectory(directory: Directory): void {
  if (!OWNED_DIRECTORIES.some((owned) => owned.uri === directory.uri)) return
  try {
    if (directory.exists) directory.delete()
  } catch {
    // Startup cleanup is best-effort and retried on every launch.
  }
}

export function deleteContactSheetRenderDirectory(directory: Directory): void {
  if (!isFileUriInsideDirectory(directory.uri, CONTACT_SHEET_INPUT_DIRECTORY.uri)) return
  try {
    if (directory.exists) directory.delete()
  } catch {
    // A later startup sweep is the backstop.
  }
}

export async function runPrivacyStartupSweep(): Promise<void> {
  deleteOwnedDirectory(CAPTURE_TEMP_DIRECTORY)
  deleteOwnedDirectory(CONTACT_SHEET_INPUT_DIRECTORY)
  deleteOwnedDirectory(CONTACT_SHEET_OUTPUT_DIRECTORY)
  deleteOwnedDirectory(DISPLAY_PREVIEW_DIRECTORY)
  deleteOwnedDirectory(LEGACY_PHOTO_DIRECTORY)
  try {
    const legacyPhotoStore = new File(Paths.document, 'photos-store.json')
    if (legacyPhotoStore.exists) legacyPhotoStore.delete()
  } catch {
    // Retried next launch; never broaden this to arbitrary document files.
  }
  for (const name of [
    'http-cache',
    'image_cache',
    'image_manager_disk_cache',
    'small_image_cache',
    'expo-image-cache',
    // expo-image-manipulator writes every saveAsync result here. Individual
    // operations delete or move their result, but Android can keep a file open
    // until its native ImageRef is released. A crash can also strand a result.
    // This exact app-cache directory never contains user-owned gallery files.
    'ImageManipulator',
  ]) {
    try {
      const imageCache = new Directory(Paths.cache, name)
      if (imageCache.exists) imageCache.delete()
    } catch {
      // Exact, known image-cache directory only. Never clear the whole cache root.
    }
  }
  try {
    const cacheRoot = new Directory(Paths.cache)
    for (const entry of cacheRoot.list()) {
      if (
        entry instanceof File &&
        (/\/momints-contact-sheet-[^/]+\.png$/i.test(entry.uri) || isLegacyRootCacheImageName(entry.name))
      ) {
        entry.delete()
      }
    }
  } catch {
    // Exact legacy app-output names only; unrelated cache files are intentionally left alone.
  }
  try {
    await ExpoImage.clearDiskCache()
  } catch {
    // Some platforms do not expose a disk cache; no cache is retained there.
  }
}

export function isPermanentArweaveUri(uri: unknown): uri is string {
  return isPermanentArweaveUriGuard(uri)
}

export function normalizeArweaveUri(uri: string): string {
  return uri.startsWith('ar://') ? `https://arweave.net/${uri.slice(5)}` : uri
}

export class PermanentImageUnavailableError extends Error {
  constructor(public readonly status: number) {
    super(`Permanent image is not retrievable yet (${status}).`)
    this.name = 'PermanentImageUnavailableError'
  }
}

/**
 * Arweave gateways can return 404 for several minutes after the upload has
 * completed. That is a propagation state, not a failed mint. Network and
 * gateway errors are equally retryable once the URI has passed the strict
 * Arweave-host check below.
 */
export function isPermanentImagePending(error: unknown): boolean {
  if (error instanceof PermanentImageUnavailableError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('network request failed') || message.includes('failed to fetch') || message.includes('timeout')
  )
}

export async function verifyPermanentImage(uri: string): Promise<string> {
  const normalized = normalizeArweaveUri(uri)
  if (!isPermanentArweaveUri(normalized)) throw new Error('The mint did not return a permanent Arweave image URI.')
  const response = await fetch(normalized, {
    method: 'GET',
    headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-store' },
    cache: 'no-store',
  })
  if (!response.ok) throw new PermanentImageUnavailableError(response.status)
  return normalized
}

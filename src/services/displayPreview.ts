import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator'
import { Directory, File, Paths } from 'expo-file-system'

const DISPLAY_LONG_EDGE = 2688
const DISPLAY_QUALITY = 0.88

export const DISPLAY_PREVIEW_DIRECTORY = new Directory(Paths.cache, 'momints-display-previews')

const inFlight = new Map<string, Promise<string>>()
const generations = new Map<string, number>()
let previewQueue: Promise<void> = Promise.resolve()

function ensureDirectory(): void {
  if (!DISPLAY_PREVIEW_DIRECTORY.exists) {
    DISPLAY_PREVIEW_DIRECTORY.create({ idempotent: true, intermediates: true })
  }
}

function sourceKey(uri: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < uri.length; i += 1) {
    hash ^= uri.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function displayPreviewFileForSource(uri: string): File {
  return new File(DISPLAY_PREVIEW_DIRECTORY, `preview-${sourceKey(uri)}.jpg`)
}

function release(ref: ImageRef | ImageManipulatorContext | null): void {
  try {
    ref?.release()
  } catch {
    // Native image refs may already have been released after an interrupted render.
  }
}

async function buildDisplayPreview(uri: string, generation: number): Promise<string> {
  ensureDirectory()
  const destination = displayPreviewFileForSource(uri)
  if (destination.exists) return destination.uri

  let base: ImageRef | null = null
  let resized: ImageRef | null = null
  let baseContext: ImageManipulatorContext | null = null
  let resizeContext: ImageManipulatorContext | null = null
  let savedUri: string | null = null
  try {
    baseContext = ImageManipulator.manipulate(uri)
    base = await baseContext.renderAsync()
    const portrait = base.height >= base.width
    const longEdge = Math.max(base.width, base.height)
    let renderSource = base
    if (longEdge > DISPLAY_LONG_EDGE) {
      resizeContext = ImageManipulator.manipulate(base)
      resizeContext.resize(portrait ? { height: DISPLAY_LONG_EDGE } : { width: DISPLAY_LONG_EDGE })
      resized = await resizeContext.renderAsync()
      renderSource = resized
    }
    const saved = await renderSource.saveAsync({ format: SaveFormat.JPEG, compress: DISPLAY_QUALITY })
    savedUri = saved.uri

    if ((generations.get(uri) ?? 0) !== generation) throw new Error('Display preview generation was cancelled')
    ensureDirectory()
    if (destination.exists) destination.delete()
    new File(saved.uri).move(destination)
    savedUri = null
    return destination.uri
  } finally {
    if (savedUri) {
      try {
        const saved = new File(savedUri)
        if (saved.exists) saved.delete()
      } catch {
        // The app-owned cache sweep is the cleanup backstop.
      }
    }
    release(resizeContext)
    release(baseContext)
    release(resized)
    release(base)
  }
}

/** Create one bounded reveal derivative without altering the mint-quality file. */
export function ensureDisplayPreview(uri: string): Promise<string> {
  const existing = displayPreviewFileForSource(uri)
  if (existing.exists) return Promise.resolve(existing.uri)
  const pending = inFlight.get(uri)
  if (pending) return pending

  const generation = generations.get(uri) ?? 0
  const queued = previewQueue.then(() => buildDisplayPreview(uri, generation))
  previewQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  const created = queued.finally(() => {
    if (inFlight.get(uri) === created) inFlight.delete(uri)
  })
  inFlight.set(uri, created)
  return created
}

export function deleteDisplayPreview(uri: string): void {
  generations.set(uri, (generations.get(uri) ?? 0) + 1)
  try {
    const preview = displayPreviewFileForSource(uri)
    if (preview.exists) preview.delete()
  } catch {
    // The startup sweep retries this exact app-owned directory.
  }
}

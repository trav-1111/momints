import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator'
import { withDecryptedRollFrame } from './rollVault'

const MAX_PREVIEW_EDGE = 1024
let previewQueue: Promise<void> = Promise.resolve()

function release(ref: ImageRef | ImageManipulatorContext | null): void {
  try {
    ref?.release()
  } catch {
    // An interrupted native render may already have released its reference.
  }
}

async function buildMemoryPreview(vaultUri: string, requestedLongEdge: number): Promise<string> {
  return withDecryptedRollFrame(vaultUri, async (temporaryUri, artifact) => {
    const edge = Math.max(64, Math.min(MAX_PREVIEW_EDGE, Math.ceil(requestedLongEdge)))
    let context: ImageManipulatorContext | null = null
    let image: ImageRef | null = null
    let savedUri: string | null = null
    try {
      context = ImageManipulator.manipulate(temporaryUri)
      if (Math.max(artifact.width, artifact.height) > edge) {
        context.resize(artifact.width >= artifact.height ? { width: edge } : { height: edge })
      }
      image = await context.renderAsync()
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 })
      savedUri = saved.uri
      const encoded = await new File(saved.uri).base64()
      return `data:image/jpeg;base64,${encoded}`
    } finally {
      // Release the native image before deleting saveAsync's cache file.
      // On Android the open ImageRef can otherwise leave the JPEG stranded in
      // cache even though File.delete() was attempted.
      release(image)
      image = null
      release(context)
      context = null
      if (savedUri) {
        try {
          const saved = new File(savedUri)
          if (saved.exists) saved.delete()
        } catch {
          // The app startup cache sweep remains the exact-directory backstop.
        }
      }
    }
  })
}

/**
 * Produce a bounded reveal derivative in memory. Work is serialized so a
 * virtualized list cannot decrypt/decode an entire 24-frame roll at once.
 */
export function createRollVaultPreviewDataUri(vaultUri: string, requestedLongEdge: number): Promise<string> {
  const queued = previewQueue.then(() => buildMemoryPreview(vaultUri, requestedLongEdge))
  previewQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
}

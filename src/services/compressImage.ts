import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Paths, File, Directory } from 'expo-file-system'

// Sits deliberately under the Worker's quick-mint ceiling of 3,145,728 bytes
// (MAX_QUICK_IMAGE_BYTES in worker/src/quick/config.ts). The gap is margin: a
// client result that squeaked in at 2.99 MB would still be at the mercy of the
// server's exact comparison. KEEP IN SYNC with that constant.
const TARGET_BYTES = 2_900_000

// An explicit ladder rather than a decrementing float — stepping 0.85 by 0.1
// lands on 0.55 and skips the floor entirely. Same idiom as JPEG_QUALITIES in
// worker/src/rolls/cover.ts.
const QUALITY_FLOOR = 0.6
const JPEG_QUALITIES = [0.85, 0.75, 0.65, QUALITY_FLOOR]

// Only reached if the quality ladder bottoms out while still over. Realistic
// captures top out around 6 MB, which quality alone handles comfortably, so
// this exists to make failure impossible rather than because it is expected.
const RESIZE_LONG_EDGES = [2048, 1600, 1280]

/** Best-effort delete. A stray cache file is harmless; losing the result is not. */
function discard(uri: string): void {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // Ignored by design — see above.
  }
}

/**
 * Shrink a captured JPEG to fit under the quick-mint upload ceiling, and only
 * if it is actually over. Returns the URI to store: the original `uri`
 * untouched when it already fits, otherwise a new file in the photos dir (the
 * original is deleted — "replace", same contract as cropToAspect/applyFilm).
 *
 * The under-ceiling case is the common one and must stay free: it returns
 * before any decode, so a photo that already fits is never re-encoded and loses
 * no quality.
 *
 * Quality first, resolution only as a backstop — dropping detail is a worse
 * trade than dropping compression ratio for a photograph.
 *
 * Defensive: any failure returns the original `uri`. A photo that fails to
 * compress may be rejected at mint, which the user can retry; a photo lost to a
 * processing error cannot be recovered. Never throws.
 */
export async function ensureUnderCeiling(uri: string): Promise<string> {
  try {
    const originalBytes = new File(uri).size
    if (originalBytes <= TARGET_BYTES) {
      if (__DEV__) console.log(`[compress] ${originalBytes}B under ceiling — untouched`)
      return uri
    }

    // Decoded once and reused: ImageRef.saveAsync can be called repeatedly, so
    // walking the quality ladder costs one decode total, not one per step.
    const base = await ImageManipulator.manipulate(uri).renderAsync()
    const portrait = base.height >= base.width

    let fitted: string | null = null

    for (const compress of JPEG_QUALITIES) {
      const saved = await base.saveAsync({ format: SaveFormat.JPEG, compress })
      if (new File(saved.uri).size <= TARGET_BYTES) {
        fitted = saved.uri
        break
      }
      discard(saved.uri) // every saveAsync writes a fresh cache file
    }

    if (!fitted) {
      const longEdge = Math.max(base.width, base.height)
      for (const edge of RESIZE_LONG_EDGES) {
        // Never grow: resize() would happily upscale a small-but-dense image,
        // which is the opposite of the job.
        if (edge >= longEdge) continue
        // Cap the LONGER edge and let resize derive the other, so the aspect
        // ratio the shooter framed survives.
        const resized = await ImageManipulator.manipulate(base)
          .resize(portrait ? { height: edge } : { width: edge })
          .renderAsync()
        const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY_FLOOR })
        if (new File(saved.uri).size <= TARGET_BYTES) {
          fitted = saved.uri
          break
        }
        discard(saved.uri)
      }
    }

    if (!fitted) {
      console.error(
        `ensureUnderCeiling: ${originalBytes}B would not fit under ${TARGET_BYTES}B ` +
          'even at the smallest size — keeping the original.',
      )
      return uri
    }

    // saveAsync writes to the cache dir — move it into the persistent photos dir.
    const photosDir = new Directory(Paths.document, 'photos')
    if (!photosDir.exists) photosDir.create()
    const dest = new File(photosDir, `photo_${Date.now()}_fit.jpg`)
    new File(fitted).move(dest)

    if (__DEV__) console.log(`[compress] ${originalBytes}B -> ${dest.size}B`)

    // Replace: the caller commits the new URI, so the oversized input is dead.
    discard(uri)

    return dest.uri
  } catch (error) {
    console.error('ensureUnderCeiling failed, keeping original:', error)
    return uri
  }
}

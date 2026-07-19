import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Paths, File, Directory } from 'expo-file-system'
import type { AspectRatio } from '../store/session'

// Long-edge : short-edge for each croppable ratio.
const RATIO: Record<Exclude<AspectRatio, 'full'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
}

const JPEG_QUALITY = 0.95

interface CropRect {
  originX: number
  originY: number
  width: number
  height: number
}

/**
 * Center-crop rectangle for an image of `w`×`h` to the target aspect,
 * preserving the source orientation (portrait stays portrait). Returns null
 * when the source already matches (no crop needed).
 */
function computeCropRect(w: number, h: number, aspect: Exclude<AspectRatio, 'full'>): CropRect | null {
  const r = RATIO[aspect]
  const portrait = h >= w
  const long = portrait ? h : w
  const short = portrait ? w : h

  // Keep the short edge; derive the long edge from the ratio, clamped to source.
  let cropShort = short
  let cropLong = Math.round(short * r)
  if (cropLong > long) {
    cropLong = long
    cropShort = Math.round(long / r)
  }

  const cropW = portrait ? cropShort : cropLong
  const cropH = portrait ? cropLong : cropShort
  if (cropW >= w && cropH >= h) return null // already the right shape

  return {
    originX: Math.round((w - cropW) / 2),
    originY: Math.round((h - cropH) / 2),
    width: cropW,
    height: cropH,
  }
}

/**
 * Center-crop a captured JPEG to the given aspect ratio. Returns the URI to
 * store: the original `uri` for `full` (or if no crop is needed), otherwise a
 * new cropped file in the photos dir (the original is deleted — "replace").
 *
 * Defensive: any failure returns the original `uri` so a capture is never lost.
 * expo-image-manipulator loads the display-oriented image, so cropping and the
 * dimensions read from it share one coordinate space.
 */
export async function cropToAspect(uri: string, aspect: AspectRatio): Promise<string> {
  if (aspect === 'full') return uri

  try {
    // Load once to get orientation-normalized dimensions, then crop that same ref.
    const base = await ImageManipulator.manipulate(uri).renderAsync()
    const rect = computeCropRect(base.width, base.height, aspect)
    if (!rect) return uri

    const croppedRef = await ImageManipulator.manipulate(base).crop(rect).renderAsync()
    const saved = await croppedRef.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })

    // saveAsync writes to the cache dir — move it into the persistent photos dir.
    const photosDir = new Directory(Paths.document, 'photos')
    if (!photosDir.exists) photosDir.create()
    const dest = new File(photosDir, `photo_${Date.now()}_crop.jpg`)
    new File(saved.uri).move(dest)

    // Replace: discard the uncropped original now that the crop is saved.
    try {
      const original = new File(uri)
      if (original.exists) original.delete()
    } catch {
      // A stray file is harmless — keep the cropped result.
    }

    return dest.uri
  } catch (error) {
    console.error('cropToAspect failed, keeping full frame:', error)
    return uri
  }
}

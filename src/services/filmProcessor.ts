import { Skia, ImageFormat } from '@shopify/react-native-skia'
import { File } from 'expo-file-system'
import type { FilmSettings } from '../store/session'

// Luminance-weighted grayscale color matrix (4x5, Rec. 601 coefficients).
// Each output channel = 0.299R + 0.587G + 0.114B, alpha preserved.
// prettier-ignore
const GRAYSCALE_MATRIX = [
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0,     0,     0,     1, 0,
]

const JPEG_QUALITY = 95

/**
 * Applies a roll's film emulation to a captured JPEG at `uri`.
 *
 * Returns the URI that should be stored for the frame:
 *  - `color` rolls: the original `uri`, unchanged (no-op).
 *  - `bw` rolls: a new grayscale JPEG file; the original color file is deleted.
 *
 * Defensive by design — if any step fails the original `uri` is returned so a
 * capture is never lost to a processing error (it just stays in color).
 *
 * This is the single extension point for the roadmap: film stock / ISO grain
 * become additional draw passes here, keyed off `film`.
 */
export async function applyFilm(uri: string, film: FilmSettings): Promise<string> {
  if (film.mode !== 'bw') return uri

  try {
    const source = new File(uri)
    const bytes = await source.bytes()

    const data = Skia.Data.fromBytes(bytes)
    const image = Skia.Image.MakeImageFromEncoded(data)
    if (!image) return uri

    const width = image.width()
    const height = image.height()
    const surface = Skia.Surface.MakeOffscreen(width, height)
    if (!surface) return uri

    const paint = Skia.Paint()
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(GRAYSCALE_MATRIX))

    const canvas = surface.getCanvas()
    canvas.drawImage(image, 0, 0, paint)
    surface.flush()

    const snapshot = surface.makeImageSnapshot()
    const encoded = snapshot.encodeToBytes(ImageFormat.JPEG, JPEG_QUALITY)

    const photosDir = new File(uri).parentDirectory
    const destFile = new File(photosDir, `photo_${Date.now()}_bw.jpg`)
    destFile.write(encoded)

    // Replace: discard the color original now that the B&W version is saved.
    try {
      source.delete()
    } catch {
      // Leaving a stray color file is harmless; keep the B&W result.
    }

    return destFile.uri
  } catch (error) {
    console.error('applyFilm failed, keeping color original:', error)
    return uri
  }
}

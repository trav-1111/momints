import { Skia, ImageFormat } from '@shopify/react-native-skia'
import { File } from 'expo-file-system'
import type { FilmSettings } from '../store/session'
import { loadFilmStockRecipe } from './filmstocks'

const JPEG_QUALITY = 95
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]

/**
 * Apply the immutable recipe pinned to a capture. Identity recipes keep the
 * original URI; visual recipes create a new JPEG and remove the unprocessed
 * temporary capture. Failures surface instead of silently minting the wrong
 * look under the selected filmStockId.
 */
export async function applyFilm(uri: string, film: FilmSettings): Promise<string> {
  const recipe = await loadFilmStockRecipe(film.filmStockId)
  try {
    const matrix = recipe.colorMatrix
    if (matrix.every((value, index) => value === IDENTITY_MATRIX[index])) return uri

    const source = new File(uri)
    const data = Skia.Data.fromBytes(await source.bytes())
    const image = Skia.Image.MakeImageFromEncoded(data)
    if (!image) throw new Error('Captured image could not be decoded')

    const surface = Skia.Surface.MakeOffscreen(image.width(), image.height())
    if (!surface) throw new Error('Film processing surface could not be created')

    const paint = Skia.Paint()
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix))
    surface.getCanvas().drawImage(image, 0, 0, paint)
    surface.flush()

    const encoded = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, JPEG_QUALITY)
    const destination = new File(source.parentDirectory, `photo_${Date.now()}_${film.filmStockId}.jpg`)
    destination.write(encoded)
    try {
      source.delete()
    } catch {
      // Startup cleanup removes any stray app-owned temporary capture.
    }
    return destination.uri
  } catch (error) {
    console.error(`applyFilm failed for ${film.filmStockId}:`, error)
    throw new Error(`Could not process ${film.filmStockId}`, { cause: error instanceof Error ? error : undefined })
  }
}

import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

export interface FilmGlOptions {
  inputUri: string
  outputUri: string
  filmStockId: string
  recipeJson: string
  recipeSha256: string
  lutUri: string | null
  seed: number
  jpegQuality: number
  jpegTargetBytes: number
}

export interface FilmProcessingReceipt {
  filmStockId: string
  recipeSha256: string
  lutSha256: string | null
  outputUri: string
  outputSha256: string
  mime: 'image/jpeg'
  byteLength: number
  width: number
  height: number
  renderer: 'native-egl-v2' | 'skia-v2'
  colorSpace: 'sRGB'
}

interface FilmGlModule {
  applyFilmNative(options: FilmGlOptions): Promise<FilmProcessingReceipt>
}

const nativeModule = Platform.OS === 'android' ? requireOptionalNativeModule<FilmGlModule>('FilmGl') : null

export function isFilmGlAvailable(): boolean {
  return nativeModule !== null
}

export async function applyFilmNative(options: FilmGlOptions): Promise<FilmProcessingReceipt> {
  if (!nativeModule) throw new Error('Native film renderer is unavailable; rebuild the Android app')
  return nativeModule.applyFilmNative(options)
}

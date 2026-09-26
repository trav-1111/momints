export interface FilmGlOptions {
  inputUri: string
  outputUri: string
  aspect?: string | null
  lutUri?: string | null
  grainIntensity?: number
  grainSize?: number
  grainSeed?: number
  halationIntensity?: number
  halationRadius?: number
  hasLut?: boolean
  isBW?: boolean
  originX?: number
  originY?: number
  cropWidth?: number
  cropHeight?: number
  jpegQuality?: number
}

let nativeModuleInstance: any = null
let checkedAvailability = false

export function isFilmGlAvailable(): boolean {
  if (checkedAvailability) {
    return nativeModuleInstance !== null
  }
  checkedAvailability = true
  try {
    const { requireNativeModule } = require('expo-modules-core')
    if (typeof requireNativeModule === 'function') {
      nativeModuleInstance = requireNativeModule('FilmGl')
    }
  } catch {
    nativeModuleInstance = null
  }
  return nativeModuleInstance !== null
}

export async function applyFilmNative(options: FilmGlOptions): Promise<string> {
  if (!isFilmGlAvailable() || !nativeModuleInstance) {
    throw new Error('FilmGl native module is not available in the current runtime')
  }

  return await nativeModuleInstance.applyFilmNative({
    inputUri: options.inputUri,
    outputUri: options.outputUri,
    aspect: options.aspect ?? null,
    lutUri: options.lutUri ?? null,
    grainIntensity: options.grainIntensity ?? 0,
    grainSize: options.grainSize ?? 1,
    grainSeed: options.grainSeed ?? 0,
    halationIntensity: options.halationIntensity ?? 0,
    halationRadius: options.halationRadius ?? 0,
    hasLut: options.hasLut ?? false,
    isBW: options.isBW ?? false,
    originX: Math.round(options.originX ?? 0),
    originY: Math.round(options.originY ?? 0),
    cropWidth: Math.round(options.cropWidth ?? 0),
    cropHeight: Math.round(options.cropHeight ?? 0),
    jpegQuality: Math.round(options.jpegQuality ?? 90),
  })
}

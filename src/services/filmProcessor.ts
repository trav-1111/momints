import {
  AlphaType,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
} from '@shopify/react-native-skia'
import { createHash } from 'react-native-quick-crypto'
import { File } from 'expo-file-system'
import { Platform } from 'react-native'
import { v4 as uuidv4 } from 'uuid'
import { applyFilmNative, type FilmProcessingReceipt } from '../../modules/film-gl'
import { jpegDimensions, sha256, verifyFilmOutput } from './filmOutput'
import { deleteCapture } from './imagePrivacy'
import type { FilmSettings } from '../store/session'
import { PERMANENT_IMAGE_TARGET_BYTES } from '../config/imageArtifact'
import {
  LUT_SIZE,
  loadFilmStockPackage,
  parseRuntimeLut,
  type FilmStockRecipeV1,
  type FilmStockRecipeV2,
} from './filmstocks'

const JPEG_QUALITY = 95
const JPEG_QUALITIES = [JPEG_QUALITY, 90, 85, 80, 75, 70, 65, 60]
const RESIZE_LONG_EDGES = [2048, 1600, 1280]
const TILE_SIZE = 1024

// Fixed engine order: normalized sRGB input → exposure → LUT → halation →
// bloom → grain → sharpness/softness → vignette → sRGB JPEG export.
const LUT_EFFECT_SOURCE = `
uniform shader image;
uniform shader lut;
uniform float lutSize;
uniform float lutIntensity;
uniform float exposureEv;
uniform float grainAmount;
uniform float grainSize;
uniform float grainRoughness;
uniform float halationAmount;
uniform float halationRadius;
uniform float bloomAmount;
uniform float bloomRadius;
uniform float sharpnessAmount;
uniform float vignetteAmount;
uniform float2 imageSize;
uniform float seed;

half luminance(half3 color) {
  return dot(color, half3(0.2126, 0.7152, 0.0722));
}

half3 lookupLut(half3 color) {
  float3 scaled = float3(clamp(color, 0.0, 1.0)) * (lutSize - 1.0);
  float blue0 = floor(scaled.b);
  float blue1 = min(lutSize - 1.0, blue0 + 1.0);
  float2 first = float2(blue0 * lutSize + scaled.r + 0.5, scaled.g + 0.5);
  float2 second = float2(blue1 * lutSize + scaled.r + 0.5, scaled.g + 0.5);
  half3 mapped = mix(lut.eval(first).rgb, lut.eval(second).rgb, half(fract(scaled.b)));
  return mix(color, mapped, half(lutIntensity));
}

half3 grade(float2 position) {
  half3 source = image.eval(clamp(position, float2(0), imageSize - float2(1))).rgb;
  source = clamp(source * half(exp2(exposureEv)), 0.0, 1.0);
  return lookupLut(source);
}

float noise(float2 position) {
  float scale = mix(0.55, 2.8, grainSize);
  float2 cell = floor(position / scale);
  float base = fract(sin(dot(cell + seed, float2(12.9898, 78.233))) * 43758.5453);
  float coarse = fract(sin(dot(floor(cell * 0.37) + seed * 1.7, float2(39.3468, 11.135))) * 24634.6345);
  return mix(base, coarse, grainRoughness) - 0.5;
}

half4 main(float2 xy) {
  half4 original = image.eval(xy);
  half3 color = grade(xy);

  float radius = 1.0 + max(halationRadius, bloomRadius) * 14.0;
  half3 blurred = (
    grade(xy + float2(radius, 0)) + grade(xy - float2(radius, 0)) +
    grade(xy + float2(0, radius)) + grade(xy - float2(0, radius)) +
    grade(xy + float2(radius, radius)) + grade(xy + float2(-radius, radius)) +
    grade(xy + float2(radius, -radius)) + grade(xy - float2(radius, radius))
  ) * half(0.125);
  half highlight = smoothstep(half(0.55), half(0.98), luminance(blurred));
  color += blurred * highlight * half(bloomAmount * 0.35);
  half3 redGlow = half3(1.0, 0.24, 0.08) * max(half3(0), blurred - color);
  color += redGlow * highlight * half(halationAmount * 0.75);

  color += half(noise(xy) * grainAmount * 0.16);
  color += (color - blurred) * half(sharpnessAmount * 0.65);

  float2 normalized = (xy / imageSize) * 2.0 - 1.0;
  float edge = smoothstep(0.28, 1.35, dot(normalized, normalized));
  color *= half(1.0 - edge * vignetteAmount * 0.72);
  return half4(clamp(color, 0.0, 1.0), original.a);
}
`

const LUT_EFFECT = Skia.RuntimeEffect.Make(LUT_EFFECT_SOURCE)
if (!LUT_EFFECT) console.error('Momints LUT shader failed to compile on this device')

function decodeImage(bytes: Uint8Array): SkImage {
  const data = Skia.Data.fromBytes(bytes)
  try {
    const image = Skia.Image.MakeImageFromEncoded(data)
    if (!image) throw new Error('Captured image could not be decoded')
    return image
  } finally {
    data.dispose()
  }
}

function normalizeToSrgb(image: SkImage): SkImage {
  // Skia's CPU surface is explicitly sRGB. Drawing a decoded image into it
  // color-matches embedded ICC/P3 profiles and clamps extended-range input to
  // the SDR RGBA8888 destination before the GPU film pass.
  const surface = Skia.Surface.Make(image.width(), image.height())
  if (!surface) throw new Error('sRGB normalization surface could not be created')
  try {
    surface.getCanvas().drawImage(image, 0, 0)
    surface.flush()
    return surface.makeImageSnapshot()
  } finally {
    surface.dispose()
  }
}

function outputFile(source: File, filmStockId: string): File {
  return new File(source.parentDirectory, `photo_${uuidv4()}_${filmStockId}.jpg`)
}

function removeSource(source: File): void {
  deleteCapture(source.uri)
}

function encodeSnapshotToBudget(destination: File, snapshot: SkImage): boolean {
  for (const quality of JPEG_QUALITIES) {
    const encoded = snapshot.encodeToBytes(ImageFormat.JPEG, quality)
    if (encoded.length <= PERMANENT_IMAGE_TARGET_BYTES) {
      destination.write(encoded)
      return true
    }
  }
  return false
}

function encodeSurface(destination: File, image: ReturnType<typeof Skia.Surface.MakeOffscreen>): string {
  if (!image) throw new Error('Film processing surface could not be created')
  try {
    image.flush()
    const snapshot = image.makeImageSnapshot()
    try {
      if (encodeSnapshotToBudget(destination, snapshot)) return destination.uri

      const longEdge = Math.max(snapshot.width(), snapshot.height())
      for (const edge of RESIZE_LONG_EDGES) {
        if (edge >= longEdge) continue
        const scale = edge / longEdge
        const width = Math.max(1, Math.round(snapshot.width() * scale))
        const height = Math.max(1, Math.round(snapshot.height() * scale))
        const resizedSurface = Skia.Surface.MakeOffscreen(width, height)
        if (!resizedSurface) throw new Error('Film resize surface could not be created')
        const resizePaint = Skia.Paint()
        try {
          resizedSurface.getCanvas().drawImageRect(
            snapshot,
            Skia.XYWHRect(0, 0, snapshot.width(), snapshot.height()),
            Skia.XYWHRect(0, 0, width, height),
            resizePaint,
          )
          resizedSurface.flush()
          const resized = resizedSurface.makeImageSnapshot()
          try {
            const encoded = resized.encodeToBytes(ImageFormat.JPEG, JPEG_QUALITIES[JPEG_QUALITIES.length - 1])
            if (encoded.length <= PERMANENT_IMAGE_TARGET_BYTES) {
              destination.write(encoded)
              return destination.uri
            }
          } finally {
            resized.dispose()
          }
        } finally {
          resizePaint.dispose()
          resizedSurface.dispose()
        }
      }
      throw new Error(`Developed image could not fit below ${PERMANENT_IMAGE_TARGET_BYTES} bytes`)
    } finally {
      snapshot.dispose()
    }
  } finally {
    image.dispose()
  }
}

function applyLegacyMatrix(destination: File, image: SkImage, recipe: FilmStockRecipeV1): string {
  let surface = Skia.Surface.MakeOffscreen(image.width(), image.height())
  if (!surface) throw new Error('Film processing surface could not be created')
  const paint = Skia.Paint()
  const filter = Skia.ColorFilter.MakeMatrix(recipe.colorMatrix)
  try {
    paint.setColorFilter(filter)
    surface.getCanvas().drawImage(image, 0, 0, paint)
    const ownedSurface = surface
    surface = null
    // encodeSurface owns disposal from here, including encode failure.
    return encodeSurface(destination, ownedSurface)
  } finally {
    surface?.dispose()
    paint.dispose()
    filter.dispose()
  }
}

function runtimeLutImage(bytes: Uint8Array): { image: SkImage; size: number } {
  const runtime = parseRuntimeLut(bytes)
  const width = runtime.size * runtime.size
  const data = Skia.Data.fromBytes(runtime.pixels)
  try {
    const image = Skia.Image.MakeImage(
      {
        width,
        height: runtime.size,
        alphaType: AlphaType.Opaque,
        colorType: ColorType.RGBA_8888,
      },
      data,
      width * 4,
    )
    if (!image) throw new Error('Runtime LUT could not be uploaded to the GPU')
    return { image, size: runtime.size }
  } finally {
    data.dispose()
  }
}

function recipeUniforms(recipe: FilmStockRecipeV2, width: number, height: number, seed: number): number[] {
  return [
    recipe.lut.size,
    recipe.lut.intensity,
    recipe.exposure?.ev ?? 0,
    recipe.grain?.amount ?? 0,
    recipe.grain?.size ?? 0,
    recipe.grain?.roughness ?? 0,
    recipe.halation?.amount ?? 0,
    recipe.halation?.radius ?? 0,
    recipe.bloom?.amount ?? 0,
    recipe.bloom?.radius ?? recipe.halation?.radius ?? 0,
    recipe.sharpness?.amount ?? 0,
    recipe.vignette?.amount ?? 0,
    width,
    height,
    seed,
  ]
}

function runDevelopmentShaderProbe(): void {
  if (!LUT_EFFECT) return
  let source: SkImage | null = null
  let lutImage: SkImage | null = null
  let surface: ReturnType<typeof Skia.Surface.MakeOffscreen> = null
  try {
    source = Skia.Image.MakeImage(
      { width: 1, height: 1, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
      Skia.Data.fromBytes(new Uint8Array([64, 128, 192, 255])),
      4,
    )
    if (!source) throw new Error('Could not create probe source')

    const atlasWidth = LUT_SIZE * LUT_SIZE
    const lutPixels = new Uint8Array(LUT_SIZE ** 3 * 4)
    for (let blue = 0; blue < LUT_SIZE; blue += 1) {
      for (let green = 0; green < LUT_SIZE; green += 1) {
        for (let red = 0; red < LUT_SIZE; red += 1) {
          const offset = (green * atlasWidth + blue * LUT_SIZE + red) * 4
          lutPixels[offset] = Math.round((red / (LUT_SIZE - 1)) * 255)
          lutPixels[offset + 1] = Math.round((green / (LUT_SIZE - 1)) * 255)
          lutPixels[offset + 2] = Math.round((blue / (LUT_SIZE - 1)) * 255)
          lutPixels[offset + 3] = 255
        }
      }
    }
    lutImage = Skia.Image.MakeImage(
      { width: atlasWidth, height: LUT_SIZE, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
      Skia.Data.fromBytes(lutPixels),
      atlasWidth * 4,
    )
    if (!lutImage) throw new Error('Could not create probe LUT')

    const sourceShader = source.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None)
    const lutShader = lutImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None)
    const shader = LUT_EFFECT.makeShaderWithChildren(
      [LUT_SIZE, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
      [sourceShader, lutShader],
    )
    const paint = Skia.Paint()
    paint.setShader(shader)
    surface = Skia.Surface.MakeOffscreen(1, 1)
    if (!surface) throw new Error('Could not create probe GPU surface')
    surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 1, 1), paint)
    surface.flush()
    const snapshot = surface.makeImageSnapshot()
    try {
      if (snapshot.encodeToBytes(ImageFormat.PNG).length === 0) throw new Error('Probe produced no output')
    } finally {
      snapshot.dispose()
    }
    console.info('[filmstock] GPU LUT shader probe passed')
  } catch (error) {
    console.error('[filmstock] GPU LUT shader probe failed', error)
  } finally {
    surface?.dispose()
    lutImage?.dispose()
    source?.dispose()
  }
}

// Android uses the isolated native renderer, not the shared Skia GPU context.
if (__DEV__ && Platform.OS !== 'android') setTimeout(runDevelopmentShaderProbe, 0)

function applyLutRecipe(
  destination: File,
  seed: number,
  image: SkImage,
  recipe: FilmStockRecipeV2,
  runtimeBytes: Uint8Array,
): string {
  if (!LUT_EFFECT) throw new Error('This device could not compile the Momints film engine')
  const { image: lutImage } = runtimeLutImage(runtimeBytes)
  try {
    const sourceShader = image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None)
    const lutShader = lutImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None)
    const shader = LUT_EFFECT.makeShaderWithChildren(recipeUniforms(recipe, image.width(), image.height(), seed), [
      sourceShader,
      lutShader,
    ])
    const paint = Skia.Paint()
    let surface: ReturnType<typeof Skia.Surface.MakeOffscreen> = null
    try {
      paint.setShader(shader)
      surface = Skia.Surface.MakeOffscreen(image.width(), image.height())
      if (!surface) throw new Error('Film processing surface could not be created')
      const canvas = surface.getCanvas()

      // Tile draw commands avoid additional per-tile JavaScript pixel buffers.
      // The only full-resolution raster allocation beyond the decoded source is
      // the color-managed sRGB image consumed by the GPU surface.
      for (let y = 0; y < image.height(); y += TILE_SIZE) {
        for (let x = 0; x < image.width(); x += TILE_SIZE) {
          canvas.drawRect(
            Skia.XYWHRect(x, y, Math.min(TILE_SIZE, image.width() - x), Math.min(TILE_SIZE, image.height() - y)),
            paint,
          )
        }
      }
      const ownedSurface = surface
      surface = null
      return encodeSurface(destination, ownedSurface)
    } finally {
      surface?.dispose()
      paint.dispose()
      shader.dispose()
      sourceShader.dispose()
      lutShader.dispose()
    }
  } finally {
    lutImage.dispose()
  }
}

/**
 * Apply the immutable recipe pinned to a capture. Processing failure is fatal:
 * the app never mints an unprocessed image under a selected filmStockId.
 */
async function applyFilmSkia(
  uri: string,
  film: FilmSettings,
  filmPackage: Awaited<ReturnType<typeof loadFilmStockPackage>>,
  destination: File,
): Promise<string> {
  const source = new File(uri)
  try {
    const sourceBytes = await source.bytes()
    const seed =
      Number.parseInt(createHash('sha256').update(sourceBytes).digest().toString('hex').slice(0, 8), 16) % 100_000
    const decoded = decodeImage(sourceBytes)
    let image: SkImage
    try {
      image = normalizeToSrgb(decoded)
    } finally {
      decoded.dispose()
    }
    try {
      if (filmPackage.recipe.schemaVersion === 1) {
        return applyLegacyMatrix(destination, image, filmPackage.recipe)
      }
      if (!filmPackage.runtimeLutUri) throw new Error(`Film LUT ${film.filmStockId} is missing`)
      const runtimeBytes = await new File(filmPackage.runtimeLutUri).bytes()
      return applyLutRecipe(destination, seed, image, filmPackage.recipe, runtimeBytes)
    } finally {
      image.dispose()
    }
  } catch (error) {
    console.error(`applyFilm failed for ${film.filmStockId}:`, error)
    throw new Error(`Could not process ${film.filmStockId}`, { cause: error instanceof Error ? error : undefined })
  }
}

let processingTail: Promise<unknown> = Promise.resolve()

/** Serialize full-resolution work. Native failures never fall back to Skia/original. */
export function processFilm(uri: string, film: FilmSettings): Promise<FilmProcessingReceipt> {
  const selected = { ...film }
  const job = processingTail.then(() => processFilmOnce(uri, selected))
  processingTail = job.catch(() => {})
  return job
}

async function processFilmOnce(uri: string, film: FilmSettings): Promise<FilmProcessingReceipt> {
  const filmPackage = await loadFilmStockPackage(film.filmStockId)
  const source = new File(uri)
  const recipeJson = JSON.stringify(filmPackage.recipe)
  const recipeSha256 = sha256(recipeJson)
  const lutSha256 = filmPackage.recipe.schemaVersion === 2 ? filmPackage.recipe.lut.sha256 : null
  if (lutSha256 && !filmPackage.runtimeLutUri) throw new Error('Selected film LUT is missing')
  let destination: File | null = null
  let ownsDestination = false
  try {
    destination = outputFile(source, film.filmStockId)
    if (destination.exists) throw new Error('Film output path already exists')
    ownsDestination = true
    let receipt: FilmProcessingReceipt
    const renderer = Platform.OS === 'android' ? 'native-egl-v2' : 'skia-v2'
    if (Platform.OS === 'android') {
      const seed = Number.parseInt(sha256(await source.bytes()).slice(0, 8), 16) % 100_000
      receipt = await applyFilmNative({
        inputUri: uri,
        outputUri: destination.uri,
        filmStockId: film.filmStockId,
        recipeJson,
        recipeSha256,
        lutUri: filmPackage.runtimeLutUri ?? null,
        seed,
        jpegQuality: JPEG_QUALITY,
        jpegTargetBytes: PERMANENT_IMAGE_TARGET_BYTES,
      })
    } else {
      await applyFilmSkia(uri, film, filmPackage, destination)
      const bytes = await destination.bytes()
      receipt = {
        filmStockId: film.filmStockId,
        recipeSha256,
        lutSha256,
        outputUri: destination.uri,
        outputSha256: sha256(bytes),
        mime: 'image/jpeg',
        byteLength: bytes.length,
        ...jpegDimensions(bytes),
        renderer,
        colorSpace: 'sRGB',
      }
    }
    await verifyFilmOutput(receipt, {
      filmStockId: film.filmStockId,
      recipeSha256,
      lutSha256,
      outputUri: destination.uri,
      renderer,
    })
    removeSource(source)
    return receipt
  } catch (error) {
    // Delete only the destination chosen by this call, never a URI from an invalid receipt.
    try {
      if (ownsDestination && destination?.exists) destination.delete()
    } catch {
      /* Startup sweeps temporary outputs. */
    }
    throw new Error(`Could not process ${film.filmStockId}; the frame was not queued`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

/** Compatibility wrapper for existing callers; it still passes the verification gate. */
export async function applyFilm(uri: string, film: FilmSettings): Promise<string> {
  return (await processFilm(uri, film)).outputUri
}

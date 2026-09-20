import { Skia, ImageFormat, TileMode, FilterMode, MipmapMode } from '@shopify/react-native-skia'
import type { SkImage, SkRuntimeEffect } from '@shopify/react-native-skia'
import { File } from 'expo-file-system'
import { Asset } from 'expo-asset'
import { v4 as uuidv4 } from 'uuid'
import type { FilmSettings } from '../store/session'
import { getFilmStock, type FilmStockConfig } from '../config/filmStocks'
import {
  FILM_LUT_SIZE,
  FILM_LUT_STRIP_HEIGHT,
  FILM_LUT_STRIP_WIDTH,
  HALATION_HIGHLIGHT_END,
  HALATION_HIGHLIGHT_START,
  grainSeedForUri,
  scaledHalationRadius,
} from './filmRenderMath'

// Luminance-weighted grayscale color matrix (4x5, Rec. 601 coefficients)
// for fast fallback.
// prettier-ignore
const GRAYSCALE_MATRIX = [
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0,     0,     0,     1, 0,
]

const JPEG_QUALITY = 95

/**
 * SkSL runtime shader for analog film simulation:
 * 1. 3D LUT color grading (trilinear interpolation across 1024x32 strip)
 * 2. Halation bloom (red highlight scatter for configured stocks)
 * 3. B&W conversion (if stock or mode is monochrome)
 * 4. Procedural dye-cloud film grain (luminance-weighted midtone curve)
 */
export const FILM_SHADER_SKSL = `
uniform shader image;
uniform shader lut;
uniform float grainIntensity;
uniform float grainSize;
uniform float grainSeed;
uniform float halationIntensity;
uniform float halationRadius;
uniform float hasLut;
uniform float isBW;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 sampleLut(vec3 rgb) {
    rgb = clamp(rgb, 0.0, 1.0);
    float b = rgb.b * ${FILM_LUT_SIZE - 1}.0;
    float z0 = floor(b);
    float z1 = min(z0 + 1.0, ${FILM_LUT_SIZE - 1}.0);
    float f = b - z0;

    float y = 0.5 + rgb.g * ${FILM_LUT_SIZE - 1}.0;
    float r = 0.5 + rgb.r * ${FILM_LUT_SIZE - 1}.0;

    vec2 uv0 = vec2(z0 * ${FILM_LUT_SIZE}.0 + r, y);
    vec2 uv1 = vec2(z1 * ${FILM_LUT_SIZE}.0 + r, y);

    vec3 col0 = lut.eval(uv0).rgb;
    vec3 col1 = lut.eval(uv1).rgb;

    return mix(col0, col1, f);
}

float highlightWeight(vec3 color) {
    return smoothstep(${HALATION_HIGHLIGHT_START}, ${HALATION_HIGHLIGHT_END}, dot(color, vec3(0.299, 0.587, 0.114)));
}

vec4 main(vec2 coord) {
    vec4 base = image.eval(coord);
    vec3 color = base.rgb;

    // 1. 3D LUT Color Grading (spectral film emulsion profile)
    if (hasLut > 0.5) {
        color = sampleLut(color);
    }

    // 2. Halation pass (red highlight bloom around bright specular points)
    if (halationIntensity > 0.0) {
        float r = halationRadius;
        vec3 h1 = image.eval(coord + vec2(r, 0.0)).rgb;
        vec3 h2 = image.eval(coord - vec2(r, 0.0)).rgb;
        vec3 h3 = image.eval(coord + vec2(0.0, r)).rgb;
        vec3 h4 = image.eval(coord - vec2(0.0, r)).rgb;
        vec3 h5 = image.eval(coord + vec2(r * 0.707, r * 0.707)).rgb;
        vec3 h6 = image.eval(coord - vec2(r * 0.707, r * 0.707)).rgb;
        vec3 h7 = image.eval(coord + vec2(-r * 0.707, r * 0.707)).rgb;
        vec3 h8 = image.eval(coord + vec2(r * 0.707, -r * 0.707)).rgb;
        // Spread the highlight mask; averaging colors first erases isolated lights.
        float highlight = (highlightWeight(h1) + highlightWeight(h2) + highlightWeight(h3) + highlightWeight(h4)
                         + highlightWeight(h5) + highlightWeight(h6) + highlightWeight(h7) + highlightWeight(h8)) * 0.125;
        vec3 halationTint = vec3(1.0, 0.20, 0.05);
        color += halationTint * (highlight * halationIntensity);
    }

    // 3. Black & White conversion
    if (isBW > 0.5) {
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = vec3(gray, gray, gray);
    }

    // 4. Procedural Dye-Cloud Film Grain
    if (grainIntensity > 0.0) {
        vec2 seedOffset = vec2(grainSeed * 4096.0, grainSeed * 6627.328);
        vec2 grainCoord = (coord + seedOffset) / max(grainSize, 1.0);
        float n = noise(grainCoord) * 2.0 - 1.0;
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        float grainWeight = 4.0 * luma * (1.0 - luma);
        grainWeight = clamp(grainWeight, 0.1, 1.0);
        color += n * grainIntensity * grainWeight;
    }

    return vec4(clamp(color, 0.0, 1.0), base.a);
}
`

// Cache compiled runtime effect and decoded LUT textures in memory
let runtimeEffectInstance: SkRuntimeEffect | null = null
const lutImageCache = new Map<string, SkImage>()

function getRuntimeEffect(): SkRuntimeEffect | null {
  if (!runtimeEffectInstance) {
    runtimeEffectInstance = Skia.RuntimeEffect.Make(FILM_SHADER_SKSL)
    if (!runtimeEffectInstance) {
      console.warn('[filmProcessor] Failed to compile SkSL film shader')
    }
  }
  return runtimeEffectInstance
}

async function readImageBytes(uri: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(uri)) {
    const response = await fetch(uri, { headers: { 'Cache-Control': 'no-store' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`Image request failed (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
  return new File(uri).bytes()
}

async function getLutImage(stock: FilmStockConfig): Promise<SkImage | null> {
  if (!stock.lutAsset) return null
  const cacheKey = stock.id
  const cached = lutImageCache.get(cacheKey)
  if (cached) return cached

  try {
    const assets = await Asset.loadAsync(stock.lutAsset)
    const asset = assets[0]
    if (!asset) {
      console.warn(`[filmProcessor] LUT asset resolver returned no asset for ${stock.id}`)
      return null
    }
    const uri = asset.localUri ?? asset.uri
    const bytes = await readImageBytes(uri)
    const data = Skia.Data.fromBytes(bytes)
    let image: SkImage | null
    try {
      image = Skia.Image.MakeImageFromEncoded(data)
    } finally {
      data.dispose()
    }
    if (!image) {
      console.warn(`[filmProcessor] LUT image decode failed for ${stock.id}`)
      return null
    }

    if (image.width() !== FILM_LUT_STRIP_WIDTH || image.height() !== FILM_LUT_STRIP_HEIGHT) {
      console.warn(
        `[filmProcessor] Invalid LUT dimensions for ${stock.id}: ${image.width()}x${image.height()} ` +
          `(expected ${FILM_LUT_STRIP_WIDTH}x${FILM_LUT_STRIP_HEIGHT})`,
      )
      image.dispose()
      return null
    }

    lutImageCache.set(cacheKey, image)
    return image
  } catch (err) {
    console.warn(`[filmProcessor] Could not load LUT for stock ${stock.id}:`, err)
    return null
  }
}

/**
 * Returns true if the film configuration specifies active emulation
 * (non-standard stock, B&W conversion, or grain/halation).
 */
export function isFilmEmulationActive(film: FilmSettings): boolean {
  if (film.mode === 'bw') return true
  const stock = getFilmStock(film.stockId ?? 'standard-color')
  if (stock.id === 'standard-color') return false
  return true
}

/**
 * Applies a roll's film emulation to a captured JPEG at `uri`.
 *
 * Supports:
 *  - 3D LUT spectral film simulation (Portra 400, CineStill 800T, Velvia 50, Gold 200, Tri-X 400)
 *  - CineStill red halation highlight bloom
 *  - Organic procedural dye-cloud silver halide grain
 *  - Standard B&W conversion
 *
 * Defensive by design — if any step fails the original `uri` is returned so a
 * capture is never lost to a processing error.
 */
export async function applyFilm(uri: string, film: FilmSettings): Promise<string> {
  const stock = getFilmStock(film.stockId ?? (film.mode === 'bw' ? 'standard-bw' : 'standard-color'))

  // Standard color with no effects is a no-op
  if (stock.id === 'standard-color' && film.mode === 'color') {
    return uri
  }

  const resources: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(resource: T): T => {
    resources.push(resource)
    return resource
  }
  let pendingOutput: File | null = null
  try {
    const source = new File(uri)
    const bytes = await source.bytes()

    const data = own(Skia.Data.fromBytes(bytes))
    const image = Skia.Image.MakeImageFromEncoded(data)
    if (!image) {
      console.warn(`[filmProcessor] Source image decode failed; keeping original: ${uri}`)
      return uri
    }
    own(image)

    const width = image.width()
    const height = image.height()
    const surface = Skia.Surface.MakeOffscreen(width, height)
    if (!surface) {
      console.warn(`[filmProcessor] Could not allocate ${width}x${height} render surface; keeping original`)
      return uri
    }
    own(surface)

    const canvas = surface.getCanvas()
    const paint = own(Skia.Paint())

    const isStandardBW = stock.id === 'standard-bw' || (stock.id === 'standard-color' && film.mode === 'bw')

    if (isStandardBW) {
      paint.setColorFilter(own(Skia.ColorFilter.MakeMatrix(GRAYSCALE_MATRIX)))
      canvas.drawImage(image, 0, 0, paint)
    } else {
      const lutImage = await getLutImage(stock)
      if (stock.lutAsset && !lutImage) {
        console.warn(`[filmProcessor] Required LUT unavailable for ${stock.id}; keeping original`)
        return uri
      }

      const effect = getRuntimeEffect()
      if (!effect) {
        console.warn(`[filmProcessor] Film shader unavailable for ${stock.id}; keeping original`)
        return uri
      }

      const imageShader = own(
        image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
      )
      // If no LUT for this stock, pass imageShader as dummy second child with hasLut = 0
      const lutShader = lutImage
        ? own(lutImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None))
        : imageShader

      const grainIntensity = stock.grain.intensity
      const grainSize = stock.grain.size
      const grainSeed = grainSeedForUri(uri)
      const halationIntensity = stock.halation?.intensity ?? 0.0
      const halationRadius = scaledHalationRadius(stock.halation?.radius ?? 0.0, width, height)
      const hasLut = lutImage ? 1.0 : 0.0
      const isBW = stock.mode === 'bw' || film.mode === 'bw' ? 1.0 : 0.0

      const uniforms = [grainIntensity, grainSize, grainSeed, halationIntensity, halationRadius, hasLut, isBW]

      const filmShader = own(effect.makeShaderWithChildren(uniforms, [imageShader, lutShader]))
      paint.setShader(filmShader)
      canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint)
    }

    surface.flush()

    const snapshot = own(surface.makeImageSnapshot())
    const encoded = snapshot.encodeToBytes(ImageFormat.JPEG, JPEG_QUALITY)
    if (encoded.length === 0) {
      console.warn(`[filmProcessor] JPEG encoder returned no data for ${stock.id}; keeping original`)
      return uri
    }

    const photosDir = new File(uri).parentDirectory
    const destFile = new File(photosDir, `photo_${uuidv4()}_film.jpg`)
    // Reserve before writing: neither success nor failure cleanup may touch an
    // existing file, even if a generated name collides with a source or output.
    destFile.create({ overwrite: false })
    pendingOutput = destFile
    destFile.write(encoded)
    if (!destFile.exists || destFile.size !== encoded.length) {
      throw new Error('Film output is missing or incomplete')
    }
    pendingOutput = null

    // Replace: discard the original now that the developed version is saved
    try {
      source.delete()
    } catch {
      // Leaving a stray file is harmless; keep the film result.
    }

    console.log(`[filmProcessor] Developed frame with ${stock.name} (${stock.id}) -> ${destFile.uri}`)
    return destFile.uri
  } catch (error) {
    console.error('[filmProcessor] applyFilm failed, keeping original capture:', error)
    return uri
  } finally {
    if (pendingOutput) {
      try {
        if (pendingOutput.exists) pendingOutput.delete()
      } catch {
        // Keep the source even if removal of a partial output also fails.
      }
    }
    for (const resource of resources.reverse()) {
      try {
        resource.dispose()
      } catch {
        // Cleanup must not turn a saved result into a failed capture.
      }
    }
  }
}

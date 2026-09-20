export const FILM_LUT_SIZE = 32
export const FILM_LUT_STRIP_WIDTH = FILM_LUT_SIZE * FILM_LUT_SIZE
export const FILM_LUT_STRIP_HEIGHT = FILM_LUT_SIZE

export const HALATION_REFERENCE_SHORT_EDGE = 1080
export const HALATION_HIGHLIGHT_START = 0.7
export const HALATION_HIGHLIGHT_END = 0.98

export interface LutStripSample {
  x0: number
  x1: number
  y: number
  blueMix: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Returns the pixel-space coordinates used by the SkSL shader for a LUT whose
 * X axis is blue-slice * 32 + red and whose Y axis is green.
 */
export function getLutStripSample(red: number, green: number, blue: number): LutStripSample {
  const r = clamp01(red) * (FILM_LUT_SIZE - 1)
  const g = clamp01(green) * (FILM_LUT_SIZE - 1)
  const b = clamp01(blue) * (FILM_LUT_SIZE - 1)
  const z0 = Math.floor(b)
  const z1 = Math.min(z0 + 1, FILM_LUT_SIZE - 1)

  return {
    x0: z0 * FILM_LUT_SIZE + r + 0.5,
    x1: z1 * FILM_LUT_SIZE + r + 0.5,
    y: g + 0.5,
    blueMix: b - z0,
  }
}

export function rec601Luma(red: number, green: number, blue: number): number {
  return red * 0.299 + green * 0.587 + blue * 0.114
}

export function halationHighlightWeight(luma: number): number {
  const t = clamp01((luma - HALATION_HIGHLIGHT_START) / (HALATION_HIGHLIGHT_END - HALATION_HIGHLIGHT_START))
  return t * t * (3 - 2 * t)
}

/** Keep the configured radius visually proportional to the image's short edge. */
export function scaledHalationRadius(radiusAt1080: number, width: number, height: number): number {
  const shortEdge = Math.max(1, Math.min(width, height))
  return radiusAt1080 * (shortEdge / HALATION_REFERENCE_SHORT_EDGE)
}

/**
 * Stable FNV-1a-derived seed. A capture URI produces the same grain on retry,
 * while independently captured files normally receive different patterns.
 */
export function grainSeedForUri(uri: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < uri.length; index += 1) {
    hash ^= uri.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) / 0xffffffff
}

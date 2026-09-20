import { createHash } from 'node:crypto'

export const FILMSTOCK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/
export const CUBE_SIZE = 33
export const LUT_MAGIC = 'MOMLUT01'
export const LUT_HEADER_BYTES = 16

const finite = (value) => Number.isFinite(value)
const close = (a, b) => Math.abs(a - b) < 1e-9

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parseCube(text, expectedSize = CUBE_SIZE) {
  let size = null
  let domainMin = [0, 0, 0]
  let domainMax = [1, 1, 1]
  const values = []

  for (const [index, rawLine] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const [keyword, ...parts] = line.match(/"[^"]*"|\S+/g) ?? []
    if (keyword === 'TITLE') continue
    if (keyword === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported')
    if (keyword === 'LUT_3D_SIZE') {
      if (size !== null) throw new Error('LUT_3D_SIZE may only appear once')
      size = Number(parts[0])
      if (!Number.isInteger(size) || size !== expectedSize) {
        throw new Error(`LUT_3D_SIZE must be ${expectedSize}`)
      }
      continue
    }
    if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      if (parts.length !== 3) throw new Error(`${keyword} must contain three values`)
      const parsed = parts.map(Number)
      if (parsed.some((value) => !finite(value))) throw new Error(`${keyword} contains a non-finite value`)
      if (keyword === 'DOMAIN_MIN') domainMin = parsed
      else domainMax = parsed
      continue
    }
    if (/^[A-Z_]+$/.test(keyword)) throw new Error(`Unsupported CUBE keyword ${keyword} on line ${index + 1}`)
    const triplet = [keyword, ...parts].map(Number)
    if (triplet.length !== 3 || triplet.some((value) => !finite(value))) {
      throw new Error(`Malformed LUT sample on line ${index + 1}`)
    }
    if (triplet.some((value) => value < 0 || value > 1)) {
      throw new Error(`LUT output must remain in the 0–1 sRGB range (line ${index + 1})`)
    }
    values.push(triplet)
  }

  if (size === null) throw new Error('Missing LUT_3D_SIZE')
  if (!domainMin.every((value) => close(value, 0)) || !domainMax.every((value) => close(value, 1))) {
    throw new Error('Momints LUTs require DOMAIN_MIN 0 0 0 and DOMAIN_MAX 1 1 1')
  }
  const expectedSamples = size ** 3
  if (values.length !== expectedSamples) {
    throw new Error(`Expected ${expectedSamples} LUT samples, found ${values.length}`)
  }
  return { size, domainMin, domainMax, values }
}

/**
 * Compile R-fastest, then G, then B CUBE rows into a 2D RGBA8 atlas. Each
 * blue plane is a size×size tile laid left-to-right; the runtime shader does
 * bilinear R/G sampling plus linear interpolation between B planes.
 */
export function compileRuntimeLut(cube) {
  const width = cube.size * cube.size
  const height = cube.size
  const pixels = Buffer.alloc(width * height * 4)
  for (let blue = 0; blue < cube.size; blue += 1) {
    for (let green = 0; green < cube.size; green += 1) {
      for (let red = 0; red < cube.size; red += 1) {
        const sourceIndex = blue * cube.size * cube.size + green * cube.size + red
        const destinationIndex = (green * width + blue * cube.size + red) * 4
        const sample = cube.values[sourceIndex]
        pixels[destinationIndex] = Math.round(sample[0] * 255)
        pixels[destinationIndex + 1] = Math.round(sample[1] * 255)
        pixels[destinationIndex + 2] = Math.round(sample[2] * 255)
        pixels[destinationIndex + 3] = 255
      }
    }
  }
  const header = Buffer.alloc(LUT_HEADER_BYTES)
  header.write(LUT_MAGIC, 0, 'ascii')
  header.writeUInt16LE(cube.size, 8)
  header.writeUInt16LE(4, 10)
  header.writeUInt32LE(pixels.length, 12)
  return Buffer.concat([header, pixels])
}

export function parseRuntimeLut(bytes) {
  const buffer = Buffer.from(bytes)
  if (buffer.length < LUT_HEADER_BYTES || buffer.subarray(0, 8).toString('ascii') !== LUT_MAGIC) {
    throw new Error('Invalid Momints runtime LUT header')
  }
  const size = buffer.readUInt16LE(8)
  const channels = buffer.readUInt16LE(10)
  const length = buffer.readUInt32LE(12)
  if (size !== CUBE_SIZE || channels !== 4 || length !== size ** 3 * channels) {
    throw new Error('Unsupported Momints runtime LUT dimensions')
  }
  if (buffer.length !== LUT_HEADER_BYTES + length) throw new Error('Incomplete Momints runtime LUT')
  return { size, width: size * size, height: size, pixels: buffer.subarray(LUT_HEADER_BYTES) }
}

export function sampleCubeTrilinear(cube, rgb) {
  const scaled = rgb.map((value) => Math.min(1, Math.max(0, value)) * (cube.size - 1))
  const low = scaled.map(Math.floor)
  const high = low.map((value) => Math.min(cube.size - 1, value + 1))
  const fraction = scaled.map((value, channel) => value - low[channel])
  const at = (red, green, blue) => cube.values[blue * cube.size * cube.size + green * cube.size + red]
  const mix = (a, b, amount) => a.map((value, channel) => value + (b[channel] - value) * amount)
  const z0y0 = mix(at(low[0], low[1], low[2]), at(high[0], low[1], low[2]), fraction[0])
  const z0y1 = mix(at(low[0], high[1], low[2]), at(high[0], high[1], low[2]), fraction[0])
  const z1y0 = mix(at(low[0], low[1], high[2]), at(high[0], low[1], high[2]), fraction[0])
  const z1y1 = mix(at(low[0], high[1], high[2]), at(high[0], high[1], high[2]), fraction[0])
  return mix(mix(z0y0, z0y1, fraction[1]), mix(z1y0, z1y1, fraction[1]), fraction[2])
}

export function analyzeCube(cube) {
  let clippedInteriorComponents = 0
  let quantizedAdjacentMatches = 0
  for (let blue = 0; blue < cube.size; blue += 1) {
    for (let green = 0; green < cube.size; green += 1) {
      for (let red = 0; red < cube.size; red += 1) {
        const index = blue * cube.size * cube.size + green * cube.size + red
        const sample = cube.values[index]
        if (red > 0 && red < cube.size - 1 && green > 0 && green < cube.size - 1 && blue > 0 && blue < cube.size - 1) {
          clippedInteriorComponents += sample.filter((value) => value <= 0 || value >= 1).length
        }
        if (red > 0) {
          const previous = cube.values[index - 1]
          if (sample.every((value, channel) => Math.round(value * 255) === Math.round(previous[channel] * 255))) {
            quantizedAdjacentMatches += 1
          }
        }
      }
    }
  }
  const warnings = []
  if (clippedInteriorComponents > 0) warnings.push(`${clippedInteriorComponents} interior components clip at 0 or 1`)
  if (quantizedAdjacentMatches > cube.size ** 2) {
    warnings.push(
      `${quantizedAdjacentMatches} adjacent red-axis samples collapse at 8-bit precision; inspect gradients`,
    )
  }
  return { clippedInteriorComponents, quantizedAdjacentMatches, warnings }
}

function boundedNumber(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !finite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

export function validateLutRecipe(raw, expectedId) {
  if (!raw || typeof raw !== 'object') throw new Error('recipe.json must be an object')
  if (raw.filmStockId !== expectedId || !FILMSTOCK_ID.test(raw.filmStockId)) {
    throw new Error('recipe.json filmStockId does not match its package directory')
  }
  if (raw.schemaVersion !== 2 || raw.inputColorSpace !== 'sRGB' || raw.outputColorSpace !== 'sRGB') {
    throw new Error('LUT recipes require schemaVersion 2 with sRGB input and output')
  }
  if (!raw.lut || raw.lut.format !== 'momints-lut' || raw.lut.size !== CUBE_SIZE) {
    throw new Error(`recipe.json requires a ${CUBE_SIZE}-point momints-lut`)
  }
  boundedNumber(raw.lut.intensity, 'lut.intensity', 0, 1)
  boundedNumber(raw.exposure?.ev ?? 0, 'exposure.ev', -2, 2)
  boundedNumber(raw.grain?.amount ?? 0, 'grain.amount', 0, 1)
  boundedNumber(raw.grain?.size ?? 0, 'grain.size', 0, 1)
  boundedNumber(raw.grain?.roughness ?? 0, 'grain.roughness', 0, 1)
  boundedNumber(raw.halation?.amount ?? 0, 'halation.amount', 0, 1)
  boundedNumber(raw.halation?.radius ?? 0, 'halation.radius', 0, 1)
  boundedNumber(raw.bloom?.amount ?? 0, 'bloom.amount', 0, 1)
  boundedNumber(raw.bloom?.radius ?? raw.halation?.radius ?? 0, 'bloom.radius', 0, 1)
  boundedNumber(raw.sharpness?.amount ?? 0, 'sharpness.amount', -1, 1)
  boundedNumber(raw.vignette?.amount ?? 0, 'vignette.amount', 0, 1)
  if (!Number.isInteger(raw.minimumEngineVersion) || raw.minimumEngineVersion < 2) {
    throw new Error('LUT recipes require minimumEngineVersion 2 or newer')
  }
  return raw
}

export function validateAttribution(text) {
  if (!/^Creator:\s*\S.+$/im.test(text)) throw new Error('attribution.txt must contain Creator:')
  if (!/^Source:\s*\S.+$/im.test(text)) throw new Error('attribution.txt must contain Source:')
  if (!/^Licence:\s*\S.+$/im.test(text)) throw new Error('attribution.txt must contain Licence:')
  if (!/^Commercial use:\s*(yes|permitted)$/im.test(text)) {
    throw new Error('attribution.txt must explicitly permit commercial use')
  }
  if (!/^Redistribution:\s*(yes|permitted)$/im.test(text)) {
    throw new Error('attribution.txt must explicitly permit redistribution')
  }
}

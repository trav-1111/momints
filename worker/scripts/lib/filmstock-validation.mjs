import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'

export const REQUIRED_TEST_TAGS = [
  'direct-sunlight',
  'overcast-daylight',
  'golden-hour',
  'tungsten',
  'mixed-lighting',
  'foliage',
  'blue-sky',
  'neutral-interior',
  'deep-shadows',
  'specular-highlights',
  'saturated-objects',
  'neutrals',
  'colour-chart',
  'gradients',
]

export function validateTestManifest(raw) {
  if (!raw || !Array.isArray(raw.images) || raw.images.length === 0) {
    throw new Error('Canonical test manifest requires a non-empty images array')
  }
  const tagCounts = new Map()
  for (const image of raw.images) {
    if (!image || typeof image.file !== 'string' || !Array.isArray(image.tags)) {
      throw new Error('Each canonical test image requires file and tags')
    }
    if (isAbsolute(image.file) || relative('.', image.file).startsWith('..')) {
      throw new Error(`Canonical test image escapes its directory: ${image.file}`)
    }
    if (image.tags.some((tag) => typeof tag !== 'string')) throw new Error(`${image.file} has invalid tags`)
    for (const tag of new Set(image.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const missing = REQUIRED_TEST_TAGS.filter((tag) => !tagCounts.has(tag))
  if (missing.length > 0) throw new Error(`Canonical test manifest is missing coverage: ${missing.join(', ')}`)
  if ((tagCounts.get('skin-tone') ?? 0) < 3) {
    throw new Error('Canonical test manifest requires at least three skin-tone images')
  }
  return raw
}

function sampleInto(lut, size, red, green, blue, output, offset) {
  const maximum = size - 1
  const x = (red / 255) * maximum
  const y = (green / 255) * maximum
  const z = (blue / 255) * maximum
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const x1 = Math.min(maximum, x0 + 1)
  const y1 = Math.min(maximum, y0 + 1)
  const z1 = Math.min(maximum, z0 + 1)
  const fx = x - x0
  const fy = y - y0
  const fz = z - z0
  const plane = size * size
  const p000 = (z0 * plane + y0 * size + x0) * 3
  const p100 = (z0 * plane + y0 * size + x1) * 3
  const p010 = (z0 * plane + y1 * size + x0) * 3
  const p110 = (z0 * plane + y1 * size + x1) * 3
  const p001 = (z1 * plane + y0 * size + x0) * 3
  const p101 = (z1 * plane + y0 * size + x1) * 3
  const p011 = (z1 * plane + y1 * size + x0) * 3
  const p111 = (z1 * plane + y1 * size + x1) * 3
  let clipped = 0
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = lut[p000 + channel]
    const c100 = lut[p100 + channel]
    const c010 = lut[p010 + channel]
    const c110 = lut[p110 + channel]
    const c001 = lut[p001 + channel]
    const c101 = lut[p101 + channel]
    const c011 = lut[p011 + channel]
    const c111 = lut[p111 + channel]
    const z0Value = (c000 + (c100 - c000) * fx) * (1 - fy) + (c010 + (c110 - c010) * fx) * fy
    const z1Value = (c001 + (c101 - c001) * fx) * (1 - fy) + (c011 + (c111 - c011) * fx) * fy
    const value = Math.round((z0Value + (z1Value - z0Value) * fz) * 255)
    output[offset + channel] = value
    if (value <= 1 || value >= 254) clipped += 1
  }
  return clipped
}

function comparisonBuffer(original, processed, width, height) {
  const rowBytes = width * 3
  const comparison = Buffer.alloc(rowBytes * 2 * height)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * rowBytes
    const destinationOffset = row * rowBytes * 2
    original.copy(comparison, destinationOffset, sourceOffset, sourceOffset + rowBytes)
    processed.copy(comparison, destinationOffset + rowBytes, sourceOffset, sourceOffset + rowBytes)
  }
  return comparison
}

export async function validateCanonicalImages({ cube, filmStockId, testRoot, outputRoot }) {
  const manifest = validateTestManifest(JSON.parse(await readFile(join(testRoot, 'manifest.json'), 'utf8')))
  await mkdir(outputRoot, { recursive: true })
  const results = []
  const warnings = []
  const lut = Float32Array.from(cube.values.flat())

  for (const entry of manifest.images) {
    const imagePath = resolve(testRoot, entry.file)
    const inside = relative(resolve(testRoot), imagePath)
    if (inside.startsWith('..') || isAbsolute(inside))
      throw new Error(`Test image escapes canonical root: ${entry.file}`)
    const { data, info } = await sharp(imagePath)
      .rotate()
      .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new Error(`${entry.file} could not be normalized to sRGB RGB`)

    const processed = Buffer.alloc(data.length)
    let clippedComponents = 0
    const gradientColours = new Set()
    for (let offset = 0; offset < data.length; offset += 3) {
      clippedComponents += sampleInto(
        lut,
        cube.size,
        data[offset],
        data[offset + 1],
        data[offset + 2],
        processed,
        offset,
      )
      if (entry.tags.includes('gradients')) {
        gradientColours.add(`${processed[offset]},${processed[offset + 1]},${processed[offset + 2]}`)
      }
    }

    const clippingRatio = clippedComponents / data.length
    if (clippingRatio > 0.15)
      warnings.push(`${entry.file}: ${(clippingRatio * 100).toFixed(1)}% of output components clip`)
    if (entry.tags.includes('gradients') && gradientColours.size < 96) {
      warnings.push(`${entry.file}: only ${gradientColours.size} distinct gradient colours; inspect for banding`)
    }

    const stem = basename(entry.file, extname(entry.file))
      .replace(/[^a-z0-9-]+/gi, '-')
      .toLowerCase()
    const comparisonName = `${stem}-comparison.jpg`
    await sharp(comparisonBuffer(data, processed, info.width, info.height), {
      raw: { width: info.width * 2, height: info.height, channels: 3 },
    })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toFile(join(outputRoot, comparisonName))
    results.push({ file: entry.file, tags: entry.tags, clippingRatio, comparison: comparisonName })
  }

  const report = { filmStockId, generatedAt: new Date().toISOString(), results, warnings }
  await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

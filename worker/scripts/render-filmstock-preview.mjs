import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { parseCube, sampleCubeTrilinear } from './lib/filmstock-package.mjs'

const [sourceArgument, cubeArgument, outputArgument] = process.argv.slice(2)
if (!sourceArgument || !cubeArgument || !outputArgument) {
  throw new Error('Usage: node scripts/render-filmstock-preview.mjs <source-image> <cube> <output-jpeg>')
}

const cube = parseCube(await readFile(resolve(cubeArgument), 'utf8'))
const { data, info } = await sharp(resolve(sourceArgument))
  .rotate()
  .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
  .toColourspace('srgb')
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
if (info.channels !== 3) throw new Error('Preview source must normalize to three-channel sRGB')

const output = Buffer.alloc(data.length)
for (let offset = 0; offset < data.length; offset += 3) {
  const graded = sampleCubeTrilinear(cube, [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255])
  for (let channel = 0; channel < 3; channel += 1) {
    output[offset + channel] = Math.round(graded[channel] * 255)
  }
}

await sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } })
  .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
  .toFile(resolve(outputArgument))
console.log(`Rendered ${info.width}x${info.height} LUT preview to ${resolve(outputArgument)}`)

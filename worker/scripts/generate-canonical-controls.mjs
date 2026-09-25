import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const outputRoot = process.argv[2] && resolve(process.argv[2])
if (!outputRoot) throw new Error('Usage: node scripts/generate-canonical-controls.mjs <private-output-directory>')
await mkdir(outputRoot, { recursive: true })

const patches = [
  ...[0, 36, 73, 109, 146, 182, 219, 255].map((level) => [level, level, level]),
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 128, 0],
  [128, 0, 255],
  [238, 205, 175],
  [210, 167, 132],
  [182, 125, 94],
  [143, 85, 58],
  [101, 61, 43],
  [76, 46, 34],
  [228, 185, 153],
  [174, 130, 100],
  [37, 70, 41],
  [73, 106, 55],
  [113, 139, 72],
  [160, 164, 90],
  [45, 96, 155],
  [76, 148, 195],
  [124, 194, 213],
  [206, 221, 219],
  [191, 36, 46],
  [227, 90, 45],
  [243, 159, 59],
  [241, 207, 75],
  [159, 41, 133],
  [207, 79, 159],
  [55, 121, 111],
  [41, 52, 121],
  [9, 8, 12],
  [18, 22, 28],
  [29, 25, 22],
  [44, 40, 44],
  [224, 226, 229],
  [237, 230, 218],
  [235, 239, 229],
  [250, 250, 250],
]

function pixel(buffer, width, x, y, rgb) {
  const offset = (y * width + x) * 3
  buffer[offset] = rgb[0]
  buffer[offset + 1] = rgb[1]
  buffer[offset + 2] = rgb[2]
}

const chartWidth = 1200
const chartHeight = 900
const chart = Buffer.alloc(chartWidth * chartHeight * 3, 32)
const patchWidth = 120
const patchHeight = 120
const gap = 12
const originX = 78
const originY = 60
for (let index = 0; index < patches.length; index += 1) {
  const x0 = originX + (index % 8) * (patchWidth + gap)
  const y0 = originY + Math.floor(index / 8) * (patchHeight + gap)
  for (let y = y0; y < y0 + patchHeight; y += 1) {
    for (let x = x0; x < x0 + patchWidth; x += 1) pixel(chart, chartWidth, x, y, patches[index])
  }
}
await sharp(chart, { raw: { width: chartWidth, height: chartHeight, channels: 3 } })
  .withIccProfile('srgb')
  .png({ compressionLevel: 9 })
  .toFile(join(outputRoot, 'colour-chart-srgb.png'))

const gradientWidth = 1200
const gradientHeight = 600
const gradients = Buffer.alloc(gradientWidth * gradientHeight * 3)
for (let y = 0; y < gradientHeight; y += 1) {
  const band = Math.floor(y / 100)
  for (let x = 0; x < gradientWidth; x += 1) {
    const t = x / (gradientWidth - 1)
    const ramp = Math.round(t * 255)
    const rgb = [
      [ramp, ramp, ramp],
      [ramp, 0, 0],
      [0, ramp, 0],
      [0, 0, ramp],
      [Math.round(32 + t * 192), Math.round(24 + t * 204), Math.round(20 + t * 212)],
      [Math.round(22 + t * 192), Math.round(77 + t * 161), Math.round(147 + t * 100)],
    ][band]
    pixel(gradients, gradientWidth, x, y, rgb)
  }
}
await sharp(gradients, { raw: { width: gradientWidth, height: gradientHeight, channels: 3 } })
  .withIccProfile('srgb')
  .png({ compressionLevel: 9 })
  .toFile(join(outputRoot, 'controlled-gradients-srgb.png'))

await writeFile(
  join(outputRoot, 'control-reference.json'),
  `${JSON.stringify(
    {
      note: 'Generated digital sRGB controls test LUT behavior, not camera-chart capture or skin rendering.',
      chart: { file: 'colour-chart-srgb.png', width: chartWidth, height: chartHeight, patches },
      gradients: { file: 'controlled-gradients-srgb.png', width: gradientWidth, height: gradientHeight },
    },
    null,
    2,
  )}\n`,
)
console.log(`Generated sRGB chart and gradients in ${outputRoot}`)

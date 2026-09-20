'use strict'

const fs = require('node:fs')
const zlib = require('node:zlib')

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

function decodeRgbPng(filename) {
  const encoded = fs.readFileSync(filename)
  assertPngSignature(encoded)

  let offset = 8
  let width = 0
  let height = 0
  const compressed = []

  while (offset < encoded.length) {
    const length = encoded.readUInt32BE(offset)
    const type = encoded.toString('ascii', offset + 4, offset + 8)
    const data = encoded.subarray(offset + 8, offset + 8 + length)
    offset += length + 12

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error(`${filename} must be an 8-bit, non-interlaced RGB PNG`)
      }
    } else if (type === 'IDAT') {
      compressed.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  const bytesPerPixel = 3
  const stride = width * bytesPerPixel
  const filtered = zlib.inflateSync(Buffer.concat(compressed))
  const pixels = Buffer.alloc(width * height * bytesPerPixel)

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)]
    const rowStart = y * stride
    const sourceStart = y * (stride + 1) + 1
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceStart + x]
      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[rowStart + x - stride] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[rowStart + x - stride - bytesPerPixel] : 0
      let value
      if (filter === 0) value = raw
      else if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + Math.floor((left + up) / 2)
      else if (filter === 4) value = raw + paeth(left, up, upLeft)
      else throw new Error(`${filename} uses unsupported PNG filter ${filter}`)
      pixels[rowStart + x] = value & 0xff
    }
  }

  return { width, height, pixels }
}

function assertPngSignature(buffer) {
  const expected = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== expected) throw new Error('Invalid PNG signature')
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 3
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]]
}

module.exports = { decodeRgbPng, pixelAt }

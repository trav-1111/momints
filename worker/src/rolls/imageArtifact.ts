import { HttpError } from '../lib/http'
import {
  PERMANENT_IMAGE_MAX_BYTES,
  PERMANENT_IMAGE_MAX_LONG_EDGE,
  PERMANENT_IMAGE_MAX_PIXELS,
  PERMANENT_IMAGE_MIME,
} from './config'

export const LEGACY_ROLL_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export interface VerifiedFrameArtifact {
  mime: typeof PERMANENT_IMAGE_MIME
  byteLength: number
  width: number
  height: number
  imageHash: string
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new HttpError(400, 'Roll frames must contain JPEG bytes')
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new HttpError(400, 'Roll frame JPEG is truncated or has trailing bytes')
  }

  let offset = 2
  let dimensions: { width: number; height: number } | null = null
  while (offset + 1 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new HttpError(400, 'Roll frame JPEG has an invalid segment marker')
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) throw new HttpError(400, 'Roll frame JPEG has a truncated segment')
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new HttpError(400, 'Roll frame JPEG has an invalid segment length')
    }
    if (marker === 0xda) {
      if (segmentLength < 6 || !dimensions) {
        throw new HttpError(400, 'Roll frame JPEG has an invalid scan header')
      }
      return dimensions
    }
    if (isStartOfFrame(marker)) {
      if (segmentLength < 7) throw new HttpError(400, 'Roll frame JPEG has a truncated frame header')
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      if (width <= 0 || height <= 0) throw new HttpError(400, 'Roll frame JPEG has invalid dimensions')
      dimensions = { width, height }
    }
    offset += segmentLength
  }
  throw new HttpError(400, 'Roll frame JPEG does not contain a complete image scan')
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyFrameArtifact(bytes: Uint8Array, protocolVersion: number): Promise<VerifiedFrameArtifact> {
  const maximumBytes = protocolVersion >= 2 ? PERMANENT_IMAGE_MAX_BYTES : LEGACY_ROLL_IMAGE_MAX_BYTES
  if (bytes.byteLength === 0) throw new HttpError(400, 'Empty image body')
  if (bytes.byteLength > maximumBytes) {
    throw new HttpError(413, `Roll frame is ${bytes.byteLength} bytes; maximum is ${maximumBytes}`)
  }
  const { width, height } = jpegDimensions(bytes)
  if (width * height > PERMANENT_IMAGE_MAX_PIXELS || Math.max(width, height) > PERMANENT_IMAGE_MAX_LONG_EDGE) {
    throw new HttpError(
      413,
      `Roll frame dimensions ${width}x${height} exceed the ${PERMANENT_IMAGE_MAX_PIXELS}-pixel, ` +
        `${PERMANENT_IMAGE_MAX_LONG_EDGE}-pixel-edge contract`,
    )
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    mime: PERMANENT_IMAGE_MIME,
    byteLength: bytes.byteLength,
    width,
    height,
    imageHash: hex(new Uint8Array(digest)),
  }
}

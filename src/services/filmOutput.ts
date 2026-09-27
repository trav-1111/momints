import { createHash } from 'react-native-quick-crypto'
import { File } from 'expo-file-system'
import type { FilmProcessingReceipt } from '../../modules/film-gl'

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest().toString('hex')
}

/** Inspect JPEG dimensions without allocating a second full-resolution bitmap. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217
  ) {
    throw new Error('Film output is not a complete JPEG')
  }
  let offset = 2
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 255) break
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 218 || marker === 217) break
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue
    const length = bytes[offset] * 256 + bytes[offset + 1]
    if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length - 2) break
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4]
      const width = bytes[offset + 5] * 256 + bytes[offset + 6]
      if (width > 0 && height > 0) return { width, height }
      break
    }
    offset += length
  }
  throw new Error('Film output has invalid JPEG dimensions')
}

/** The receipt binds a completed render to the exact package and encoded artifact.
 * This is NOT a substitute for golden-image/device validation of the shader.
 */
export async function verifyFilmOutput(
  receipt: FilmProcessingReceipt,
  expected: Pick<FilmProcessingReceipt, 'filmStockId' | 'recipeSha256' | 'lutSha256' | 'outputUri' | 'renderer'>,
): Promise<FilmProcessingReceipt> {
  if (
    !receipt ||
    receipt.filmStockId !== expected.filmStockId ||
    receipt.recipeSha256 !== expected.recipeSha256 ||
    receipt.lutSha256 !== expected.lutSha256 ||
    receipt.outputUri !== expected.outputUri ||
    receipt.renderer !== expected.renderer ||
    receipt.colorSpace !== 'sRGB' ||
    !/^[a-f0-9]{64}$/.test(receipt.outputSha256)
  ) {
    throw new Error('Film processing receipt does not match the selected package')
  }
  const bytes = await new File(expected.outputUri).bytes()
  const size = jpegDimensions(bytes)
  if (size.width !== receipt.width || size.height !== receipt.height || sha256(bytes) !== receipt.outputSha256) {
    throw new Error('Film output failed integrity or dimension verification')
  }
  return receipt
}

/** Quick-shot compression may resize/re-encode ONLY an already verified result. */
export async function verifyCompressedFilmOutput(
  receipt: FilmProcessingReceipt,
  outputUri: string,
): Promise<FilmProcessingReceipt> {
  if (outputUri === receipt.outputUri) return verifyFilmOutput(receipt, receipt)
  const bytes = await new File(outputUri).bytes()
  const size = jpegDimensions(bytes)
  if (
    size.width > receipt.width ||
    size.height > receipt.height ||
    Math.abs(size.width / size.height - receipt.width / receipt.height) > 0.01
  ) {
    throw new Error('Compressed film output changed dimensions unexpectedly')
  }
  return { ...receipt, ...size, outputUri, outputSha256: sha256(bytes) }
}

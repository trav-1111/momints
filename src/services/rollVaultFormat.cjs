'use strict'

const VAULT_URI_PREFIX = 'momints-roll-vault://'
const SAFE_ID = /^[A-Za-z0-9_-]+$/

function createRollVaultUri(rollId, photoId) {
  if (!SAFE_ID.test(rollId) || !SAFE_ID.test(photoId)) throw new Error('Invalid roll vault reference.')
  return `${VAULT_URI_PREFIX}${rollId}/${photoId}`
}

function parseRollVaultUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(VAULT_URI_PREFIX)) return null
  const parts = uri.slice(VAULT_URI_PREFIX.length).split('/')
  if (parts.length !== 2 || !parts.every((part) => SAFE_ID.test(part))) return null
  return { rollId: parts[0], photoId: parts[1] }
}

function isRollVaultUri(uri) {
  return parseRollVaultUri(uri) !== null
}

// Header-only JPEG geometry parser. It never decodes pixels and accepts all
// SOF marker families that carry dimensions while rejecting truncated files.
function jpegDimensions(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    if (sof.has(marker)) {
      if (length < 7) return null
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += length
  }
  return null
}

module.exports = { VAULT_URI_PREFIX, createRollVaultUri, parseRollVaultUri, isRollVaultUri, jpegDimensions }

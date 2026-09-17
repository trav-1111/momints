'use strict'

function canonicalFilePath(uri) {
  if (typeof uri !== 'string' || !/^file:\/\//i.test(uri)) return null
  try {
    const withoutSuffix = decodeURIComponent(uri.split(/[?#]/, 1)[0]).replace(/\\/g, '/')
    const rawPath = withoutSuffix.replace(/^file:\/\//i, '')
    const segments = []
    for (const segment of rawPath.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (segments.length === 0) return null
        segments.pop()
      } else {
        segments.push(segment)
      }
    }
    return `/${segments.join('/')}`
  } catch {
    return null
  }
}

function isFileUriInsideDirectory(uri, directoryUri) {
  const candidate = canonicalFilePath(uri)
  const root = canonicalFilePath(directoryUri)
  if (!candidate || !root || candidate === root) return false
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}

function isPermanentArweaveUri(uri) {
  if (typeof uri !== 'string') return false
  try {
    const value = uri.startsWith('ar://') ? 'https://arweave.net/' + uri.slice(5) : uri
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'arweave.net' && parsed.pathname.length > 1
  } catch {
    return false
  }
}

async function runWithCleanup(work, cleanup) {
  try {
    return await work()
  } finally {
    await cleanup()
  }
}

module.exports = { canonicalFilePath, isFileUriInsideDirectory, isPermanentArweaveUri, runWithCleanup }

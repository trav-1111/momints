'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  canonicalFilePath,
  isFileUriInsideDirectory,
  isPermanentArweaveUri,
  runWithCleanup,
} = require('../src/services/privacyPathGuard.cjs')
const { mergePendingDrain } = require('../src/store/pendingFinalizeGuard.cjs')

const captureRoot = 'file:///data/user/0/com.momints.app/cache/momints-captures'

test('only files strictly inside an app-owned directory are deletable', () => {
  assert.equal(isFileUriInsideDirectory(captureRoot + '/capture-1.jpg', captureRoot), true)
  assert.equal(isFileUriInsideDirectory(captureRoot, captureRoot), false)
  assert.equal(isFileUriInsideDirectory(captureRoot + '-backup/capture.jpg', captureRoot), false)
  assert.equal(isFileUriInsideDirectory('content://media/external/images/1', captureRoot), false)
  assert.equal(isFileUriInsideDirectory('file:///storage/emulated/0/DCIM/photo.jpg', captureRoot), false)
})

test('encoded traversal cannot escape an app-owned directory guard', () => {
  const escaped = captureRoot + '/%2e%2e/%2e%2e/files/private.jpg'
  assert.equal(canonicalFilePath(escaped), '/data/user/0/com.momints.app/files/private.jpg')
  assert.equal(isFileUriInsideDirectory(escaped, captureRoot), false)
})

test('durable history accepts only HTTPS Arweave image references', () => {
  assert.equal(isPermanentArweaveUri('https://arweave.net/abc123'), true)
  assert.equal(isPermanentArweaveUri('ar://abc123'), true)
  assert.equal(isPermanentArweaveUri('http://arweave.net/abc123'), false)
  assert.equal(isPermanentArweaveUri('https://example.com/abc123'), false)
  assert.equal(isPermanentArweaveUri('file:///data/user/0/app/cache/photo.jpg'), false)
  assert.equal(isPermanentArweaveUri('data:image/jpeg;base64,AAAA'), false)
})

test('contact-sheet cleanup runs when rendering throws', async () => {
  let cleanups = 0
  await assert.rejects(
    runWithCleanup(
      async () => {
        throw new Error('forced renderer failure')
      },
      async () => {
        cleanups++
      },
    ),
    /forced renderer failure/,
  )
  assert.equal(cleanups, 1)
})

test('finalize drain preserves a mint recorded after its snapshot', () => {
  const first = { stagingKey: 'first', attempts: 0 }
  const retry = { stagingKey: 'first', attempts: 1 }
  const addedDuringDrain = { stagingKey: 'second', attempts: 0 }

  assert.deepEqual(mergePendingDrain([first, addedDuringDrain], [first], [retry]), [retry, addedDuringDrain])
})

test('finalize drain removes only snapshot entries that resolved', () => {
  const resolved = { stagingKey: 'resolved', attempts: 0 }
  const waiting = { stagingKey: 'waiting', attempts: 0 }
  const retried = { stagingKey: 'waiting', attempts: 1 }

  assert.deepEqual(mergePendingDrain([resolved, waiting], [resolved, waiting], [retried]), [retried])
})

test('private photo views downscale without persistent or decoded-image caching', () => {
  const source = readFileSync(join(__dirname, '../src/components/PrivatePhotoImage.tsx'), 'utf8')
  const preview = readFileSync(join(__dirname, '../src/services/displayPreview.ts'), 'utf8')
  const privacy = readFileSync(join(__dirname, '../src/services/imagePrivacy.ts'), 'utf8')

  assert.match(source, /cachePolicy="none"/)
  assert.match(source, /if \(!uri\.startsWith\('file:\/\/'\)\)/)
  assert.match(source, /ensureDisplayPreview\(uri\)/)
  assert.match(source, /width: Math\.ceil\(displayWidth \* PixelRatio\.get\(\)\)/)
  assert.match(source, /height: Math\.ceil\(displayHeight \* PixelRatio\.get\(\)\)/)
  assert.match(source, /allowDownscaling/)
  assert.match(source, /enforceEarlyResizing/)
  assert.match(source, /recyclingKey=\{photoId\}/)
  assert.match(source, /transition=\{0\}/)
  assert.match(source, /Image\.clearMemoryCache\(\)/)
  assert.match(preview, /DISPLAY_LONG_EDGE = 2688/)
  assert.match(preview, /previewQueue = queued\.then/)
  assert.match(preview, /ref\?\.release\(\)/)
  assert.match(preview, /release\(resizeContext\)/)
  assert.match(preview, /release\(baseContext\)/)
  assert.match(privacy, /deleteDisplayPreview\(uri\)/)
  assert.match(privacy, /deleteOwnedDirectory\(DISPLAY_PREVIEW_DIRECTORY\)/)
})

test('quick-shot review keeps a bounded number of decoded pages mounted', () => {
  const source = readFileSync(join(__dirname, '../src/app/review.tsx'), 'utf8')

  assert.match(source, /<PrivatePhotoImage/)
  assert.match(source, /initialNumToRender=\{1\}/)
  assert.match(source, /maxToRenderPerBatch=\{1\}/)
  assert.match(source, /windowSize=\{3\}/)
  assert.match(source, /removeClippedSubviews/)
  assert.equal((source.match(/<PrivatePhotoImage/g) ?? []).length, 1)
  assert.match(source, /ensureDisplayPreview\(photo\.uri\)/)
  assert.match(source, /clearReleasedPrivatePhotoMemory/)
})

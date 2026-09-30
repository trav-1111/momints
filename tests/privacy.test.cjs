'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  canonicalFilePath,
  isFileUriInsideDirectory,
  isLegacyRootCacheImageName,
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

test('legacy root-cache cleanup matches only exact historical app output names', () => {
  assert.equal(isLegacyRootCacheImageName('photo_0080ecdc-fd7b-4bbd-859f-d543062a3a90_film.jpg'), true)
  assert.equal(isLegacyRootCacheImageName('photo_0080ecdc-fd7b-4bbd-859f-d543062a3a90_bali-400-v1.jpg'), true)
  assert.equal(isLegacyRootCacheImageName('photo_1790645661999_fit.jpg'), true)
  assert.equal(isLegacyRootCacheImageName('photo_family_film.jpg'), false)
  assert.equal(isLegacyRootCacheImageName('IMG_4704.HEIC'), false)
  assert.equal(isLegacyRootCacheImageName('../photo_0080ecdc-fd7b-4bbd-859f-d543062a3a90_film.jpg'), false)
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

test('contact-sheet output is deleted on back, share/save completion, late render and unmount', () => {
  const source = readFileSync(join(__dirname, '../src/app/contact-sheet.tsx'), 'utf8')
  const renderer = readFileSync(join(__dirname, '../src/services/contactSheet.ts'), 'utf8')
  assert.match(source, /const setOwnedPreview = useCallback/)
  assert.match(source, /if \(previous && previous\.render\.uri !== next\?\.render\.uri\)/)
  assert.match(source, /if \(owned\) deleteAppOwnedImage\(owned\.render\.uri\)/)
  assert.match(source, /if \(!mountedRef\.current\) \{\s*deleteAppOwnedImage\(render\.uri\)/)
  assert.match(source, /if \(preview\) \{\s*setOwnedPreview\(null\)/)
  assert.match(source, /if \(shared\) \{\s*setOwnedPreview\(null\)/)
  assert.match(source, /if \(saved\) \{\s*setOwnedPreview\(null\)/)
  assert.match(renderer, /Skia\.Surface\.Make\(OUTPUT_WIDTH, outputHeight\)/)
  assert.doesNotMatch(renderer, /Skia\.Surface\.MakeOffscreen/)
  assert.match(renderer, /snapshot\?\.dispose\(\)/)
  assert.match(renderer, /surface\.dispose\(\)/)
  assert.match(renderer, /if \(!outputComplete && output\) deleteAppOwnedImage\(output\.uri\)/)
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
  assert.match(privacy, /'ImageManipulator'/)
})

test('roll preview releases native refs before deleting ImageManipulator output', () => {
  const source = readFileSync(join(__dirname, '../src/services/rollVaultPreview.ts'), 'utf8')
  const releaseIndex = source.indexOf('release(image)')
  const cleanupIndex = source.indexOf('if (savedUri)')

  assert.notEqual(releaseIndex, -1)
  assert.notEqual(cleanupIndex, -1)
  assert.ok(releaseIndex < cleanupIndex)
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

test('roll Arweave propagation is pending rather than a failed mint', () => {
  const mint = readFileSync(join(__dirname, '../src/hooks/useMint.ts'), 'utf8')
  const progress = readFileSync(join(__dirname, '../src/app/mint/progress.tsx'), 'utf8')

  assert.match(mint, /if \(!isPermanentImagePending\(error\)\) throw error/)
  assert.match(mint, /status: 'confirming',[\s\S]*imageUri: res\.imageUri/)
  assert.match(progress, /verifyPermanentImage\(item\.permanentImageUri!\)/)
  assert.match(progress, /isPermanentImagePending\(error\)/)
  assert.match(progress, /Your mint is safely recorded\./)
})

test('splash screen uses the ownership tagline', () => {
  const splash = readFileSync(join(__dirname, '../src/app/index.tsx'), 'utf8')
  assert.match(splash, /SHOOT · MINT · YOURS/)
  assert.doesNotMatch(splash, /POINT · SHOOT · MINT/)
})

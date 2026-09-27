/* global __dirname */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { sourceLoader } = require('./helpers/load-source.cjs')

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
// Header-only fixture for the JS dimension/hash guard, NOT a GPU/decoder test.
function jpeg(width = 4000, height = 3000) {
  return Uint8Array.from([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    217,
  ])
}
function harness() {
  const files = new Map([
    ['file:///cache/input.jpg', jpeg()],
    ['file:///cache/second.jpg', jpeg()],
  ])
  const deleted = []
  const calls = []
  let counter = 0
  let nativeHook = async () => {}
  let packageHook = () => {}
  const recipe = { schemaVersion: 2, filmStockId: 'bali-400-v1', lut: { sha256: 'b'.repeat(64) } }
  class File {
    constructor(...parts) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/')
    }
    get parentDirectory() {
      return { uri: this.uri.slice(0, this.uri.lastIndexOf('/')) }
    }
    get exists() {
      return files.has(this.uri)
    }
    async bytes() {
      if (!this.exists) throw new Error('Missing file')
      return files.get(this.uri)
    }
    delete() {
      deleted.push(this.uri)
      files.delete(this.uri)
    }
  }
  const load = sourceLoader({
    'react-native': { Platform: { OS: 'android' } },
    'react-native-quick-crypto': crypto,
    'expo-file-system': { File },
    uuid: { v4: () => `test-${++counter}` },
    'src/services/imagePrivacy.ts': {
      deleteCapture: (uri) => {
        new File(uri).delete()
      },
    },
    '@shopify/react-native-skia': {
      Skia: {
        RuntimeEffect: { Make: () => ({}) },
        Image: {
          MakeImageFromEncoded: () => {
            throw new Error('Android must never use the Skia fallback')
          },
        },
      },
    },
    'src/services/filmstocks.ts': {
      loadFilmStockPackage: async () => {
        packageHook()
        return { recipe, runtimeLutUri: 'file:///packages/runtime.lut' }
      },
    },
    'modules/film-gl/index.ts': {
      applyFilmNative: async (options) => {
        calls.push(options)
        files.set(options.outputUri, jpeg())
        const receipt = {
          filmStockId: options.filmStockId,
          recipeSha256: options.recipeSha256,
          lutSha256: recipe.lut.sha256,
          outputUri: options.outputUri,
          outputSha256: digest(files.get(options.outputUri)),
          width: 4000,
          height: 3000,
          renderer: 'native-egl-v2',
          colorSpace: 'sRGB',
        }
        await nativeHook(receipt, options)
        return receipt
      },
    },
  })
  return {
    processor: load('src/services/filmProcessor.ts'),
    output: load('src/services/filmOutput.ts'),
    files,
    deleted,
    calls,
    recipe,
    nativeHook: (hook) => {
      nativeHook = hook
    },
    packageHook: (hook) => {
      packageHook = hook
    },
  }
}
const film = { filmStockId: 'bali-400-v1' }

test('production package and exact output are bound to a verified native receipt', async () => {
  const h = harness()
  const receipt = await h.processor.processFilm('file:///cache/input.jpg', film)
  assert.equal(receipt.filmStockId, film.filmStockId)
  assert.equal(receipt.recipeSha256, digest(JSON.stringify(h.recipe)))
  assert.equal(receipt.lutSha256, h.recipe.lut.sha256)
  assert.deepEqual(h.deleted, ['file:///cache/input.jpg'])
  assert.ok(h.files.has(receipt.outputUri))
  assert.equal(h.calls[0].lutUri, 'file:///packages/runtime.lut')
  assert.equal(h.calls[0].jpegQuality, 95)
})

for (const [field, invalid] of Object.entries({
  filmStockId: 'wrong-v1',
  recipeSha256: 'c'.repeat(64),
  lutSha256: null,
  outputUri: 'file:///gallery/user-photo.jpg',
  outputSha256: '0'.repeat(64),
  width: 2048,
  height: 1024,
  renderer: 'skia-v2',
  colorSpace: 'Display-P3',
})) {
  test(`rejects mismatched ${field}; retains source and cleans only owned output`, async () => {
    const h = harness()
    h.files.set('file:///gallery/user-photo.jpg', jpeg())
    h.nativeHook((receipt) => {
      receipt[field] = invalid
    })
    await assert.rejects(h.processor.processFilm('file:///cache/input.jpg', film), /not queued/)
    assert.ok(h.files.has('file:///cache/input.jpg'))
    assert.ok(h.files.has('file:///gallery/user-photo.jpg'))
    assert.deepEqual(h.deleted, [h.calls[0].outputUri])
  })
}

test('missing or corrupt package never calls the renderer', async () => {
  const h = harness()
  h.packageHook(() => {
    throw new Error('LUT checksum mismatch')
  })
  await assert.rejects(h.processor.processFilm('file:///cache/input.jpg', film), /checksum/)
  assert.equal(h.calls.length, 0)
  assert.ok(h.files.has('file:///cache/input.jpg'))
})

test('a missing required LUT cannot return an unprocessed frame', async () => {
  const h = harness()
  h.packageHook(() => {
    throw new Error('Film LUT bali-400-v1 is not downloaded')
  })
  await assert.rejects(h.processor.processFilm('file:///cache/input.jpg', film), /not downloaded/)
  assert.equal(h.calls.length, 0)
  assert.ok(h.files.has('file:///cache/input.jpg'))
})

test('an existing output path is never overwritten or deleted', async () => {
  const h = harness()
  const existing = 'file:///cache/photo_test-1_bali-400-v1.jpg'
  h.files.set(existing, jpeg(64, 48))
  await assert.rejects(h.processor.processFilm('file:///cache/input.jpg', film), /not queued/)
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.deleted, [])
  assert.ok(h.files.has(existing))
})

test('missing native module/GL failure never falls back or returns original', async () => {
  const h = harness()
  h.nativeHook(() => {
    throw new Error('EGL activation failed')
  })
  await assert.rejects(h.processor.applyFilm('file:///cache/input.jpg', film), /not queued/)
  assert.ok(h.files.has('file:///cache/input.jpg'))
  assert.equal(h.deleted.length, 1)
})

test('truncated JPEG rejected even with matching artifact hash', async () => {
  const h = harness()
  h.nativeHook((receipt, options) => {
    const truncated = jpeg().slice(0, -2)
    h.files.set(options.outputUri, truncated)
    receipt.outputSha256 = digest(truncated)
  })
  await assert.rejects(h.processor.processFilm('file:///cache/input.jpg', film), /not queued/)
})

test('full-resolution operations serialize and failure does not poison the next capture', async () => {
  const h = harness()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  h.nativeHook(async () => {
    if (h.calls.length === 1) {
      await gate
      throw new Error('forced failure')
    }
  })
  const first = h.processor.processFilm('file:///cache/input.jpg', film)
  const failed = assert.rejects(first, /not queued/)
  const second = h.processor.processFilm('file:///cache/second.jpg', film)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.calls.length, 1)
  release()
  await failed
  assert.equal((await second).renderer, 'native-egl-v2')
  assert.equal(h.calls.length, 2)
})

test('quick compression preserves provenance and aspect; bad/replaced artifacts reject', async () => {
  const h = harness()
  const receipt = await h.processor.processFilm('file:///cache/input.jpg', film)
  h.files.set('file:///cache/fitted.jpg', jpeg(2000, 1500))
  const fitted = await h.output.verifyCompressedFilmOutput(receipt, 'file:///cache/fitted.jpg')
  assert.equal(fitted.recipeSha256, receipt.recipeSha256)
  assert.equal(fitted.lutSha256, receipt.lutSha256)
  assert.equal(fitted.width, 2000)
  h.files.set('file:///cache/fitted.jpg', jpeg(2000, 2000))
  await assert.rejects(h.output.verifyCompressedFilmOutput(receipt, 'file:///cache/fitted.jpg'), /dimensions/)
  h.files.set(receipt.outputUri, jpeg(1000, 750))
  await assert.rejects(h.output.verifyCompressedFilmOutput(receipt, receipt.outputUri), /verification/)
})

test('camera registers/queues only after film and quick-compression verification', () => {
  const camera = fs.readFileSync(path.resolve(__dirname, '../src/app/camera.tsx'), 'utf8')
  const start = camera.indexOf('const handleCapture')
  const render = camera.indexOf('await processFilm(', start)
  const compression = camera.indexOf('await verifyCompressedFilmOutput(', render)
  const register = camera.indexOf('const photoId = addPhoto(', start)
  const queue = camera.indexOf("setAction(photoId, 'mint')", register)
  assert.ok(start < render && render < compression && compression < register && register < queue)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

function renderer({ failLogo = false } = {}) {
  const events = []
  const disposable = (name, extra = {}) => ({
    ...extra,
    dispose() {
      events.push(`dispose:${name}`)
    },
  })
  const paint = () => disposable('paint', { setAntiAlias() {}, setColor() {}, setStrokeWidth() {}, setStyle() {} })
  const canvas = { drawRect() {}, drawText() {}, drawLine() {}, drawImageRect() {} }
  class File {
    constructor(parent, name) {
      this.uri = name ? `${parent.uri}/${name}` : parent
      // Match the native filesystem boundary: drawable names are not files.
      if (!this.uri.startsWith('file://')) throw new Error('File requires a filesystem URI')
    }
    async bytes() {
      events.push(`file:${this.uri}`)
      return new Uint8Array([1])
    }
    write() {
      events.push('write:output')
    }
  }
  const load = sourceLoader({
    '@shopify/react-native-skia': {
      ImageFormat: { PNG: 0 },
      PaintStyle: { Stroke: 1 },
      matchFont: () => disposable('font', { measureText: () => ({ width: 10 }) }),
      Skia: {
        Color: (value) => value,
        XYWHRect: (...values) => values,
        Paint: paint,
        Data: {
          fromBytes: () => disposable('frame-data'),
          async fromURI(uri) {
            events.push(`native:${uri}`)
            if (failLogo) throw new Error('Missing drawable')
            return disposable('logo-data')
          },
        },
        Image: {
          MakeImageFromEncoded: () => disposable('image', { width: () => 100, height: () => 100 }),
        },
        Surface: {
          Make: () =>
            disposable('surface', {
              getCanvas: () => canvas,
              flush() {},
              makeImageSnapshot: () => disposable('snapshot', { encodeToBytes: () => new Uint8Array([2]) }),
            }),
        },
      },
    },
    'expo-file-system': { File },
    'src/services/imagePrivacy.ts': {
      createContactSheetInputDirectory: () => ({ uri: 'file:///cache/inputs' }),
      createContactSheetOutputFile: () => new File('file:///cache/sheet.png'),
      deleteAppOwnedImage: () => events.push('delete:output'),
      deleteContactSheetRenderDirectory: () => events.push('delete:inputs'),
    },
    'src/services/privacyPathGuard.cjs': require('../src/services/privacyPathGuard.cjs'),
  })
  return { render: load('src/services/contactSheet.ts').renderContactSheet, events }
}

const frames = [{ imageUri: 'file:///cache/frame.jpg', name: 'Frame 01', width: 400, height: 300 }]
const metadata = { title: 'Roll', artist: 'Shooter', date: '2026-10-02', filmUsed: 'Bali' }

for (const logoUri of ['assets_adaptiveicon', 'file:///cache/logo.png', 'https://localhost/logo.png']) {
  test(`contact sheet reads its logo through the native asset loader: ${logoUri}`, async () => {
    const { render, events } = renderer()
    const result = await render(frames, { ...metadata, logoUri })
    assert.equal(result.uri, 'file:///cache/sheet.png')
    assert.ok(events.includes(`native:${logoUri}`))
    assert.ok(events.includes('file:file:///cache/frame.jpg'))
    assert.ok(events.includes('dispose:logo-data'))
    assert.ok(events.includes('dispose:snapshot'))
    assert.ok(events.includes('dispose:surface'))
    assert.equal(events.at(-1), 'delete:inputs')
    assert.ok(!events.includes(`file:${logoUri}`))
  })
}

test('a failed bundled logo load releases the canvas and temporary frame directory', async () => {
  const { render, events } = renderer({ failLogo: true })
  await assert.rejects(render(frames, { ...metadata, logoUri: 'missing_drawable' }), (error) => {
    assert.equal(error.message, 'Could not load the Momints logo.')
    assert.equal(error.cause.message, 'Missing drawable')
    return true
  })
  assert.ok(events.includes('dispose:surface'))
  assert.equal(events.at(-1), 'delete:inputs')
  assert.ok(!events.includes('write:output'))
})

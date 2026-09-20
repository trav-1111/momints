/* global __dirname */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sourceLoader } = require('./helpers/load-source.cjs')
const { decodeRgbPng, pixelAt } = require('./helpers/png-rgb.cjs')
const fixtures = require('./fixtures/film/fixture-vectors.json')

const root = path.resolve(__dirname, '..')
const stockIds = [
  'momints-aura-400',
  'momints-neon-800t',
  'momints-vivid-50',
  'momints-amber-200',
  'momints-silver-400',
]
const assetMocks = Object.fromEntries(stockIds.map((id, index) => [`../../assets/luts/${id}.png`, index + 1]))
const { FILM_STOCKS, getFilmStock } = sourceLoader(assetMocks)('src/config/filmStocks.ts')
const {
  FILM_LUT_SIZE,
  FILM_LUT_STRIP_HEIGHT,
  FILM_LUT_STRIP_WIDTH,
  getLutStripSample,
  grainSeedForUri,
  halationHighlightWeight,
  rec601Luma,
  scaledHalationRadius,
} = sourceLoader()('src/services/filmRenderMath.ts')

function sampleLut(image, rgb255) {
  const [red, green, blue] = rgb255.map((channel) => channel / 255)
  const r = red * (FILM_LUT_SIZE - 1)
  const g = green * (FILM_LUT_SIZE - 1)
  const b = blue * (FILM_LUT_SIZE - 1)
  const r0 = Math.floor(r)
  const r1 = Math.min(r0 + 1, FILM_LUT_SIZE - 1)
  const g0 = Math.floor(g)
  const g1 = Math.min(g0 + 1, FILM_LUT_SIZE - 1)
  const b0 = Math.floor(b)
  const b1 = Math.min(b0 + 1, FILM_LUT_SIZE - 1)

  const interpolate = (low, high, mix) => low + (high - low) * mix
  const sample = (ri, gi, bi) => pixelAt(image, bi * FILM_LUT_SIZE + ri, gi)
  const result = []
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = sample(r0, g0, b0)[channel]
    const c100 = sample(r1, g0, b0)[channel]
    const c010 = sample(r0, g1, b0)[channel]
    const c110 = sample(r1, g1, b0)[channel]
    const c001 = sample(r0, g0, b1)[channel]
    const c101 = sample(r1, g0, b1)[channel]
    const c011 = sample(r0, g1, b1)[channel]
    const c111 = sample(r1, g1, b1)[channel]
    const lowBlue = interpolate(interpolate(c000, c100, r - r0), interpolate(c010, c110, r - r0), g - g0)
    const highBlue = interpolate(interpolate(c001, c101, r - r0), interpolate(c011, c111, r - r0), g - g0)
    result.push(Math.round(interpolate(lowBlue, highBlue, b - b0)))
  }
  return result
}

test('catalog maps every film stock and resolves legacy identifiers', () => {
  assert.equal(FILM_STOCKS.length, 7)
  for (const id of stockIds) assert.equal(getFilmStock(id).id, id)
  assert.equal(getFilmStock('kodak-portra-400').id, 'momints-aura-400')
  assert.equal(getFilmStock('cinestill-800t').id, 'momints-neon-800t')
  assert.equal(getFilmStock('fuji-velvia-50').id, 'momints-vivid-50')
  assert.equal(getFilmStock('kodak-gold-200').id, 'momints-amber-200')
  assert.equal(getFilmStock('kodak-tri-x-400').id, 'momints-silver-400')
  assert.equal(getFilmStock('unknown-stock').id, 'momints-aura-400')
})

test('generator packing and production sampler agree on channel and slice order', () => {
  const result = JSON.parse(
    execFileSync('python3', ['scripts/generate_film_luts.py', '--self-test'], { cwd: root, encoding: 'utf8' }),
  )
  assert.deepEqual([result.size, result.width, result.height], [32, 1024, 32])
  assert.equal(result.packedPixelsChecked, 32 ** 3)
  for (const probe of result.coordinates) {
    const sample = getLutStripSample(probe.r / 31, probe.g / 31, probe.b / 31)
    assert.equal(sample.x0, probe.x + 0.5)
    assert.equal(sample.y, probe.y + 0.5)
    assert.equal(sample.blueMix, 0)
  }
})

test('all configured LUTs have valid dimensions and distinct repeatable fixture responses', () => {
  const fixturePixels = Object.values(fixtures).flat()
  const digests = new Set()
  const expectedNeutralGridProbe = {
    'momints-aura-400': [152, 155, 159],
    'momints-neon-800t': [139, 140, 138],
    'momints-vivid-50': [130, 143, 145],
    'momints-amber-200': [152, 156, 158],
    'momints-silver-400': [136, 136, 136],
  }

  for (const id of stockIds) {
    const image = decodeRgbPng(path.join(root, 'assets/luts', `${id}.png`))
    assert.deepEqual([image.width, image.height], [FILM_LUT_STRIP_WIDTH, FILM_LUT_STRIP_HEIGHT])
    assert.deepEqual(pixelAt(image, 16 * FILM_LUT_SIZE + 16, 16), expectedNeutralGridProbe[id])
    const firstPass = fixturePixels.map((rgb) => sampleLut(image, rgb))
    const secondPass = fixturePixels.map((rgb) => sampleLut(image, rgb))
    assert.deepEqual(firstPass, secondPass)
    digests.add(crypto.createHash('sha256').update(JSON.stringify(firstPass)).digest('hex'))
  }

  assert.equal(digests.size, stockIds.length)
})

test('standard transforms, halation threshold, radius, and grain seed are deterministic', () => {
  assert.ok(Math.abs(rec601Luma(1, 1, 1) - 1) < 1e-12)
  assert.equal(rec601Luma(0, 0, 0), 0)
  assert.equal(rec601Luma(1, 0, 0), 0.299)
  assert.equal(halationHighlightWeight(0.69), 0)
  assert.equal(halationHighlightWeight(0.98), 1)
  assert.ok(halationHighlightWeight(0.84) > 0 && halationHighlightWeight(0.84) < 1)
  assert.equal(scaledHalationRadius(12, 1080, 1920), 12)
  assert.equal(scaledHalationRadius(12, 2160, 3840), 24)
  assert.equal(grainSeedForUri('file:///capture/a.jpg'), grainSeedForUri('file:///capture/a.jpg'))
  assert.notEqual(grainSeedForUri('file:///capture/a.jpg'), grainSeedForUri('file:///capture/b.jpg'))
})

const { makeProcessorHarness: createHarness } = require('./helpers/film-processor-harness.cjs')
const uri = 'file:///captures/original.jpg'
const aura = { mode: 'color', stockId: 'momints-aura-400' }

test('catalog assets and baked LUT hashes match the intended stock', () => {
  const fs = require('node:fs')
  const manifest = require('./fixtures/film/lut-manifest.json')
  stockIds.forEach((id, index) => {
    assert.equal(getFilmStock(id).lutAsset, index + 1)
    const bytes = fs.readFileSync(path.join(root, 'assets/luts', id + '.png'))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest[id])
  })
})

test('every stock reaches its intended LUT, children, and effect uniforms', async () => {
  for (const stock of FILM_STOCKS.filter((s) => s.lutAsset)) {
    const { processor, calls } = createHarness()
    assert.equal(processor.isFilmEmulationActive({ mode: stock.mode, stockId: stock.id }), true)
    assert.notEqual(await processor.applyFilm(uri, { mode: stock.mode, stockId: stock.id }), uri)
    assert.deepEqual(calls.assets, [stock.lutAsset])
    const { uniforms, children } = calls.uniforms[0]
    assert.deepEqual(uniforms, [
      stock.grain.intensity,
      stock.grain.size,
      grainSeedForUri(uri),
      stock.halation?.intensity ?? 0,
      scaledHalationRadius(stock.halation?.radius ?? 0, 640, 480),
      1,
      stock.mode === 'bw' ? 1 : 0,
    ])
    assert.deepEqual(
      children.map((c) => c.name),
      ['imageShader', 'lutShader'],
    )
  }
  const legacy = createHarness()
  await legacy.processor.applyFilm(uri, { mode: 'color', stockId: 'cinestill-800t' })
  assert.deepEqual(legacy.calls.assets, [2])
})

test('Standard Color and legacy color preserve bytes with no native calls', async () => {
  for (const film of [{ mode: 'color', stockId: 'standard-color' }, { mode: 'color' }]) {
    const { processor, calls, files } = createHarness()
    const before = files.get(uri).slice()
    assert.equal(processor.isFilmEmulationActive(film), false)
    assert.equal(await processor.applyFilm(uri, film), uri)
    assert.deepEqual(files.get(uri), before)
    assert.deepEqual(calls.events, [])
    assert.equal(calls.resources.length, 0)
  }
})

test('B&W uses Rec.601 and writes the complete output before source deletion', async () => {
  for (const stockId of [undefined, 'standard-bw', 'standard-color']) {
    const { processor, calls, files } = createHarness()
    const output = await processor.applyFilm(uri, { mode: 'bw', stockId })
    assert.notEqual(output, uri)
    assert.equal(files.has(uri), false)
    assert.deepEqual(Array.from(files.get(output)), [9, 8, 7])
    assert.ok(calls.events.indexOf('write') < calls.events.indexOf('deleteSource'))
    assert.deepEqual(calls.assets, [])
    assert.deepEqual(calls.matrices[0].slice(0, 5), [0.299, 0.587, 0.114, 0, 0])
    assert.deepEqual(calls.matrices[0].slice(0, 5), calls.matrices[0].slice(5, 10))
    assert.deepEqual(calls.matrices[0].slice(0, 5), calls.matrices[0].slice(10, 15))
  }
})

const failures = [
  { fail: 'read' },
  { nullAt: 'decodeSource' },
  { fail: 'decodeSource' },
  { noAsset: true },
  { fail: 'asset' },
  { fail: 'readLut' },
  { nullAt: 'decodeLut' },
  { invalidLut: true },
  { nullAt: 'compile' },
  { fail: 'compile' },
  { nullAt: 'surface' },
  { fail: 'surface' },
  { fail: 'imageShader' },
  { fail: 'lutShader' },
  { fail: 'filmShader' },
  { fail: 'drawRect' },
  { fail: 'flush' },
  { fail: 'snapshot' },
  { fail: 'encode' },
  { emptyEncode: true },
  { fail: 'create' },
  { fail: 'write' },
  { shortWrite: true },
]
for (const failure of failures) {
  test('failure preserves source and releases temporary resources: ' + JSON.stringify(failure), async () => {
    const { processor, calls, files } = createHarness(failure)
    assert.equal(await processor.applyFilm(uri, aura), uri)
    assert.deepEqual(Array.from(files.get(uri)), [1, 2, 3])
    assert.equal(calls.events.includes('deleteSource'), false)
    assert.equal(files.size, 1, 'no partial output remains')
    for (const resource of calls.resources) {
      if (resource.name === 'effect' || (resource.name === 'lutImage' && !failure.invalidLut)) continue
      assert.equal(resource.disposed, 1, resource.name + ' disposed exactly once')
    }
  })
}

test('successful rendering cleans resources and tolerates source cleanup failure', async () => {
  const { processor, calls, files } = createHarness({ fail: 'deleteSource' })
  const output = await processor.applyFilm(uri, aura)
  assert.notEqual(output, uri)
  assert.equal(files.has(uri), true)
  assert.equal(files.has(output), true)
  for (const resource of calls.resources.filter((r) => !['effect', 'lutImage'].includes(r.name))) {
    assert.equal(resource.disposed, 1, resource.name)
  }
})

test('LUT cache is separated by stock and avoids duplicate asset loads', async () => {
  const { processor, calls, files } = createHarness()
  for (const stockId of [stockIds[0], stockIds[1], stockIds[0]]) {
    files.set(uri, new Uint8Array([1, 2, 3]))
    await processor.applyFilm(uri, { mode: 'color', stockId })
  }
  assert.deepEqual(calls.assets, [1, 2])
})

test('renders completing in the same millisecond retain separate output files', async (t) => {
  t.mock.method(Date, 'now', () => 42)
  const { processor, files } = createHarness()
  const second = 'file:///captures/second.jpg'
  files.set(second, new Uint8Array([1, 2, 3]))
  const outputs = await Promise.all([
    processor.applyFilm(uri, { mode: 'bw' }),
    processor.applyFilm(second, { mode: 'bw' }),
  ])
  assert.notEqual(outputs[0], outputs[1])
  assert.equal(files.size, 2)
  for (const output of outputs) assert.deepEqual(Array.from(files.get(output)), [9, 8, 7])
  assert.equal(files.has(uri), false)
  assert.equal(files.has(second), false)
})

test('an output-name collision preserves both the existing output and input', async () => {
  const { processor, files, calls } = createHarness({ outputId: 'reserved' })
  const existing = 'file:///captures/photo_reserved_film.jpg'
  files.set(existing, new Uint8Array([55, 66, 77]))
  assert.equal(await processor.applyFilm(uri, { mode: 'bw' }), uri)
  assert.deepEqual(Array.from(files.get(existing)), [55, 66, 77])
  assert.deepEqual(Array.from(files.get(uri)), [1, 2, 3])
  assert.equal(calls.events.includes('write'), false)
  assert.equal(calls.events.includes('deleteOutput'), false)
})

test('a generated destination equal to the input cannot overwrite or delete the input', async () => {
  const { processor, files, calls } = createHarness({ outputId: 'source' })
  const source = 'file:///captures/photo_source_film.jpg'
  files.set(source, new Uint8Array([1, 2, 3]))
  assert.equal(await processor.applyFilm(source, { mode: 'bw' }), source)
  assert.deepEqual(Array.from(files.get(source)), [1, 2, 3])
  assert.equal(calls.events.includes('write'), false)
  assert.equal(calls.events.includes('deleteOutput'), false)
})

test('Quick and Roll selections survive persistence independently for every stock', async () => {
  for (const stock of FILM_STOCKS) {
    const film = { mode: stock.mode, stockId: stock.id, iso: stock.iso }
    let persisted = JSON.stringify({
      hasSetMode: true,
      activeMode: 'roll',
      quickFilm: { mode: 'color', stockId: 'standard-color', iso: 100 },
      activeRoll: { id: 'fixture-roll', name: 'Fixture', size: 12, film, aspect: 'full', frameIds: [], startedAt: 1 },
    })
    class File {
      get exists() {
        return true
      }
      async text() {
        return persisted
      }
      write(text) {
        persisted = text
      }
    }
    const load = () =>
      sourceLoader({ 'expo-file-system': { File, Paths: { document: 'fixture://' } }, uuid: { v4: () => 'fixture' } })(
        'src/store/session.ts',
      )
    const first = load()
    await first.sessionHydrated
    assert.deepEqual(first.useSessionStore.getState().activeRoll.film, film)
    assert.equal(first.useSessionStore.getState().quickFilm.stockId, 'standard-color')
    first.useSessionStore.getState().setQuickFilm(film)
    const reloaded = load()
    await reloaded.sessionHydrated
    assert.deepEqual(reloaded.useSessionStore.getState().quickFilm, film)
    assert.deepEqual(reloaded.useSessionStore.getState().activeRoll.film, film)
  }
})

test('legacy color/B&W settings without a stock ID retain their renderer selection', async () => {
  for (const mode of ['color', 'bw']) {
    class File {
      get exists() {
        return true
      }
      async text() {
        return JSON.stringify({ quickFilm: { mode } })
      }
    }
    const loaded = sourceLoader({
      'expo-file-system': { File, Paths: { document: 'fixture://' } },
      uuid: { v4: () => 'fixture' },
    })('src/store/session.ts')
    await loaded.sessionHydrated
    const film = loaded.useSessionStore.getState().quickFilm
    assert.equal(film.stockId, undefined)
    const { processor, calls } = createHarness()
    await processor.applyFilm(uri, film)
    assert.equal(calls.matrices.length, mode === 'bw' ? 1 : 0)
    assert.deepEqual(calls.assets, [])
  }
})

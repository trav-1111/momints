import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import sharp from 'sharp'
import {
  CUBE_SIZE,
  compileRuntimeLut,
  parseCube,
  parseRuntimeLut,
  sampleCubeTrilinear,
  sha256,
  validateAttribution,
  validateLutRecipe,
} from '../scripts/lib/filmstock-package.mjs'
import { assertSchema } from '../scripts/lib/json-schema.mjs'
import {
  REQUIRED_TEST_TAGS,
  validateCanonicalImages,
  validateTestManifest,
} from '../scripts/lib/filmstock-validation.mjs'

const recipeSchema = JSON.parse(await readFile(new URL('../filmstock-recipe.schema.json', import.meta.url), 'utf8'))

function identityCube({ domainMin = '0 0 0', domainMax = '1 1 1', omit = 0 } = {}) {
  const lines = [
    'TITLE "Momints test identity"',
    `LUT_3D_SIZE ${CUBE_SIZE}`,
    `DOMAIN_MIN ${domainMin}`,
    `DOMAIN_MAX ${domainMax}`,
  ]
  for (let blue = 0; blue < CUBE_SIZE; blue += 1) {
    for (let green = 0; green < CUBE_SIZE; green += 1) {
      for (let red = 0; red < CUBE_SIZE; red += 1) {
        lines.push(`${red / 32} ${green / 32} ${blue / 32}`)
      }
    }
  }
  return lines.slice(0, lines.length - omit).join('\n')
}

test('parses a canonical 33-point sRGB CUBE and compiles the runtime atlas', () => {
  const cube = parseCube(identityCube())
  const runtime = parseRuntimeLut(compileRuntimeLut(cube))
  assert.equal(runtime.size, 33)
  assert.equal(runtime.width, 1089)
  assert.equal(runtime.height, 33)
  assert.equal(runtime.pixels.length, 33 ** 3 * 4)
  assert.deepEqual([...runtime.pixels.subarray(0, 4)], [0, 0, 0, 255])
  assert.deepEqual([...runtime.pixels.subarray(-4)], [255, 255, 255, 255])
})

test('reference trilinear interpolation preserves an identity cube', () => {
  const cube = parseCube(identityCube())
  const output = sampleCubeTrilinear(cube, [0.123, 0.456, 0.789])
  output.forEach((value, channel) => assert.ok(Math.abs(value - [0.123, 0.456, 0.789][channel]) < 1e-9))
})

test('rejects incomplete, malformed and unsupported-domain CUBE files', () => {
  assert.throws(() => parseCube(identityCube({ omit: 1 })), /Expected 35937/)
  assert.throws(() => parseCube(identityCube({ domainMin: '-1 0 0' })), /DOMAIN_MIN/)
  assert.throws(() => parseCube(identityCube().replace('0 0 0\n', 'NaN 0 0\n')), /non-finite|Malformed/)
})

test('validates the declarative LUT recipe and bounded spatial effects', () => {
  const recipe = {
    schemaVersion: 2,
    filmStockId: 'amber-200-v1',
    displayName: 'Amber 200',
    shortDescription: 'Warm daylight colour.',
    characteristics: ['warm'],
    inputColorSpace: 'sRGB',
    outputColorSpace: 'sRGB',
    baseMode: 'color',
    lut: { format: 'momints-lut', size: 33, intensity: 1 },
    grain: { amount: 0.2, size: 0.4, roughness: 0.4 },
    halation: { amount: 0.1, radius: 0.2 },
    bloom: { amount: 0.05, radius: 0.15 },
    sharpness: { amount: -0.1 },
    vignette: { amount: 0.05 },
    minimumEngineVersion: 2,
  }
  assert.doesNotThrow(() => assertSchema(recipeSchema, recipe, 'test recipe'))
  assert.equal(validateLutRecipe(recipe, recipe.filmStockId), recipe)
  assert.throws(() => validateLutRecipe({ ...recipe, grain: { ...recipe.grain, amount: 1.1 } }, recipe.filmStockId))
  assert.throws(() => assertSchema(recipeSchema, { ...recipe, executable: 'alert(1)' }, 'test recipe'))
})

test('Bali 400 production source is immutable and its deployable package excludes authoring inputs', async () => {
  const sourceRoot = new URL('../filmstock-sources/bali-400-v1/', import.meta.url)
  const assetRoot = new URL('../filmstock-assets/filmstocks/bali-400-v1/', import.meta.url)
  const source = await readFile(new URL('source/bali-400-v1.cube', sourceRoot))
  assert.equal(sha256(source), '8388b464cb668cfdcec146a1b58f1f6737335a808df97dc58b66596b4c50a03f')
  const cube = parseCube(source.toString('utf8'))
  const compiled = compileRuntimeLut(cube)
  const runtime = await readFile(new URL('runtime/bali-400-v1.lut', assetRoot))
  assert.deepEqual(runtime, compiled)
  assert.equal(parseRuntimeLut(runtime).size, 33)

  const recipe = JSON.parse(await readFile(new URL('recipe.json', sourceRoot), 'utf8'))
  assert.doesNotThrow(() => assertSchema(recipeSchema, recipe, 'Bali 400 recipe'))
  assert.equal(validateLutRecipe(recipe, 'bali-400-v1'), recipe)
  assert.deepEqual(recipe.grain, { amount: 0.13, size: 0.32, roughness: 0.35 })
  validateAttribution(await readFile(new URL('attribution.txt', sourceRoot), 'utf8'))
  await stat(new URL('authoring-notes.md', sourceRoot))
  const previewNames = await readdir(new URL('previews/', assetRoot))
  assert.deepEqual(previewNames, ['preview-01.jpg'])
  const preview = await sharp(fileURLToPath(new URL('previews/preview-01.jpg', assetRoot))).metadata()
  assert.equal(preview.format, 'jpeg')
  assert.ok(preview.width >= 1000 && preview.height >= 600)
  assert.deepEqual((await readdir(sourceRoot)).sort(), [
    'attribution.txt',
    'authoring-notes.md',
    'recipe.json',
    'source',
  ])
  assert.deepEqual((await readdir(assetRoot)).sort(), ['attribution.txt', 'previews', 'recipe.json', 'runtime'])
})

test('third-party attribution must explicitly cover commercial redistribution', () => {
  const valid =
    'Creator: Momints\nSource: Original\nLicence: Proprietary\nCommercial use: permitted\nRedistribution: permitted\n'
  assert.doesNotThrow(() => validateAttribution(valid))
  assert.throws(() => validateAttribution(valid.replace('Redistribution: permitted', 'Redistribution: unknown')))
})

test('canonical manifest requires the complete lighting and subject test set', () => {
  const images = REQUIRED_TEST_TAGS.map((tag, index) => ({ file: `test-${index}.jpg`, tags: [tag] }))
  images.push({ file: 'skin-01.jpg', tags: ['skin-tone'] })
  images.push({ file: 'skin-02.jpg', tags: ['skin-tone'] })
  images.push({ file: 'skin-03.jpg', tags: ['skin-tone'] })
  assert.doesNotThrow(() => validateTestManifest({ images }))
  assert.throws(() => validateTestManifest({ images: images.filter((image) => !image.tags.includes('gradients')) }))
  assert.throws(() => validateTestManifest({ images: [{ file: '../escape.jpg', tags: REQUIRED_TEST_TAGS }] }))
})

test('canonical image validation renders private comparisons without deployment assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'momints-filmstock-test-'))
  const outputRoot = join(root, 'output')
  try {
    await Promise.all(
      ['one.png', 'two.png', 'three.png'].map((name, index) =>
        sharp({
          create: { width: 2, height: 2, channels: 3, background: { r: 32 + index * 32, g: 96, b: 160 } },
        })
          .png()
          .toFile(join(root, name)),
      ),
    )
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({
        images: [
          { file: 'one.png', tags: [...REQUIRED_TEST_TAGS, 'skin-tone'] },
          { file: 'two.png', tags: ['skin-tone'] },
          { file: 'three.png', tags: ['skin-tone'] },
        ],
      }),
    )
    const report = await validateCanonicalImages({
      cube: parseCube(identityCube()),
      filmStockId: 'test-film-v1',
      testRoot: root,
      outputRoot,
    })
    assert.equal(report.results.length, 3)
    assert.equal((await stat(join(outputRoot, 'report.json'))).isFile(), true)
    assert.equal((await stat(join(outputRoot, report.results[0].comparison))).isFile(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

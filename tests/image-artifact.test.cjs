/* global __dirname */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { sourceLoader } = require('./helpers/load-source.cjs')

const contract = sourceLoader()('src/config/imageArtifact.ts')

test('permanent image contract accepts the launch boundary', () => {
  assert.equal(contract.PERMANENT_IMAGE_MAX_BYTES, 3 * 1024 * 1024)
  assert.equal(contract.PERMANENT_IMAGE_TARGET_BYTES, 2_900_000)
  assert.doesNotThrow(() =>
    contract.assertPermanentImageArtifact({
      mime: 'image/jpeg',
      byteLength: 2_900_000,
      width: 4000,
      height: 3000,
    }),
  )
})

test('byte, MIME and decoded geometry boundaries fail closed', () => {
  const valid = { mime: 'image/jpeg', byteLength: 2_900_000, width: 4000, height: 3000 }
  assert.throws(() => contract.assertPermanentImageArtifact({ ...valid, byteLength: 2_900_001 }), /maximum/)
  assert.throws(() => contract.assertPermanentImageArtifact({ ...valid, mime: 'image/png' }), /JPEG/)
  assert.throws(() => contract.assertPermanentImageArtifact({ ...valid, width: 4001 }), /contract/)
  assert.throws(() => contract.assertPermanentImageArtifact({ ...valid, width: 4000, height: 3001 }), /contract/)
  assert.doesNotThrow(() => contract.assertPermanentImageArtifact(valid, contract.PERMANENT_IMAGE_MAX_BYTES))
})

test('app and Worker constants cannot drift', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '../worker/src/rolls/config.ts'), 'utf8')
  assert.match(worker, /PERMANENT_IMAGE_MIME = 'image\/jpeg'/)
  assert.match(worker, /PERMANENT_IMAGE_MAX_BYTES = 3 \* 1024 \* 1024/)
  assert.match(worker, /PERMANENT_IMAGE_TARGET_BYTES = 2_900_000/)
  assert.match(worker, /PERMANENT_IMAGE_MAX_PIXELS = 12_000_000/)
  assert.match(worker, /PERMANENT_IMAGE_MAX_LONG_EDGE = 4_000/)
})

test('crop and size fitting failures are not allowed to substitute the input', () => {
  const crop = fs.readFileSync(path.resolve(__dirname, '../src/services/cropImage.ts'), 'utf8')
  const fit = fs.readFileSync(path.resolve(__dirname, '../src/services/compressImage.ts'), 'utf8')
  assert.doesNotMatch(crop, /catch \(error\)[\s\S]{0,180}return uri/)
  assert.doesNotMatch(fit, /catch \(error\)[\s\S]{0,220}return uri/)
  assert.match(crop, /throw new Error\(`Could not crop the capture/)
  assert.match(fit, /throw new Error\('Could not fit the developed image/)
})

test('camera fits every developed image before registration and roll exposure advancement', () => {
  const camera = fs.readFileSync(path.resolve(__dirname, '../src/app/camera.tsx'), 'utf8')
  const process = camera.indexOf('await processFilm(')
  const fit = camera.indexOf('await ensureUnderCeiling(', process)
  const verify = camera.indexOf('await verifyCompressedFilmOutput(', fit)
  const register = camera.indexOf('const photoId = addPhoto(', verify)
  const exposure = camera.indexOf('addFrameToRoll(photoId)', register)
  assert.ok(process < fit && fit < verify && verify < register && register < exposure)
  assert.doesNotMatch(camera.slice(process, register), /activeMode !== 'roll'/)
})

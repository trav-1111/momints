'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')

function loadKinoSettingsModule() {
  const tsCode = fs.readFileSync(path.join(__dirname, '../src/store/kinoSettings.ts'), 'utf8')
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText

  const customModule = { exports: {} }
  const mockFileSystem = {
    Paths: { document: '/tmp/momints-test-kino' },
    File: class MockFile {
      constructor() {
        this.exists = false
      }
      text() {
        return Promise.resolve('{}')
      }
      write() {}
    },
  }

  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', jsCode)
  fn(
    customModule,
    customModule.exports,
    (id) => {
      if (id === 'expo-file-system') return mockFileSystem
      if (id === 'zustand') return require('zustand')
      return require(id)
    },
    __dirname,
    __filename,
  )

  return customModule.exports
}

test('Kino settings: default values and constants are properly calibrated', () => {
  const mod = loadKinoSettingsModule()

  assert.equal(mod.SHUTTER_GAP_MS.off, 0)
  assert.equal(mod.SHUTTER_GAP_MS.subtle, 18)
  assert.equal(mod.SHUTTER_GAP_MS.classic, 32)
  assert.equal(mod.SHUTTER_GAP_MS.deep, 50)

  // 3 FPS = 333ms, 5 FPS = 200ms, 8 FPS = 125ms (Nikon F5 SLR motor drive cadence)
  assert.equal(mod.CAPTURE_CADENCE_MS[3], 333)
  assert.equal(mod.CAPTURE_CADENCE_MS[5], 200)
  assert.equal(mod.CAPTURE_CADENCE_MS[8], 125)

  assert.deepEqual(mod.KINO_CAPTURE_SPEEDS, [3, 5, 8])
  assert.deepEqual(mod.KINO_PLAYBACK_SPEEDS, [3, 5, 8, 12, 18, 24])
  assert.deepEqual(mod.KINO_SHUTTER_GAPS, ['off', 'subtle', 'classic', 'deep'])
})

test('Kino settings store: updates capture FPS, playback FPS, and cycles shutter gap', () => {
  const mod = loadKinoSettingsModule()
  const store = mod.useKinoSettingsStore

  // Defaults
  assert.equal(store.getState().captureFps, 5)
  assert.equal(store.getState().playbackFps, 8)
  assert.equal(store.getState().shutterGap, 'classic')

  // Capture FPS cycling: 5 -> 8 -> 3 -> 5
  const next1 = store.getState().cycleCaptureFps()
  assert.equal(next1, 8)
  assert.equal(store.getState().captureFps, 8)

  const next2 = store.getState().cycleCaptureFps()
  assert.equal(next2, 3)
  assert.equal(store.getState().captureFps, 3)

  const next3 = store.getState().cycleCaptureFps()
  assert.equal(next3, 5)
  assert.equal(store.getState().captureFps, 5)

  // Playback FPS updating
  store.getState().setPlaybackFps(12)
  assert.equal(store.getState().playbackFps, 12)
  store.getState().setPlaybackFps(18)
  assert.equal(store.getState().playbackFps, 18)
  store.getState().setPlaybackFps(8)
  assert.equal(store.getState().playbackFps, 8)

  // Shutter gap cycling: classic -> deep -> off -> subtle -> classic
  assert.equal(store.getState().shutterGap, 'classic')
  assert.equal(store.getState().cycleShutterGap(), 'deep')
  assert.equal(store.getState().cycleShutterGap(), 'off')
  assert.equal(store.getState().cycleShutterGap(), 'subtle')
  assert.equal(store.getState().cycleShutterGap(), 'classic')
})

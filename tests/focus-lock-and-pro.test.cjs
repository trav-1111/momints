'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')

function loadCameraManualModule() {
  const tsCode = fs.readFileSync(path.join(__dirname, '../modules/camera-manual/index.ts'), 'utf8')
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText

  let lastAppliedState = null

  const mockNative = {
    applyCameraState: (_tag, state) => {
      lastAppliedState = state
    },
    resetToAuto: () => {},
  }

  const customModule = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', jsCode)
  fn(
    customModule,
    customModule.exports,
    (id) => {
      if (id === 'expo-modules-core') {
        return {
          requireNativeModule: () => mockNative,
        }
      }
      return require(id)
    },
    __dirname,
    __filename,
  )

  return {
    module: customModule.exports,
    getLastAppliedState: () => lastAppliedState,
  }
}

test('CameraManual: applyCameraState correctly passes aeLock and afLock flags', () => {
  const { module: cameraManual, getLastAppliedState } = loadCameraManualModule()

  // 1. Both locked (AF/AE)
  cameraManual.applyCameraState(1, {
    exposureMode: 'auto',
    iso: null,
    shutterNs: null,
    focusMode: 'auto',
    focusDistance: null,
    whiteBalance: 'AUTO',
    metering: 'spot',
    meteringNormX: 0.35,
    meteringNormY: 0.72,
    aeLock: true,
    afLock: true,
  })

  let state = getLastAppliedState()
  assert.equal(state.aeLock, true)
  assert.equal(state.afLock, true)
  assert.equal(state.meteringMode, 'spot')
  assert.equal(state.meteringNormX, 0.35)
  assert.equal(state.meteringNormY, 0.72)

  // 2. AE only locked
  cameraManual.applyCameraState(1, {
    exposureMode: 'auto',
    iso: null,
    shutterNs: null,
    focusMode: 'auto',
    focusDistance: null,
    whiteBalance: 'AUTO',
    metering: 'spot',
    meteringNormX: 0.5,
    meteringNormY: 0.5,
    aeLock: true,
    afLock: false,
  })

  state = getLastAppliedState()
  assert.equal(state.aeLock, true)
  assert.equal(state.afLock, false)

  // 3. AF only locked
  cameraManual.applyCameraState(1, {
    exposureMode: 'auto',
    iso: null,
    shutterNs: null,
    focusMode: 'auto',
    focusDistance: null,
    whiteBalance: 'AUTO',
    metering: 'matrix',
    aeLock: false,
    afLock: true,
  })

  state = getLastAppliedState()
  assert.equal(state.aeLock, false)
  assert.equal(state.afLock, true)

  // 4. Fully unlocked
  cameraManual.applyCameraState(1, {
    exposureMode: 'auto',
    iso: null,
    shutterNs: null,
    focusMode: 'auto',
    focusDistance: null,
    whiteBalance: 'AUTO',
    metering: 'matrix',
    aeLock: false,
    afLock: false,
  })

  state = getLastAppliedState()
  assert.equal(state.aeLock, false)
  assert.equal(state.afLock, false)
})

test('Lock Mode cycling logic: transitions properly through AF/AE -> AE -> AF -> AF/AE', () => {
  function cycle(current) {
    if (current === 'AF/AE') return 'AE'
    if (current === 'AE') return 'AF'
    if (current === 'AF') return 'AF/AE'
    return 'AF/AE'
  }

  assert.equal(cycle('AF/AE'), 'AE')
  assert.equal(cycle('AE'), 'AF')
  assert.equal(cycle('AF'), 'AF/AE')
  assert.equal(cycle('none'), 'AF/AE')
})

test('Lock Mode flag derivations: aeLock and afLock adhere strictly to mode semantics', () => {
  function deriveFlags(lockMode) {
    return {
      isAeLocked: lockMode === 'AF/AE' || lockMode === 'AE',
      isAfLocked: lockMode === 'AF/AE' || lockMode === 'AF',
    }
  }

  // AF/AE locks both exposure and focus
  assert.deepEqual(deriveFlags('AF/AE'), { isAeLocked: true, isAfLocked: true })

  // AE locks exposure only (holds current lighting), focus remains continuous
  assert.deepEqual(deriveFlags('AE'), { isAeLocked: true, isAfLocked: false })

  // AF locks focus only (holds lens distance), exposure adapts continuously
  assert.deepEqual(deriveFlags('AF'), { isAeLocked: false, isAfLocked: true })

  // none locks neither
  assert.deepEqual(deriveFlags('none'), { isAeLocked: false, isAfLocked: false })
})

test('Composition Grid calculation: fits within aspect framing geometry', () => {
  const RATIO = {
    '1:1': 1,
    '4:3': 4 / 3,
    '16:9': 16 / 9,
  }

  function computeBox(aspect, width, height) {
    if (aspect === 'full') return { boxW: width, boxH: height, vBar: 0, hBar: 0 }
    const r = RATIO[aspect]
    let boxW = width
    let boxH = width * r
    if (boxH > height) {
      boxH = height
      boxW = height / r
    }
    const vBar = Math.max(0, (height - boxH) / 2)
    const hBar = Math.max(0, (width - boxW) / 2)
    return { boxW, boxH, vBar, hBar }
  }

  const screenW = 400
  const screenH = 800

  // 1:1 square crop
  const sq = computeBox('1:1', screenW, screenH)
  assert.equal(sq.boxW, 400)
  assert.equal(sq.boxH, 400)
  assert.equal(sq.vBar, 200)
  assert.equal(sq.hBar, 0)

  // 4:3 crop
  const f3 = computeBox('4:3', screenW, screenH)
  assert.equal(f3.boxW, 400)
  assert.equal(Math.round(f3.boxH), 533)
  assert.equal(Math.round(f3.vBar), 133)
  assert.equal(f3.hBar, 0)

  // Full screen
  const full = computeBox('full', screenW, screenH)
  assert.equal(full.boxW, 400)
  assert.equal(full.boxH, 800)
  assert.equal(full.vBar, 0)
  assert.equal(full.hBar, 0)
})

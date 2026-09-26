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

test('Rotary shutter blackout scaling: distinct and proportional across frame rates', () => {
  const tsCode = fs.readFileSync(path.join(__dirname, '../src/store/kinoSettings.ts'), 'utf8')
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText

  const customModule = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', jsCode)
  fn(
    customModule,
    customModule.exports,
    (id) => {
      if (id === 'expo-file-system') return { Paths: {}, File: class {} }
      if (id === 'zustand') return require('zustand')
      return require(id)
    },
    __dirname,
    __filename,
  )

  const { getShutterBlackoutMs } = customModule.exports

  // Off is always 0
  assert.equal(getShutterBlackoutMs('off', 8), 0)
  assert.equal(getShutterBlackoutMs('off', 24), 0)

  // At 8 FPS (period = 125ms): subtle < classic < deep
  const s8 = getShutterBlackoutMs('subtle', 8)
  const c8 = getShutterBlackoutMs('classic', 8)
  const d8 = getShutterBlackoutMs('deep', 8)
  assert.ok(s8 < c8, `Expected subtle (${s8}) < classic (${c8})`)
  assert.ok(c8 < d8, `Expected classic (${c8}) < deep (${d8})`)

  // At 24 FPS (period = 41.7ms): subtle < classic < deep
  const s24 = getShutterBlackoutMs('subtle', 24)
  const c24 = getShutterBlackoutMs('classic', 24)
  const d24 = getShutterBlackoutMs('deep', 24)
  assert.ok(s24 < c24, `Expected subtle (${s24}) < classic (${c24})`)
  assert.ok(c24 < d24, `Expected classic (${c24}) < deep (${d24})`)

  // Slower playback has longer absolute blackout duration
  assert.ok(d8 > d24, '8 FPS deep blackout should be longer than 24 FPS deep blackout')
})

test('Dual separated reticles: exposure point directs spot metering independently of focus point', () => {
  const { module: cameraManual, getLastAppliedState } = loadCameraManualModule()

  const focusPoint = { x: 0.2, y: 0.3 }
  const exposurePoint = { x: 0.7, y: 0.8 }

  // When separated and locked in AE/AF
  cameraManual.applyCameraState(1, {
    exposureMode: 'auto',
    iso: null,
    shutterNs: null,
    focusMode: 'auto',
    focusDistance: null,
    whiteBalance: 'AUTO',
    metering: 'spot',
    meteringNormX: exposurePoint.x,
    meteringNormY: exposurePoint.y,
    aeLock: true,
    afLock: true,
  })

  const state = getLastAppliedState()
  assert.equal(state.meteringMode, 'spot')
  assert.equal(state.meteringNormX, 0.7)
  assert.equal(state.meteringNormY, 0.8)
  assert.equal(state.aeLock, true)
  assert.equal(state.afLock, true)
})


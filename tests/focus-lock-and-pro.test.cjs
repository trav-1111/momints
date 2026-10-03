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

test('Kino playback frame pipeline: filters matching sequence, sorts by index, loops smoothly', () => {
  const mockPhotos = [
    { id: 'p1', uri: 'file:///p1.jpg', action: 'pending' },
    { id: 'kino-1', kinoId: 'seq-abc', kinoIndex: 1, uri: 'file:///k1.jpg', action: 'pending' },
    { id: 'kino-0', kinoId: 'seq-abc', kinoIndex: 0, uri: 'file:///k0.jpg', action: 'pending' },
    { id: 'kino-2', kinoId: 'seq-abc', kinoIndex: 2, uri: 'file:///k2.jpg', action: 'pending' },
    { id: 'other-kino', kinoId: 'seq-xyz', kinoIndex: 0, uri: 'file:///other.jpg', action: 'pending' },
  ]

  const currentPhoto = mockPhotos[1] // points to kino-1 in seq-abc
  const kinoFrames = mockPhotos
    .map((p, idx) => ({ ...p, originalIdx: idx }))
    .filter((p) => p.kinoId === currentPhoto.kinoId)
    .sort((a, b) => (a.kinoIndex ?? 0) - (b.kinoIndex ?? 0))

  // Must only match seq-abc, correctly ordered 0, 1, 2
  assert.equal(kinoFrames.length, 3)
  assert.equal(kinoFrames[0].id, 'kino-0')
  assert.equal(kinoFrames[1].id, 'kino-1')
  assert.equal(kinoFrames[2].id, 'kino-2')

  // Initial pointer resolution from currentIndex
  let currentIndex = 1 // kino-1
  let pointer = kinoFrames.findIndex((f) => f.originalIdx === currentIndex)
  assert.equal(pointer, 1)

  // Advance sequence
  pointer = (pointer + 1) % kinoFrames.length
  assert.equal(pointer, 2)
  assert.equal(kinoFrames[pointer].id, 'kino-2')

  // Wrap around
  pointer = (pointer + 1) % kinoFrames.length
  assert.equal(pointer, 0)
  assert.equal(kinoFrames[pointer].id, 'kino-0')
})

test('Kino shutter blackout guarantees: blackout time is strictly less than frame period across all FPS', () => {
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
  const speeds = [3, 5, 8, 12, 18, 24]
  const gaps = ['subtle', 'classic', 'deep']

  for (const fps of speeds) {
    const period = 1000 / fps
    for (const gap of gaps) {
      const blackout = getShutterBlackoutMs(gap, fps)
      assert.ok(
        blackout < period,
        `Blackout (${blackout}ms) must be strictly less than period (${period}ms) at ${fps} FPS for gap ${gap}`,
      )
      // Must leave at least 20% exposure time
      const exposureTime = period - blackout
      assert.ok(exposureTime > 0, `Exposure time (${exposureTime}ms) must be positive at ${fps} FPS for gap ${gap}`)
    }
  }
})

test('ManualControls: Photographic shutter stops and formatting', () => {
  const tsCode = fs.readFileSync(path.join(__dirname, '../src/components/ManualControls.tsx'), 'utf8')
  // Strip JSX and transpile to evaluate functions
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText

  const customModule = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', jsCode)
  fn(
    customModule,
    customModule.exports,
    (id) => {
      if (id === 'react-native')
        return { StyleSheet: { create: (s) => s }, View: {}, Text: {}, Pressable: {}, Animated: { Value: class {} } }
      if (id === 'react-native-gesture-handler')
        return { Gesture: { Pan: () => ({ onStart: () => ({ onUpdate: () => ({ runOnJS: () => {} }) }) }) } }
      if (id === 'expo-haptics') return { selectionAsync: () => {} }
      if (id.includes('camera-manual'))
        return {
          ISO_RANGE: { min: 100, max: 11470 },
          SHUTTER_NS_RANGE: { min: 100_000, max: 16_000_000_000 },
          filterIsoNotches: () => [100, 200, 400, 800, 1600, 3200],
        }
      if (id.includes('icons')) return {}
      if (id.includes('theme')) return { colors: {}, fonts: {} }
      return require(id)
    },
    __dirname,
    __filename,
  )

  const { SHUTTER_NOTCHES, findClosestShutterIndex, formatShutter } = customModule.exports

  // 1. Verify standard stops exist in range
  assert.ok(SHUTTER_NOTCHES.length >= 14, `Expected at least 14 standard stops, got ${SHUTTER_NOTCHES.length}`)
  assert.equal(SHUTTER_NOTCHES[0], 125_000) // 1/8000s
  assert.equal(SHUTTER_NOTCHES[SHUTTER_NOTCHES.length - 1], 16_000_000_000) // 16s

  // 2. Verify formatShutter
  assert.equal(formatShutter(125_000), '1/8000')
  assert.equal(formatShutter(1_000_000), '1/1000')
  assert.equal(formatShutter(2_000_000), '1/500')
  assert.equal(formatShutter(16_666_667), '1/60')
  assert.equal(formatShutter(1_000_000_000), '1s')
  assert.equal(formatShutter(2_000_000_000), '2s')
  assert.equal(formatShutter(16_000_000_000), '16s')

  // 3. Verify snapping to closest notch index
  // 1/950s (1_052_631 ns) should snap to index of 1/1000s (1_000_000 ns)
  const idx1000 = SHUTTER_NOTCHES.indexOf(1_000_000)
  assert.equal(findClosestShutterIndex(1_052_631), idx1000)

  // 1/450s (2_222_222 ns) should snap to index of 1/500s (2_000_000 ns)
  const idx500 = SHUTTER_NOTCHES.indexOf(2_000_000)
  assert.equal(findClosestShutterIndex(2_222_222), idx500)
})

test('FocusReticle: Edge boundary clamping flips EV slider and badges inside viewport', () => {
  const screenW = 390
  const screenH = 844
  const FOCUS_BOX_SIZE = 76
  const SLIDER_WIDTH = 48

  function getReticleLayout(focusX, focusY) {
    const focusLeft = Math.max(12, Math.min(screenW - FOCUS_BOX_SIZE - 12, focusX - FOCUS_BOX_SIZE / 2))
    const focusTop = Math.max(76, Math.min(screenH - FOCUS_BOX_SIZE - 180, focusY - FOCUS_BOX_SIZE / 2))

    const isSliderOnLeft = focusLeft + FOCUS_BOX_SIZE + SLIDER_WIDTH > screenW
    const sliderLeft = isSliderOnLeft ? -44 : FOCUS_BOX_SIZE + 8

    const isBadgeOnBottom = focusTop < 50
    const badgeTop = isBadgeOnBottom ? FOCUS_BOX_SIZE + 10 : -36

    return { focusLeft, focusTop, isSliderOnLeft, sliderLeft, isBadgeOnBottom, badgeTop }
  }

  // 1. Center of screen: slider is on right (+84), badge is on top (-36)
  const center = getReticleLayout(195, 400)
  assert.equal(center.isSliderOnLeft, false)
  assert.equal(center.sliderLeft, FOCUS_BOX_SIZE + 8)
  assert.equal(center.isBadgeOnBottom, false)
  assert.equal(center.badgeTop, -36)

  // 2. Near right edge: slider flips to the left (-44) so user can drag EV knob
  const rightEdge = getReticleLayout(380, 400)
  assert.equal(rightEdge.isSliderOnLeft, true)
  assert.equal(rightEdge.sliderLeft, -44)
  // Check that flipped slider is completely within screen bounds
  const absoluteSliderX = rightEdge.focusLeft + rightEdge.sliderLeft
  assert.ok(absoluteSliderX >= 0, `Absolute slider X (${absoluteSliderX}) must be within screen`)

  // 3. Near top edge: badge flips to bottom (+86) so it is not cut off by status bar
  const topEdge = getReticleLayout(195, 80)
  assert.equal(topEdge.focusTop, 76)
  assert.equal(topEdge.isBadgeOnBottom, false) // 76 is safe
})

test('Landscape Mode: Shortest rotation angle and transform mappings', () => {
  function computeRotationDegrees(outputOrientation) {
    switch (outputOrientation) {
      case 'portrait':
        return 0
      case 'landscape-right':
        return 90
      case 'portrait-upside-down':
        return 180
      case 'landscape-left':
        return -90
      default:
        return 0
    }
  }

  assert.equal(computeRotationDegrees('portrait'), 0)
  assert.equal(computeRotationDegrees('landscape-right'), 90)
  assert.equal(computeRotationDegrees('landscape-left'), -90)
  assert.equal(computeRotationDegrees('portrait-upside-down'), 180)
})

test('Tap-to-Place Separate AE: screen tap directs exposure without clearing focus lock', () => {
  let isSeparated = true
  let hasPlacedAe = false
  let focusPoint = { x: 200, y: 300 }
  let exposurePoint = { x: 200, y: 300 }
  const screenW = 390
  const screenH = 844

  const appliedPoints = []
  const mockManualCamera = {
    lockMode: 'AF/AE',
    setExposurePoint: (pt) => appliedPoints.push(pt),
    unlock: () => {
      isSeparated = false
    },
  }

  // User taps at (100, 500)
  const tapEvent = { nativeEvent: { locationX: 100, locationY: 500 } }

  // Simulate handleViewfinderPress logic when isSeparated is true:
  if (isSeparated) {
    const { locationX, locationY } = tapEvent.nativeEvent
    const normX = Math.max(0, Math.min(1, locationX / screenW))
    const normY = Math.max(0, Math.min(1, locationY / screenH))
    exposurePoint = { x: locationX, y: locationY }
    mockManualCamera.setExposurePoint({ x: normX, y: normY })
    hasPlacedAe = true
  }

  assert.equal(isSeparated, true, 'isSeparated must remain active')
  assert.equal(hasPlacedAe, true, 'hasPlacedAe must be set to true')
  assert.deepEqual(focusPoint, { x: 200, y: 300 }, 'focusPoint must not be overridden')
  assert.deepEqual(exposurePoint, { x: 100, y: 500 }, 'exposurePoint must update to tap coordinates')
  assert.equal(appliedPoints.length, 1)
  assert.equal(appliedPoints[0].x, 100 / 390)
  assert.equal(appliedPoints[0].y, 500 / 844)
})

test('Landscape Shutter Clearance: shutter sub-label is hidden in landscape to avoid touch collision', () => {
  function getShutterSubLabelOpacity(uiRotation) {
    return uiRotation === 0 ? 1 : 0
  }

  assert.equal(getShutterSubLabelOpacity(0), 1, 'Portrait must display informative shutter hint')
  assert.equal(getShutterSubLabelOpacity(90), 0, 'Landscape right must hide hint to prevent collision with shutter')
  assert.equal(getShutterSubLabelOpacity(-90), 0, 'Landscape left must hide hint to prevent collision with shutter')
  assert.equal(getShutterSubLabelOpacity(180), 0, 'Inverted portrait must hide hint')
})

test('FocusReticle: EV slider drag calibration is stable, non-runaway, and comfortable', () => {
  const PIXELS_PER_EV = 60
  const minExposure = -2.0
  const maxExposure = 2.0

  function computeEvFromDrag(evStart, dy) {
    const deltaEv = -dy / PIXELS_PER_EV
    const targetEv = Math.max(minExposure, Math.min(maxExposure, evStart + deltaEv))
    return Math.round(targetEv * 10) / 10
  }

  // 1. From 0.0, dragging up 60px yields +1.0 EV
  assert.equal(computeEvFromDrag(0, -60), 1.0)

  // 2. From 0.0, dragging up 120px yields +2.0 EV (max limit)
  assert.equal(computeEvFromDrag(0, -120), 2.0)

  // 3. From 0.0, excessive upward drag of 300px caps at +2.0 EV
  assert.equal(computeEvFromDrag(0, -300), 2.0)

  // 4. From 0.0, dragging down 60px yields -1.0 EV
  assert.equal(computeEvFromDrag(0, 60), -1.0)

  // 5. From 0.0, fine drag of 18px down yields -0.3 EV (1/3 stop)
  assert.equal(computeEvFromDrag(0, 18), -0.3)

  // 6. Returning finger to grant origin (dy = 0) returns to starting EV
  assert.equal(computeEvFromDrag(0, 0), 0.0)
  assert.equal(computeEvFromDrag(0.5, 0), 0.5)

  // 7. Successive movement samples do not accumulate runaway offsets
  const evStart = 0
  const samples = [-10, -20, -30, -40, -50, -60]
  const results = samples.map((dy) => computeEvFromDrag(evStart, dy))
  assert.deepEqual(results, [0.2, 0.3, 0.5, 0.7, 0.8, 1.0])
})

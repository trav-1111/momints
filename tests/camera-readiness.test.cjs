/* global __dirname */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { act, create } = require('react-test-renderer')
const { sourceLoader } = require('./helpers/load-source.cjs')
global.IS_REACT_ACT_ENVIRONMENT = true

async function harness() {
  const calls = []
  const load = sourceLoader({
    'react-native': { findNodeHandle: (view) => view?.tag ?? null },
    'modules/camera-caps/index.ts': { getCameraCapabilities: () => [] },
    'modules/camera-manual/index.ts': {
      applyCameraState: (viewTag, cameraId, state) =>
        new Promise((resolve, reject) => calls.push({ viewTag, cameraId, state, resolve, reject })),
    },
  })
  const { useCameraReadiness } = load('src/hooks/useCameraReadiness.ts')
  const { useManualCameraState } = load('src/hooks/useManualCameraState.ts')
  let value
  function Probe({ cameraId = '0', active = true }) {
    const readiness = useCameraReadiness(cameraId, active)
    const controls = useManualCameraState(readiness.session, cameraId, 20, readiness.isCurrent)
    value = { readiness, controls }
    return null
  }
  let root
  await act(async () => {
    root = create(React.createElement(Probe))
  })
  const h = {
    calls,
    get value() {
      return value
    },
    async update(props) {
      await act(async () => root.update(React.createElement(Probe, props)))
    },
    async run(fn) {
      await act(async () => fn(value))
    },
    async bind(cameraId) {
      if (cameraId) await h.update({ cameraId })
      await h.run(({ readiness }) => {
        readiness.ref({ tag: 101 })
        readiness.onInitialized()
        readiness.onStarted()
      })
    },
    async resolve(index = calls.length - 1) {
      await act(async () => calls[index].resolve())
    },
    async reject(error, index = calls.length - 1) {
      await act(async () => calls[index].reject(error))
    },
    async close() {
      await act(async () => root.unmount())
    },
  }
  return h
}
const notBound = () => Object.assign(new Error('not bound'), { code: 'ERR_CAMERA_NOT_BOUND' })

test('a ref and initialized event are insufficient until the camera starts and settings acknowledge', async () => {
  const h = await harness()
  try {
    await h.run(({ readiness }) => readiness.ref({ tag: 101 }))
    assert.equal(h.calls.length, 0)
    await h.run(({ readiness }) => readiness.onInitialized())
    assert.equal(h.calls.length, 0)
    await h.run(({ readiness }) => readiness.onStarted())
    assert.equal(h.calls.length, 1)
    assert.equal(h.value.controls.canCapture(), false)
    await h.resolve()
    assert.equal(h.value.controls.controlsReady, true)
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('stop invalidates capture synchronously; restart reapplies the full desired state', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.resolve()
    await h.run(({ readiness, controls }) => {
      readiness.onStopped()
      assert.equal(controls.canCapture(), false)
    })
    await h.run(({ controls }) => controls.setWhiteBalance('DAYLIGHT'))
    assert.equal(h.calls.length, 1)
    await h.run(({ readiness }) => readiness.onStarted())
    assert.equal(h.calls.length, 2)
    assert.equal(h.calls[1].state.whiteBalance, 'DAYLIGHT')
    assert.equal(h.calls[1].state.exposureMode, 'auto')
    await h.resolve()
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('lens identity changes disable capture immediately, even with the same view tag', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.resolve()
    await h.update({ cameraId: '1' })
    assert.equal(h.value.controls.canCapture(), false)
    assert.equal(h.calls.length, 1)
    await h.run(({ readiness }) => {
      readiness.onInitialized()
      readiness.onStarted()
    })
    assert.equal(h.calls[1].viewTag, 101)
    assert.equal(h.calls[1].cameraId, '1')
    await h.resolve()
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('a previous session completion cannot enable capture in a rebound session', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.run(({ readiness }) => {
      readiness.onInitialized()
      readiness.onStarted()
    })
    assert.equal(h.calls.length, 2)
    await h.resolve(0)
    assert.equal(h.value.controls.canCapture(), false)
    await h.resolve(1)
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('rapid settings changes reject stale acknowledgements and accept only the latest full state', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.resolve()
    await h.run(({ controls }) => {
      controls.setExposureMode('manual')
      controls.setManualIso(800)
    })
    assert.equal(h.value.controls.canCapture(), false)
    await h.run(({ controls }) => controls.setManualIso(1600))
    await h.resolve(1)
    assert.equal(h.value.controls.canCapture(), false)
    assert.equal(h.calls[2].state.iso, 1600)
    assert.equal(h.calls[2].state.shutterNs, 1000000)
    assert.equal(h.calls[2].state.whiteBalance, 'AUTO')
    await h.resolve(2)
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('focus/background inactivity and ref detach reject otherwise valid acknowledgements', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.update({ active: false })
    await h.resolve()
    assert.equal(h.value.controls.canCapture(), false)
    await h.run(({ readiness }) => readiness.invalidate())
    await h.update({ active: true })
    assert.equal(h.value.controls.canCapture(), false)
    await h.run(({ readiness }) => readiness.onStarted())
    await h.resolve()
    await h.run(({ readiness, controls }) => {
      readiness.ref(null)
      assert.equal(controls.canCapture(), false)
    })
    assert.equal(h.value.controls.controlsReady, false)
  } finally {
    await h.close()
  }
})

test('only the known not-bound race retries, at most three attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = await harness()
  try {
    await h.bind()
    await h.reject(notBound())
    await act(async () => t.mock.timers.tick(100))
    assert.equal(h.calls.length, 2)
    await h.reject(notBound())
    await act(async () => t.mock.timers.tick(200))
    assert.equal(h.calls.length, 3)
    await h.reject(notBound())
    await act(async () => t.mock.timers.tick(10000))
    assert.equal(h.calls.length, 3)
    assert.equal(h.value.controls.controlsError.code, 'ERR_CAMERA_NOT_BOUND')
    assert.equal(h.value.controls.canCapture(), false)
  } finally {
    await h.close()
  }
})

test('a binding-race retry can recover, but capture waits for its acknowledgement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = await harness()
  try {
    await h.bind()
    await h.reject(notBound())
    await act(async () => t.mock.timers.tick(100))
    assert.equal(h.calls.length, 2)
    assert.equal(h.value.controls.canCapture(), false)
    await h.resolve()
    assert.equal(h.value.controls.canCapture(), true)
    assert.equal(h.value.controls.controlsError, null)
  } finally {
    await h.close()
  }
})

test('stop cancels queued retries and stale promise rejections are ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = await harness()
  try {
    await h.bind()
    await h.reject(notBound())
    await h.run(({ readiness }) => readiness.onStopped())
    await act(async () => t.mock.timers.tick(10000))
    assert.equal(h.calls.length, 1)
    await h.run(({ readiness }) => readiness.onStarted())
    await h.update({ cameraId: '1' })
    await h.reject(new Error('old session failed'))
    assert.equal(h.value.controls.controlsError, null)
  } finally {
    await h.close()
  }
})

test('unmount cancels retries and ignores outstanding completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = await harness()
  await h.bind()
  await h.reject(notBound())
  await h.close()
  await act(async () => t.mock.timers.tick(10000))
  assert.equal(h.calls.length, 1)
  await h.resolve()
})

test('unexpected failures are surfaced without retry; explicit retry requires a new acknowledgement', async () => {
  for (const code of [
    'ERR_CAMERA_STATE_TIMEOUT',
    'ERR_CAMERA_SESSION_CHANGED',
    'ERR_CAMERA_STATE_APPLY',
    'ERR_CAMERA_STATE_CANCELLED',
  ]) {
    const h = await harness()
    try {
      await h.bind()
      await h.reject(Object.assign(new Error(code), { code }))
      assert.equal(h.calls.length, 1)
      assert.equal(h.value.controls.controlsError.code, code)
      assert.equal(h.value.controls.canCapture(), false)
      await h.run(({ controls }) => controls.retry())
      assert.equal(h.calls.length, 2)
      assert.equal(h.value.controls.controlsError, null)
      await h.resolve()
      assert.equal(h.value.controls.canCapture(), true)
    } finally {
      await h.close()
    }
  }
})

test('reset works while unbound and submits complete auto state on resume', async () => {
  const h = await harness()
  try {
    await h.run(({ controls }) => {
      controls.setExposureMode('manual')
      controls.setFocusMode('manual')
      controls.setWhiteBalance('SHADE')
      controls.setMeteringMode('spot')
    })
    await h.run(({ controls }) => controls.reset())
    assert.equal(h.calls.length, 0)
    await h.bind()
    const state = h.calls[0].state
    assert.equal(state.exposureMode, 'auto')
    assert.equal(state.iso, null)
    assert.equal(state.focusMode, 'auto')
    assert.equal(state.focusDistance, null)
    assert.equal(state.whiteBalance, 'AUTO')
    assert.equal(state.metering, 'matrix')
    await h.resolve()
    assert.equal(h.value.controls.canCapture(), true)
  } finally {
    await h.close()
  }
})

test('camera runtime errors invalidate capture rather than throwing through React', async () => {
  const h = await harness()
  try {
    await h.bind()
    await h.resolve()
    const failure = new Error('camera restricted')
    await h.run(({ readiness, controls }) => {
      readiness.onError(failure)
      assert.equal(controls.canCapture(), false)
    })
    assert.equal(h.value.readiness.error, failure)
    assert.equal(h.value.controls.controlsReady, false)
  } finally {
    await h.close()
  }
})

test('JS wrapper waits for native acknowledgement and supplies camera identity', async () => {
  let args, resolve
  const load = sourceLoader({
    'expo-modules-core': {
      requireNativeModule: () => ({
        applyCameraState: (...values) => {
          args = values
          return new Promise((done) => {
            resolve = done
          })
        },
      }),
    },
  })
  const wrapper = load('modules/camera-manual/index.ts')
  let complete = false
  const promise = wrapper
    .applyCameraState(101, '0', {
      exposureMode: 'manual',
      iso: 800,
      shutterNs: 1000000,
      focusMode: 'auto',
      focusDistance: null,
      whiteBalance: 'DAYLIGHT',
      metering: 'matrix',
    })
    .then(() => {
      complete = true
    })
  await Promise.resolve()
  assert.equal(complete, false)
  assert.deepEqual(args.slice(0, 2), [101, '0'])
  assert.equal(args[2].awbMode, 5)
  resolve()
  await promise
  assert.equal(complete, true)
})

test('capture gate precedes sensor call and queue entry; native acknowledgement is bounded and identity checked', () => {
  const camera = fs.readFileSync(path.join(__dirname, '../src/app/camera.tsx'), 'utf8')
  const gate = camera.indexOf('if (!cameraRef.current || !canCapture()) return')
  const sensor = camera.indexOf('cameraRef.current.takePhoto(')
  assert.ok(gate > 0 && sensor > gate)
  assert.ok(camera.indexOf('const photoId = addPhoto(', sensor) > sensor)
  assert.ok(camera.includes('disabled={isCapturing || !controlsReady}'))
  const native = fs.readFileSync(
    path.join(
      __dirname,
      '../modules/camera-manual/android/src/main/java/expo/modules/cameramanual/CameraManualModule.kt',
    ),
    'utf8',
  )
  assert.ok(native.includes('AsyncFunction("applyCameraState")'))
  assert.ok(native.includes('future.addListener'))
  assert.ok(native.includes('handler.removeCallbacks(timeout)'))
  assert.ok(native.includes('requireCamera(viewTag, cameraId) !== camera'))
  assert.ok(native.includes('ERR_CAMERA_STATE_TIMEOUT'))
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

test('camera-raw module exports correct API and handles sensor probing', async () => {
  let queriedCameraId = null
  const mockNative = {
    isRawSupported: (id) => {
      queriedCameraId = id
      return id === '0'
    },
    getRawSensorInfo: (id) => {
      if (id !== '0') return null
      return {
        supported: true,
        cameraId: '0',
        width: 4000,
        height: 3000,
        cfaPattern: 1,
        cfaPatternName: 'GRBG',
        whiteLevel: 1023,
        blackLevel: [64, 64, 64, 64],
        isoRange: { min: 100, max: 11470 },
        shutterRangeNs: { min: 100000, max: 16000000000 },
        hasOis: true,
      }
    },
    captureRawDng: async (options) => ({
      dngUri: 'file:///cache/momints_raw_12345.dng',
      dngPath: '/cache/momints_raw_12345.dng',
      dngByteLength: 14500000,
      jpegUri: 'file:///cache/momints_frame_12345.jpg',
      jpegPath: '/cache/momints_frame_12345.jpg',
      jpegByteLength: 2650000,
      width: 4000,
      height: 3000,
      capturedAt: 12345,
    }),
  }

  const load = sourceLoader({
    'expo-modules-core': {
      requireNativeModule: (name) => {
        assert.equal(name, 'CameraRaw')
        return mockNative
      },
    },
  })

  const { isRawSupported, getRawSensorInfo, captureRawDng } = load('modules/camera-raw/index.ts')

  // 1. Probe isRawSupported
  assert.equal(isRawSupported('0'), true)
  assert.equal(queriedCameraId, '0')
  assert.equal(isRawSupported('1'), false)
  assert.equal(isRawSupported(), true) // defaults to camera 0

  // 2. Sensor metrics
  const info = getRawSensorInfo('0')
  assert.ok(info)
  assert.equal(info.supported, true)
  assert.equal(info.width, 4000)
  assert.equal(info.height, 3000)
  assert.equal(info.cfaPatternName, 'GRBG')
  assert.equal(info.whiteLevel, 1023)
  assert.equal(info.hasOis, true)

  const frontInfo = getRawSensorInfo('1')
  assert.equal(frontInfo, null)

  // 3. captureRawDng execution
  const capture = await captureRawDng({
    viewTag: 101,
    includeJpeg: true,
  })
  assert.equal(capture.dngUri, 'file:///cache/momints_raw_12345.dng')
  assert.equal(capture.width, 4000)
  assert.equal(capture.height, 3000)
  assert.ok(capture.dngByteLength > 0)
  assert.ok(capture.jpegByteLength > 0)
})

test('captureRawDng supplies strict defaults and rejects missing capabilities', async () => {
  let passedOptions = null
  const mockNative = {
    isRawSupported: () => false,
    getRawSensorInfo: () => null,
    captureRawDng: async (opts) => {
      passedOptions = opts
      if (opts.cameraId === 'unsupported') {
        throw new Error('ERR_RAW_UNSUPPORTED: Camera does not support RAW')
      }
      return {
        dngUri: 'file:///cache/test.dng',
        dngPath: '/cache/test.dng',
        dngByteLength: 100,
        width: 4000,
        height: 3000,
        capturedAt: 1,
      }
    },
  }

  const load = sourceLoader({
    'expo-modules-core': {
      requireNativeModule: () => mockNative,
    },
  })

  const { captureRawDng } = load('modules/camera-raw/index.ts')

  await captureRawDng()
  assert.equal(passedOptions.cameraId, '0')
  assert.equal(passedOptions.includeJpeg, true)
  assert.equal(passedOptions.orientation, undefined, 'native Camera2 must infer orientation when omitted')

  await assert.rejects(
    async () => {
      await captureRawDng({ cameraId: 'unsupported' })
    },
    { message: /ERR_RAW_UNSUPPORTED/ },
  )
})

test('camera UI wires raw capability and photo store registers raw negative', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const cameraSrc = fs.readFileSync(path.join(__dirname, '../src/app/camera.tsx'), 'utf8')

  assert.ok(cameraSrc.includes("import { captureRawDng, isRawSupported } from '../../modules/camera-raw'"))
  assert.ok(cameraSrc.includes('const [rawMode, setRawMode] = useState(false)'))
  assert.ok(cameraSrc.includes('const isRawHardwareSupported = useMemo('))
  assert.ok(cameraSrc.includes('captureRawDng('))
  assert.ok(cameraSrc.includes('rawMode ? \'RAW\' : \'JPG\''))

  // Verify photo store adds raw negative fields
  const photosSrc = fs.readFileSync(path.join(__dirname, '../src/store/photos.ts'), 'utf8')
  assert.ok(photosSrc.includes('rawNegativeUri?: string'))
  assert.ok(photosSrc.includes('rawNegativeBytes?: number'))
})

test('the shutter callback tracks the current RAW selection and camera settings', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const ts = require('typescript')
  const source = fs.readFileSync(path.join(__dirname, '../src/app/camera.tsx'), 'utf8')
  const parsed = ts.createSourceFile('camera.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let dependencies
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleCapture') {
      assert.ok(ts.isCallExpression(node.initializer))
      const deps = node.initializer.arguments[1]
      assert.ok(ts.isArrayLiteralExpression(deps))
      dependencies = deps.elements.map((element) => element.getText(parsed))
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(dependencies, 'capture callback was not found')
  for (const value of ['rawMode', 'isRawHardwareSupported', 'manualCamera', 'cameraReadiness']) {
    assert.ok(dependencies.includes(value), `${value} may be stale when the shutter is pressed`)
  }
})

test('Camera2 RAW stills orient both JPEG and DNG from sensor and display rotation', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const native = fs.readFileSync(
    path.join(__dirname, '../modules/camera-raw/android/src/main/java/expo/modules/cameraraw/CameraRawModule.kt'),
    'utf8',
  )
  assert.match(native, /SENSOR_ORIENTATION/)
  assert.match(native, /\.rotation/)
  assert.match(native, /set\(CaptureRequest\.JPEG_ORIENTATION, jpegOrientation\)/)
  assert.match(native, /dngCreator\.setOrientation\(exifOrientation\)/)
  assert.match(native, /ExifInterface\.ORIENTATION_ROTATE_90/)
  assert.match(native, /ExifInterface\.ORIENTATION_ROTATE_270/)
})

test('a missing paired JPEG cannot be passed to the film renderer as a DNG', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const camera = fs.readFileSync(path.join(__dirname, '../src/app/camera.tsx'), 'utf8')
  assert.doesNotMatch(camera, /rawResult\.jpegPath\s*\?\?\s*rawResult\.dngPath/)
  assert.match(camera, /if \(!rawResult\.jpegPath\) throw new Error/)
})


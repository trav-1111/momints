const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./load-source.cjs')

function find(node, predicate) {
  if (predicate(node)) return node
  return ts.forEachChild(node, (child) => find(child, predicate))
}

// Execute the real screen callback with real immutable session/photo stores.
// Only native capture/rendering, React setters and filesystem boundaries are mocked.
async function captureBurst({
  start = 1,
  size = 12,
  count = 2,
  mode = 'roll',
  beforePersist,
  beforeRender,
  beforeStart,
  concurrent = false,
} = {}) {
  const source = ts.createSourceFile(
    'camera.tsx',
    fs.readFileSync('src/app/camera.tsx', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const declaration = find(
    source,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleStartCrank',
  )
  const callbackCode = ts.transpileModule(`const callback = ${declaration.initializer.arguments[0].getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const load = sourceLoader({
    'expo-file-system': {
      Paths: { document: 'synthetic' },
      File: class {
        exists = false
        write() {}
      },
    },
  })
  const { useSessionStore: session, sessionHydrated } = load('src/store/session.ts')
  const photos = load('src/store/photos.ts').usePhotoStore
  await sessionHydrated
  const activeRoll = {
    id: 'test-roll',
    name: '2026-10-11.01',
    size,
    film: { mode: 'color', filmStockId: 'test-film-v1' },
    aspect: 'full',
    frameIds: Array.from({ length: start }, (_, i) => `prior-${i}`),
    startedAt: 0,
    developed: false,
  }
  session.setState({ activeRoll, activeMode: mode })
  const cranking = { current: false }
  let captured = 0
  const persisted = [],
    alerts = [],
    errors = []
  const noop = () => {}
  const scope = {
    console: { error: (...args) => errors.push(args) },
    activeRoll,
    activeMode: mode,
    isCapturing: false,
    canCapture: () => true,
    effectiveFilm: activeRoll.film,
    isFilmStockDownloaded: () => true,
    filmCatalogue: [],
    ensureFilmStockRecipe: noop,
    rollIsFull: false,
    Alert: { alert: (...args) => alerts.push(args) },
    mintRoll: noop,
    isCrankingRef: cranking,
    burstInFlightRef: { current: false },
    didCrankRef: { current: false },
    setIsCranking: noop,
    setCrankCount: noop,
    captureFps: 1,
    CAPTURE_CADENCE_MS: { 1: 0 },
    Vibration: { vibrate: noop },
    cameraRef: {
      current: {
        takeSnapshot: async () => {
          captured++
          if (captured === count) cranking.current = false
          return { path: `capture-${captured}.jpg` }
        },
      },
    },
    setKinoDevelopingCount: noop,
    setIsCapturing: noop,
    effectiveAspect: 'full',
    adoptTemporaryCapture: (uri) => uri,
    cropToAspect: async (uri) => uri,
    processFilm: async (uri) => {
      await beforeRender?.(session)
      return {
        outputUri: uri,
        filmStockId: 'test-film-v1',
        mime: 'image/jpeg',
        byteLength: 100,
        width: 10,
        height: 10,
        outputSha256: uri,
        renderer: 'native-egl-v2',
        recipeSha256: 'test',
      }
    },
    ensureUnderCeiling: async (uri) => uri,
    verifyCompressedFilmOutput: async (receipt) => receipt,
    addPhoto: photos.getState().addPhoto,
    setAction: photos.getState().setAction,
    usePhotoStore: photos,
    useSessionStore: session,
    deleteCapture: noop,
    removePhoto: photos.getState().removePhoto,
    persistRollFrame: async (photo, frameNumber) => {
      await beforePersist?.(photo, frameNumber, session)
      persisted.push({
        photoId: photo.id,
        frameNumber,
        sessionCountBeforeCommit: session.getState().activeRoll.frameIds.length,
      })
      return `test-vault:${photo.id}`
    },
    updatePhotoUri: photos.getState().updatePhotoUri,
    addFrameToRoll: session.getState().addFrameToRoll,
    developRoll: session.getState().developRoll,
  }
  const callback = new Function(...Object.keys(scope), callbackCode + '; return callback;')(...Object.values(scope))
  beforeStart?.(session)
  if (concurrent) await Promise.all([callback(), callback()])
  else await callback()
  assert.equal(cranking.current, false)
  return { photos: photos.getState().photos, roll: session.getState().activeRoll, persisted, alerts, errors, captured }
}

module.exports = { captureBurst }

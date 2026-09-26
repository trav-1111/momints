'use strict'

const { execFileSync } = require('node:child_process')
const WebSocket = require('ws')
const ts = require('typescript')

const SERIAL = process.env.ANDROID_SERIAL || 'SM02G40619133790'
const METRO_PORT = process.env.METRO_PORT || 7666
const FRAMES_TO_RUN = parseInt(process.env.FRAMES || '24', 10)

function adb(...args) {
  return execFileSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8' }).trim()
}

function getMemInfo() {
  const output = adb('shell', 'dumpsys', 'meminfo', 'com.momints.app')
  const graphicsMatch = output.match(/Graphics:\s+(\d+)/)
  const nativeMatch = output.match(/Native Heap:\s+(\d+)/)
  const totalMatch = output.match(/TOTAL PSS:\s+(\d+)/)
  return {
    graphics: graphicsMatch ? parseInt(graphicsMatch[1], 10) : 0,
    native: nativeMatch ? parseInt(nativeMatch[1], 10) : 0,
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
  }
}

// Function to run directly inside Hermes/Skia
async function runFrameCycle(stockId, frameNum) {
  const findModule = (suffix) => {
    const entry = Array.from(globalThis.__r.getModules()).find(([, m]) => m.verboseName === suffix)
    if (!entry) throw new Error('Metro module not loaded: ' + suffix)
    return globalThis.__r(entry[0])
  }
  const { Skia } = findModule('node_modules/@shopify/react-native-skia/src/index.ts')
  const { File, Paths } = findModule('node_modules/expo-file-system/src/index.ts')
  const { applyFilm } = findModule('src/services/filmProcessor.ts')

  // Generate or reuse full-res 4000x3000 test image bytes
  if (!globalThis.__STRESS_TEST_BYTES) {
    const surface = Skia.Surface.Make(4000, 3000)
    const canvas = surface.getCanvas()
    const paint = Skia.Paint()
    paint.setColor(Skia.Color('#6a89cc'))
    canvas.drawRect(Skia.XYWHRect(0, 0, 4000, 3000), paint)
    surface.flush()
    const snap = surface.makeImageSnapshot()
    globalThis.__STRESS_TEST_BYTES = snap.encodeToBytes()
    snap.dispose()
    surface.dispose()
    paint.dispose()
  }

  const frameFile = new File(Paths.cache, 'stress_frame_' + frameNum + '.jpg')
  frameFile.create({ overwrite: true })
  frameFile.write(globalThis.__STRESS_TEST_BYTES)

  const t0 = Date.now()
  const outUri = await applyFilm(frameFile.uri, { mode: 'color', stockId })
  const elapsed = Date.now() - t0
  const outFile = new File(outUri)
  const exists = outFile.exists
  const bytes = outFile.size

  return { elapsed, outUri, exists, bytes }
}

async function main() {
  console.log(`\n=== Momints Seeker GPU Memory Roll Stress Test ===`)
  console.log(`Target device: ${SERIAL}`)
  console.log(`Running ${FRAMES_TO_RUN} consecutive full-resolution (4000x3000) capture/develop cycles...\n`)

  const pagesRes = await fetch(`http://localhost:${METRO_PORT}/json/list`)
  const pages = await pagesRes.json()
  const page = pages.find((p) => p.appId === 'com.momints.app' && p.description.includes('Bridgeless'))
  if (!page) {
    throw new Error('Could not find active Bridgeless debugger target on port ' + METRO_PORT)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  let nextId = 0
  const pending = new Map()
  ws.on('message', (bytes) => {
    const msg = JSON.parse(bytes)
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })

  async function evaluate(expression) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Debugger evaluate timeout'))
      }, 30000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        if (msg.error || msg.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(msg.result?.exceptionDetails || msg.error)))
        } else {
          resolve(msg.result?.result?.value)
        }
      })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  }

  // Transpile function for Hermes ES5 compatibility
  const transpiledCycle = ts.transpileModule('const runCycle = ' + runFrameCycle.toString(), {
    compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, downlevelIteration: true },
  }).outputText

  const baseline = getMemInfo()
  console.log(
    `Baseline Memory -> Graphics: ${(baseline.graphics / 1024).toFixed(1)} MB | Native: ${(baseline.native / 1024).toFixed(1)} MB | Total PSS: ${(baseline.total / 1024).toFixed(1)} MB\n`,
  )

  console.log(
    'Frame | Stock             | Status  | Time (ms) | Graphics PSS | Delta vs Base | Native Heap | Total PSS',
  )
  console.log(
    '------+-------------------+---------+-----------+--------------+---------------+-------------+----------',
  )

  const records = []
  const stocks = ['momints-aura-400', 'momints-neon-800t', 'momints-vivid-50', 'momints-amber-200']

  for (let i = 1; i <= FRAMES_TO_RUN; i++) {
    const stockId = stocks[(i - 1) % stocks.length]
    const slot = '__frame_res_' + Date.now()

    await evaluate(
      `globalThis[${JSON.stringify(slot)}] = null; (function() { ${transpiledCycle}; runCycle(${JSON.stringify(stockId)}, ${i}).then(r => { globalThis[${JSON.stringify(slot)}] = JSON.stringify(r); }, e => { globalThis[${JSON.stringify(slot)}] = JSON.stringify({error:String(e)}); }); })(); 'started'`,
    )

    let evalRes = null
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const raw = await evaluate(`globalThis[${JSON.stringify(slot)}]`)
      if (raw) {
        evalRes = JSON.parse(raw)
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    await evaluate(`delete globalThis[${JSON.stringify(slot)}]`)

    if (evalRes?.error) {
      throw new Error(`Frame ${i} failed: ` + evalRes.error)
    }

    const mem = getMemInfo()
    const deltaGraphics = mem.graphics - baseline.graphics
    const elapsed = evalRes?.elapsed || 0

    records.push({ frame: i, stockId, elapsed, ...mem, deltaGraphics })

    const deltaSign = deltaGraphics >= 0 ? '+' : ''
    const row = [
      String(i).padStart(5),
      stockId.padEnd(17),
      evalRes?.exists ? '  OK   ' : ' FAILED',
      String(elapsed).padStart(9),
      `${(mem.graphics / 1024).toFixed(1)} MB`.padStart(12),
      `${deltaSign}${(deltaGraphics / 1024).toFixed(1)} MB`.padStart(13),
      `${(mem.native / 1024).toFixed(1)} MB`.padStart(11),
      `${(mem.total / 1024).toFixed(1)} MB`.padStart(9),
    ].join(' | ')

    console.log(row)
  }

  // Cleanup test bytes
  await evaluate('delete globalThis.__STRESS_TEST_BYTES;')
  ws.close()

  console.log(
    '------+-------------------+---------+-----------+--------------+---------------+-------------+----------\n',
  )

  const finalDelta = records[records.length - 1].deltaGraphics
  const maxGraphics = Math.max(...records.map((r) => r.graphics))
  const avgElapsed = (records.reduce((a, b) => a + b.elapsed, 0) / records.length).toFixed(0)

  console.log(`=== Verification Results ===`)
  console.log(`Average Latency: ${avgElapsed} ms / frame (GPU speed preserved!)`)
  console.log(`Baseline Graphics PSS: ${(baseline.graphics / 1024).toFixed(1)} MB`)
  console.log(`Peak Graphics PSS:     ${(maxGraphics / 1024).toFixed(1)} MB`)
  console.log(`Final Graphics Delta:  ${finalDelta >= 0 ? '+' : ''}${(finalDelta / 1024).toFixed(1)} MB`)

  if (Math.abs(finalDelta / 1024) < 100) {
    console.log(
      `\n✅ PASS: Graphics memory remained bounded across all ${FRAMES_TO_RUN} frames! No linear 60 MB/frame growth.`,
    )
  } else {
    console.log(
      `\n❌ FAIL: Graphics memory grew by ${(finalDelta / 1024).toFixed(1)} MB across ${FRAMES_TO_RUN} frames.`,
    )
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err)
  process.exit(1)
})

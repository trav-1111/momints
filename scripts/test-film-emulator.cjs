'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { Buffer } = require('node:buffer')
const { execFileSync } = require('node:child_process')
const WebSocket = require('ws')
const ts = require('typescript')
const { makeProcessorHarness } = require('../tests/helpers/film-processor-harness.cjs')
const { runNativeFilmCases } = require('../tests/helpers/film-native-cases.cjs')
const vectors = Object.values(require('../tests/fixtures/film/fixture-vectors.json')).flat()

async function main() {
  const serial = process.env.ANDROID_SERIAL || 'emulator-5554'
  if (!serial.startsWith('emulator-')) throw new Error('This runner is restricted to an emulator')
  const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
  const device = {
    serial,
    avd: adb('emu', 'avd', 'name'),
    model: adb('shell', 'getprop', 'ro.product.model'),
    android: adb('shell', 'getprop', 'ro.build.version.release'),
  }
  const pages = await (await fetch('http://localhost:7666/json/list')).json()
  const page = pages.find((p) => p.appId === 'com.momints.app' && p.description.includes('Bridgeless'))
  if (!page) throw new Error('Open Momints in the emulator with Metro on port 7666 first')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  let nextId = 0
  const pending = new Map()
  ws.on('message', (bytes) => {
    const message = JSON.parse(bytes)
    if (pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  async function evaluate(expression) {
    const id = ++nextId
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('debugger timeout'))
      }, 20000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
    if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result))
    return result.result.result.value
  }
  try {
    const harness = makeProcessorHarness()
    await harness.processor.applyFilm('file:///captures/original.jpg', { mode: 'color', stockId: 'momints-aura-400' })
    const runId = 'film-review-' + Date.now()
    const slot = '__' + runId.replaceAll('-', '_')
    // Read the current Metro function source to detect stale app bundles.
    const loaded = await evaluate(
      'Array.from(__r.getModules()).find(([,m])=>m.verboseName === "src/services/filmProcessor.ts")[1].isInitialized',
    )
    if (!loaded) throw new Error('filmProcessor is not initialized; open the camera before running')
    const nativeCode = ts.transpileModule('const run = ' + runNativeFilmCases.toString(), {
      compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, downlevelIteration: true },
    }).outputText
    await evaluate(
      `globalThis[${JSON.stringify(slot)}] = null; (function() { ${nativeCode}; run(${JSON.stringify(harness.calls.shaderSource)}, ${JSON.stringify(vectors)}, ${JSON.stringify(runId)}).then(r => { globalThis[${JSON.stringify(slot)}] = JSON.stringify(r) }, e => { globalThis[${JSON.stringify(slot)}] = JSON.stringify({error:String(e)}) }); })(); 'started'`,
    )
    let result
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const json = await evaluate(`globalThis[${JSON.stringify(slot)}]`)
      if (json) {
        result = JSON.parse(json)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await evaluate(`delete globalThis[${JSON.stringify(slot)}]`)
    if (!result || result.error) throw new Error(result?.error || 'native tests timed out')
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'momints-film-review-'))
    for (const artifact of result.artifacts) {
      const bytes = Buffer.from(artifact.base64, 'base64')
      fs.writeFileSync(path.join(outputDir, artifact.name), bytes)
      artifact.sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
      delete artifact.base64
    }
    result.device = device
    result.timestamp = new Date().toISOString()
    result.shaderSha256 = crypto.createHash('sha256').update(harness.calls.shaderSource).digest('hex')
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(result, null, 2) + '\n')
    result.results.forEach((r) =>
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${JSON.stringify(r.evidence || r.error)}`),
    )
    console.log('Artifacts: ' + outputDir)
    console.log(`Native film checks: ${result.results.filter((r) => r.pass).length}/${result.results.length}`)
    if (result.results.some((r) => !r.pass)) process.exitCode = 1
  } finally {
    ws.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

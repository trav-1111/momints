'use strict'

const WebSocket = require('ws')
const ts = require('typescript')

const SERIAL = process.env.ANDROID_SERIAL || 'SM02G40619133790'
const METRO_PORT = process.env.METRO_PORT || 7666

function transpileToES5(code) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, downlevelIteration: true },
  }).outputText
}

async function main() {
  console.log(`\n=== Testing Camera Burst Capabilities on Solana Seeker ===`)
  
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

  async function runRemoteAsync(asyncFnBody) {
    const slot = `__BURST_RES_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const rawCode = `
      (async function() {
        try {
          const fn = async function() { ${asyncFnBody} };
          const result = await fn();
          globalThis[${JSON.stringify(slot)}] = JSON.stringify({ ok: true, result });
        } catch (err) {
          globalThis[${JSON.stringify(slot)}] = JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      })()
    `
    const es5Code = transpileToES5(rawCode)
    await evaluate(es5Code)

    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const raw = await evaluate(`globalThis[${JSON.stringify(slot)}]`)
      if (raw) {
        await evaluate(`delete globalThis[${JSON.stringify(slot)}]`)
        const parsed = JSON.parse(raw)
        if (!parsed.ok) throw new Error(parsed.error)
        return parsed.result
      }
      await new Promise((r) => setTimeout(r, 80))
    }
    await evaluate(`delete globalThis[${JSON.stringify(slot)}]`)
    throw new Error('Timed out waiting for remote async result')
  }

  // 1. Check if camera is mounted
  const hasCamera = await evaluate(`Boolean(globalThis.__cameraRef?.current)`)
  console.log(`Camera mounted on screen: ${hasCamera}`)
  if (!hasCamera) {
    console.log(`Please make sure the Camera screen is in the foreground on your Seeker.`)
    ws.close()
    return
  }

  // 2. Test takeSnapshot() burst (Preview stream buffer)
  console.log(`\n--- Test A: takeSnapshot() Rapid Burst (8 frames) ---`)
  const snapData = await runRemoteAsync(`
    const cam = globalThis.__cameraRef.current;
    const results = [];
    const t0 = performance.now();
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const photo = await cam.takeSnapshot({ quality: 90 });
      const elapsed = performance.now() - start;
      results.push({ frame: i + 1, elapsedMs: Math.round(elapsed), width: photo.width, height: photo.height, path: photo.path });
    }
    const totalElapsed = performance.now() - t0;
    return { results, totalElapsed: Math.round(totalElapsed) };
  `)

  console.log(`Captured 8 frames in ${snapData.totalElapsed} ms (${(8 / (snapData.totalElapsed / 1000)).toFixed(1)} FPS):`)
  for (const f of snapData.results) {
    console.log(`  Frame ${f.frame}: ${f.width}x${f.height} in ${f.elapsedMs} ms -> ${f.path}`)
  }

  // 3. Test takePhoto() burst (Full-sensor 12 MP still capture)
  console.log(`\n--- Test B: takePhoto() Full-Resolution Burst (4 frames) ---`)
  try {
    const photoData = await runRemoteAsync(`
      const cam = globalThis.__cameraRef.current;
      const results = [];
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) {
        const start = performance.now();
        const photo = await cam.takePhoto({ flash: 'off', enableShutterSound: false });
        const elapsed = performance.now() - start;
        results.push({ frame: i + 1, elapsedMs: Math.round(elapsed), width: photo.width, height: photo.height, path: photo.path });
      }
      const totalElapsed = performance.now() - t0;
      return { results, totalElapsed: Math.round(totalElapsed) };
    `)
    console.log(`Captured 4 full-res frames in ${photoData.totalElapsed} ms (${(4 / (photoData.totalElapsed / 1000)).toFixed(1)} FPS):`)
    for (const f of photoData.results) {
      console.log(`  Frame ${f.frame}: ${f.width}x${f.height} in ${f.elapsedMs} ms -> ${f.path}`)
    }
  } catch (err) {
    console.log(`takePhoto burst note:`, err.message)
  }

  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

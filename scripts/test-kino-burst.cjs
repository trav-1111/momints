'use strict'

const WebSocket = require('ws')
const ts = require('typescript')
const { execSync } = require('child_process')

const SERIAL = process.env.ANDROID_SERIAL || 'SM02G40619133790'
const METRO_PORT = process.env.METRO_PORT || 7666

function getMemInfo() {
  const out = execSync(`adb -s ${SERIAL} shell dumpsys meminfo com.momints.app`, { encoding: 'utf8' })
  const graphicsMatch = out.match(/Graphics:\s+(\d+)/)
  const nativeMatch = out.match(/Native Heap:\s+(\d+)/)
  const totalMatch = out.match(/TOTAL PSS:\s+(\d+)/)
  return {
    graphics: graphicsMatch ? parseInt(graphicsMatch[1], 10) : 0,
    native: nativeMatch ? parseInt(nativeMatch[1], 10) : 0,
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
  }
}

function transpileToES5(code) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, downlevelIteration: true },
  }).outputText
}

async function main() {
  console.log(`\n=== Testing LomoKino Burst End-to-End on Solana Seeker ===`)
  console.log(`Device: ${SERIAL}`)
  
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
    const slot = `__KINO_TEST_${Date.now()}_${Math.random().toString(36).slice(2)}`
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

    const deadline = Date.now() + 45000
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

  const hasCamera = await evaluate(`Boolean(globalThis.__cameraRef?.current)`)
  console.log(`Camera mounted on screen: ${hasCamera}`)
  if (!hasCamera) {
    console.log(`Please make sure the Camera screen is in the foreground on your Seeker.`)
    ws.close()
    return
  }

  const baselineMem = getMemInfo()
  console.log(`Baseline Graphics PSS: ${(baselineMem.graphics / 1024).toFixed(1)} MB`)

  console.log(`\nSimulating 6-frame LomoKino burst + native film development...`)
  const result = await runRemoteAsync(`
    const findModule = (suffix) => {
      const entry = Array.from(globalThis.__r.getModules()).find(([, m]) => m.verboseName === suffix)
      if (!entry) throw new Error('Metro module not loaded: ' + suffix)
      return globalThis.__r(entry[0])
    }
    const { File } = findModule('node_modules/expo-file-system/src/index.ts')
    const { applyFilm } = findModule('src/services/filmProcessor.ts')
    const { adoptTemporaryCapture } = findModule('src/services/imagePrivacy.ts')
    const { usePhotoStore } = findModule('src/store/photos.ts')

    const cam = globalThis.__cameraRef.current;
    const kinoSeqId = 'kino-test-' + Date.now();
    const burstCount = 6;
    const rawPaths = [];

    const t0 = performance.now();
    for (let i = 0; i < burstCount; i++) {
      const start = performance.now();
      const photo = await cam.takeSnapshot({ quality: 90 });
      rawPaths.push({ path: photo.path, width: photo.width, height: photo.height, snapElapsedMs: Math.round(performance.now() - start) });
    }
    const captureTotalMs = Math.round(performance.now() - t0);

    // Develop frames
    const devStart = performance.now();
    const developed = [];
    for (let i = 0; i < rawPaths.length; i++) {
      const item = rawPaths[i];
      const adoptedUri = adoptTemporaryCapture('file://' + item.path);
      const photoId = usePhotoStore.getState().addPhoto(
        adoptedUri,
        undefined,
        'full',
        { id: kinoSeqId, index: i }
      );

      const fStart = performance.now();
      const processedUri = await applyFilm(adoptedUri, { mode: 'color', stockId: 'momints-aura-400' });
      const devMs = Math.round(performance.now() - fStart);

      usePhotoStore.getState().updatePhotoUri(photoId, processedUri);

      const f = new File(processedUri);
      developed.push({
        frame: i + 1,
        snapMs: item.snapElapsedMs,
        devMs,
        bytes: f.size,
        width: item.width,
        height: item.height,
        uri: processedUri
      });
    }
    const devTotalMs = Math.round(performance.now() - devStart);

    return {
      kinoSeqId,
      captureTotalMs,
      devTotalMs,
      fps: (burstCount / (captureTotalMs / 1000)).toFixed(1),
      developed
    };
  `)

  const postMem = getMemInfo()
  const deltaGraphics = postMem.graphics - baselineMem.graphics
  const deltaSign = deltaGraphics >= 0 ? '+' : ''

  console.log(`\nLomoKino Burst Captured in ${result.captureTotalMs} ms (${result.fps} FPS)`)
  console.log(`Native Film Shading Total: ${result.devTotalMs} ms (avg ${(result.devTotalMs / 6).toFixed(1)} ms/frame)`)
  console.log(`Memory Impact: Graphics PSS ${(postMem.graphics / 1024).toFixed(1)} MB (${deltaSign}${(deltaGraphics / 1024).toFixed(1)} MB)`)
  console.log(`\nFrames:`)
  for (const f of result.developed) {
    console.log(`  Frame ${f.frame}: ${f.width}x${f.height} | Snap: ${f.snapMs} ms | Dev: ${f.devMs} ms | ${(f.bytes / 1024).toFixed(1)} KB`)
  }

  // Verify the photos are in the store
  const storeCheck = await evaluate(`
    (() => {
      const p = globalThis.__r(Array.from(globalThis.__r.getModules()).find(([, m]) => m.verboseName === 'src/store/photos.ts')[0]);
      const kinoPhotos = p.usePhotoStore.getState().photos.filter(x => x.kinoId === ${JSON.stringify(result.kinoSeqId)});
      return kinoPhotos.length;
    })()
  `)
  console.log(`\nPhotos store count with kinoId: ${storeCheck}/6`)

  ws.close()
  console.log(`=== LomoKino Verification COMPLETE ===\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

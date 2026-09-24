import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileRuntimeLut, parseCube, sha256 } from './lib/filmstock-package.mjs'

// Bali 400's visual source is the approved XMP-derived CUBE in the internal
// source archive. Do not synthesize or rewrite it here: after publication,
// changing those source bytes requires a new filmStockId.
const ID = 'bali-400-v1'
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(workerRoot, 'filmstock-sources', ID, 'source', `${ID}.cube`)
const runtimePath = resolve(workerRoot, 'filmstock-assets', 'filmstocks', ID, 'runtime', `${ID}.lut`)
const source = await readFile(sourcePath, 'utf8')
const cube = parseCube(source)
const compiled = compileRuntimeLut(cube)
const runtime = await readFile(runtimePath)

assert.deepEqual(runtime, compiled, 'Immutable runtime LUT does not match the archived CUBE')

console.log(`Validated ${cube.size ** 3} LUT samples from ${sourcePath}`)
console.log(`Source SHA-256: ${sha256(source)}`)
console.log(`Verified runtime LUT (${sha256(runtime)}) at ${runtimePath}`)

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')

// Run the real TS/TSX modules under node:test. Only native platform boundaries
// and explicitly supplied dependencies are mocked; React hooks render normally.
function sourceLoader(mocks = {}) {
  const cache = new Map()
  function load(filename) {
    const absolute = path.resolve(root, filename)
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    if (Object.hasOwn(mocks, relative)) return mocks[relative]
    if (cache.has(absolute)) return cache.get(absolute).exports
    const mod = { exports: {} }
    cache.set(absolute, mod)
    const nativeRequire = createRequire(absolute)
    function requireSource(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), id)
        const candidate = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(
          file => fs.existsSync(file) && fs.statSync(file).isFile(),
        )
        if (candidate) return load(candidate)
      }
      return nativeRequire(id)
    }
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      fileName: absolute,
    }).outputText
    new Function('require', 'module', 'exports', code)(requireSource, mod, mod.exports)
    return mod.exports
  }
  return load
}

module.exports = { sourceLoader }

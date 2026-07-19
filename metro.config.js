const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro') // make sure this import exists

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Apply uniwind modifications before exporting
const uniwindConfig = withUniwindConfig(config, {
  // relative path to your global.css file
  cssEntryFile: './src/global.css',
  // optional: path to typings
  dtsFile: './src/uniwind-types.d.ts',
})

// Dedupe 'buffer': several deps (@solana/web3.js, rpc-websockets, …) bundle
// nested copies. The Hermes subarray patch in polyfill.js only covers the
// instance it imports, so force every 'buffer' import to the top-level copy.
// trailing slash: resolve the npm package, not Node's builtin 'buffer'
const bufferPath = require.resolve('buffer/')
const priorResolveRequest = uniwindConfig.resolver.resolveRequest
uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'buffer') {
    return { type: 'sourceFile', filePath: bufferPath }
  }
  if (priorResolveRequest) return priorResolveRequest(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = uniwindConfig

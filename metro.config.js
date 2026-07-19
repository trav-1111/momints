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

// Node builtin shims. Two consumers:
//  - 'buffer' dedupe: several deps (@solana/web3.js, rpc-websockets, …) bundle
//    nested copies. The Hermes subarray patch in polyfill.js only covers the
//    instance it imports, so force every 'buffer' import to the top-level copy.
//    trailing slash: resolve the npm package, not Node's builtin 'buffer'
//  - the Irys web SDK (@irys/upload-core, @irys/bundles) imports node builtins
//    bare and expects webpack-style shims Metro doesn't provide.
const nodeShims = {
  buffer: require.resolve('buffer/'),
  stream: require.resolve('stream-browserify'),
  crypto: require.resolve('react-native-quick-crypto'),
  events: require.resolve('events/'),
  util: require.resolve('util/'),
  path: require.resolve('path-browserify'),
  // @irys/bundles' exports map lacks a browser condition on ".", so Metro
  // picks the node build (fs, stream/promises). Pin it to the web build —
  // specifically the ESM one: the package's CJS web index wrongly pulls
  // nodeUtils → @irys/arweave/node. require.resolve from Node gives the CJS
  // path, so step over to its esm sibling.
  '@irys/bundles': require('path').join(require.resolve('@irys/bundles/web'), '..', '..', 'esm', 'webIndex.js'),
}

// Node-only packages reachable only through Irys signer classes we never
// instantiate (Ethereum/Algorand chains, node file uploads) — stub to empty
// so Metro can bundle. Instantiating those signers would throw at runtime.
const emptyModules = new Set(['fs', 'fs/promises', 'keccak', 'secp256k1'])

const priorResolveRequest = uniwindConfig.resolver.resolveRequest
uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (nodeShims[moduleName]) {
    return { type: 'sourceFile', filePath: nodeShims[moduleName] }
  }
  if (emptyModules.has(moduleName)) {
    return { type: 'empty' }
  }
  if (priorResolveRequest) return priorResolveRequest(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = uniwindConfig

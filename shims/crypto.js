// Metro alias target for bare `require('crypto')` imports (Irys web SDK,
// @noble/ed25519). react-native-quick-crypto's commonjs build reassigns
// `module.exports`, dropping its `__esModule` marker — bundler interop
// helpers then rebuild the namespace and assign `.default`, which crashes
// under Hermes ("Cannot assign to property 'default' which has only a
// getter"). Restoring `__esModule: true` makes every interop helper take
// its early-return branch and use this object as-is.
const quickCrypto = require('react-native-quick-crypto')

module.exports = { __esModule: true, ...quickCrypto, default: quickCrypto }

// polyfill.js
import { install } from 'react-native-quick-crypto'
import { Buffer as NodeBuffer } from 'buffer'

install()

// Hermes lacks TypedArray @@species support, so subarray() returns a plain
// Uint8Array whose toString() joins bytes with commas instead of decoding
// utf8. Libraries that parse account data with subarray().toString() (e.g.
// @onsol/tldparser) then produce garbled strings and "Max seed length
// exceeded" PDA errors. Restore Buffer-typed results on both Buffer
// implementations in the bundle: the 'buffer' package (used by
// @solana/web3.js) and the global Buffer installed by quick-crypto.
function patchSubarray(BufferImpl) {
  BufferImpl.prototype.subarray = function subarray(begin, end) {
    const result = Uint8Array.prototype.subarray.call(this, begin, end)
    Object.setPrototypeOf(result, BufferImpl.prototype)
    return result
  }
}

patchSubarray(NodeBuffer)
if (global.Buffer && global.Buffer !== NodeBuffer) {
  patchSubarray(global.Buffer)
}

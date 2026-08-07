// BUILD-ONLY — see irys.ts for why this exists and why the imports are static.
//
// Image library choice for cover compositing: @cf-wasm/photon. `sharp` is
// native-bindings-only and cannot run in Workers at all. Photon wraps the
// Rust `photon-rs` library as a purpose-built workerd WASM build (its own
// `/workerd` export, no `nodejs_compat` needed) and has exactly the two
// primitives this job needs: `watermark()` to paste an overlay onto a base
// image and `draw_text()` for the date/exposure caption.
import { PhotonImage, draw_text, watermark, initPhoton } from '@cf-wasm/photon/workerd'

export default {
  fetch(): Response {
    return new Response(`bundle-check only: ${typeof PhotonImage} ${typeof draw_text} ${typeof watermark} ${typeof initPhoton}`)
  },
}

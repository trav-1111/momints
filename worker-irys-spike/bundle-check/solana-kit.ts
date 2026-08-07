// BUILD-ONLY — see irys.ts for why this exists and why the imports are static.
// @solana/kit (v2), not @solana/web3.js v1 — v1's default Connection pulls
// in rpc-websockets, which has a history of eval()/new Function() at module
// load that edge/Workers runtimes reject. kit v2 ships edge-light/workerd
// package-export conditions specifically for this class of runtime.
import { createSolanaRpc } from '@solana/kit'

export default {
  fetch(): Response {
    return new Response(`bundle-check only: ${typeof createSolanaRpc}`)
  },
}

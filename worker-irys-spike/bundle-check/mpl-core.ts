// BUILD-ONLY — see irys.ts for why this exists and why the imports are static.
import { createCollection, mplCore } from '@metaplex-foundation/mpl-core'

export default {
  fetch(): Response {
    return new Response(`bundle-check only: ${typeof createCollection} ${typeof mplCore}`)
  },
}

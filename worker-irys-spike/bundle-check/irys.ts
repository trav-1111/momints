// BUILD-ONLY — never deployed, never invoked at runtime. Exists purely so
// `wrangler deploy --dry-run --outdir` reports this dependency's real bundle
// contribution. Static (not dynamic) imports so the bundler can't defer or
// skip them, and each import is referenced (not just imported) so tree-
// shaking can't drop it as "unused".
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'

export default {
  fetch(): Response {
    return new Response(`bundle-check only: ${typeof Uploader} ${typeof Solana}`)
  },
}

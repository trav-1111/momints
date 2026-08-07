// BUILD-ONLY — the realistic "everything Momints' backend would need
// alongside Irys, in one Worker" bundle. See irys.ts for why this exists.
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'
import { createCollection, mplCore } from '@metaplex-foundation/mpl-core'
import { createSolanaRpc } from '@solana/kit'
import { PhotonImage, draw_text, watermark, initPhoton } from '@cf-wasm/photon/workerd'

export default {
  fetch(): Response {
    return new Response(
      `bundle-check only: ${typeof Uploader} ${typeof Solana} ${typeof createCollection} ${typeof mplCore} ${typeof createSolanaRpc} ${typeof PhotonImage} ${typeof draw_text} ${typeof watermark} ${typeof initPhoton}`,
    )
  },
}

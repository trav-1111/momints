import type { ValidatedEnv } from '../env'

/**
 * Shared Irys uploader factory (pattern validated in docs/spikes/irys).
 * Dynamic imports keep module-evaluation failures catchable per-request;
 * wrangler still bundles them statically at build time.
 *
 * Used by both IrysProvider (uploads) and ManualFunding (balance checks) so
 * the two always see the same bundler node and wallet.
 */
export async function buildIrysUploader(env: ValidatedEnv) {
  const { Uploader } = await import('@irys/upload')
  const { Solana } = await import('@irys/upload-solana')
  return Uploader(Solana).withWallet(env.IRYS_FUNDING_KEY).withRpc(env.SOLANA_RPC_URL).devnet()
}

export type IrysUploader = Awaited<ReturnType<typeof buildIrysUploader>>

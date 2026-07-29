// The ONLY module that talks to Solana/Metaplex directly. Everything above it
// works through the functions exported here, so devnet -> mainnet (or an RPC
// provider change) is a swap inside this directory, not a refactor.
import { keypairIdentity, type Umi } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import type { ValidatedEnv } from '../env'

/**
 * Umi client bound to the Helius RPC secret and the Worker wallet
 * (IRYS_FUNDING_KEY — payer + collection authority). The secret key is
 * decoded in memory only; it is never logged and never leaves this function
 * except inside the umi identity.
 */
export async function createWorkerUmi(env: ValidatedEnv): Promise<Umi> {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults')
  const { mplCore } = await import('@metaplex-foundation/mpl-core')

  const umi = createUmi(env.SOLANA_RPC_URL, { commitment: 'confirmed' }).use(mplCore())
  const secretKey = base58.serialize(env.IRYS_FUNDING_KEY)
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey)
  return umi.use(keypairIdentity(keypair))
}

export function signatureToBase58(signature: Uint8Array): string {
  return base58.deserialize(signature)[0]
}

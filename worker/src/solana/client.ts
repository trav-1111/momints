// The ONLY module that talks to Solana/Metaplex directly. Everything above it
// works through the functions exported here, so devnet -> mainnet (or an RPC
// provider change) is a swap inside this directory, not a refactor.
import { createSignerFromKeypair, keypairIdentity, type Umi } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { ConfigError, type ValidatedEnv } from '../env'

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

/** Stable collection identity across retries. Domain-separated HMAC prevents
 * exposing or persisting either the funding seed or the child secret key. */
export async function rollCollectionSigner(umi: Umi, feeSignature: string) {
  if (!('secretKey' in umi.identity) || !(umi.identity.secretKey instanceof Uint8Array)) {
    throw new ConfigError('Roll creation requires the configured Worker keypair identity')
  }
  const key = await crypto.subtle.importKey('raw', umi.identity.secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const seed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`momints:roll-collection:v1:${feeSignature}`)),
  )
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSeed(seed))
}

/**
 * The Worker's on-chain public key, without constructing a umi client.
 *
 * A Solana secret key is 64 bytes: the 32-byte seed followed by the 32-byte
 * public key. Every quick-mint stage request needs this string (it tells the
 * app which update authority to bake into the transaction it is about to
 * sign), and paying for umi + mpl-core module init on that path — just to read
 * a value that is sitting in the last half of the key — is the wrong trade.
 */
export function getWorkerPublicKey(env: ValidatedEnv): string {
  const secretKey = base58.serialize(env.IRYS_FUNDING_KEY)
  if (secretKey.length !== 64) {
    throw new ConfigError(
      `IRYS_FUNDING_KEY decodes to ${secretKey.length} bytes; expected a 64-byte Solana secret key.`,
    )
  }
  return base58.deserialize(secretKey.slice(32))[0]
}

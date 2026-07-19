import * as SecureStore from 'expo-secure-store'
import { Paths, File as ExpoFile } from 'expo-file-system'
import { sol, type Keypair, type Umi } from '@metaplex-foundation/umi'

/**
 * The storage payer: an app-managed keypair that silently signs and pays for
 * Irys uploads, so storage never routes through MWA (a wallet popup per frame
 * would be unusable — a 24-frame roll uploads 25+ files).
 *
 * The secret key lives in expo-secure-store (Android Keystore-backed). On
 * devnet it is funded by airdrop or a manual faucet top-up; how it gets
 * funded on mainnet (roll fee → treasury → payer, or a one-time wallet
 * transfer) is a later-phase decision.
 */

const SECURE_STORE_KEY = 'momints.storagePayer.v1'
/** Pre-secure-store spike file — imported once, then deleted. */
const LEGACY_SPIKE_FILE = 'irys-spike-payer.json'

/** Minimum lamports for the paid upload path (fee + a 150 KB-class upload). */
export const PAYER_MIN_LAMPORTS = 2_000_000n

let cached: Keypair | null = null

function serializeSecretKey(secretKey: Uint8Array): string {
  return JSON.stringify(Array.from(secretKey))
}

function deserializeSecretKey(stored: string): Uint8Array {
  return new Uint8Array(JSON.parse(stored))
}

/**
 * Load the payer keypair, creating and persisting one on first use. The
 * `umi` argument only supplies the eddsa implementation — the payer is
 * app-global, not per-umi.
 */
export async function getStoragePayerKeypair(umi: Umi): Promise<Keypair> {
  if (cached) return cached

  const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY)
  if (stored) {
    cached = umi.eddsa.createKeypairFromSecretKey(deserializeSecretKey(stored))
    return cached
  }

  // One-time migration from the Phase 0 spike's file — keeps any devnet SOL
  // that was already fauceted onto that address.
  try {
    const legacy = new ExpoFile(Paths.document, LEGACY_SPIKE_FILE)
    if (legacy.exists) {
      const secretKey = new Uint8Array(JSON.parse(await legacy.text()).secretKey)
      const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey)
      await SecureStore.setItemAsync(SECURE_STORE_KEY, serializeSecretKey(secretKey))
      legacy.delete()
      cached = keypair
      return keypair
    }
  } catch {
    // unreadable legacy file — fall through and generate fresh
  }

  const keypair = umi.eddsa.generateKeypair()
  await SecureStore.setItemAsync(SECURE_STORE_KEY, serializeSecretKey(keypair.secretKey))
  cached = keypair
  return keypair
}

export async function getStoragePayerAddress(umi: Umi): Promise<string> {
  return (await getStoragePayerKeypair(umi)).publicKey.toString()
}

/** Payer balance in lamports on whatever cluster `umi.rpc` points at. */
export async function getStoragePayerLamports(umi: Umi): Promise<bigint> {
  const keypair = await getStoragePayerKeypair(umi)
  const balance = await umi.rpc.getBalance(keypair.publicKey)
  return balance.basisPoints
}

export type AirdropOutcome = 'landed' | 'pending' | 'failed'

/**
 * Best-effort devnet airdrop to the payer. The faucet rate-limits by IP and
 * umi's confirm strategy rides an RN-unreliable websocket, so this fires the
 * request without confirmation and polls the balance. 'pending' means the
 * request was accepted but the lamports were not credited within the window
 * — they may still land later.
 */
export async function requestDevnetAirdrop(
  umi: Umi,
  options: { amountSol?: number; minLamports?: bigint; timeoutMs?: number } = {},
): Promise<{ outcome: AirdropOutcome; lamports: bigint; error?: string }> {
  const { amountSol = 0.1, minLamports = PAYER_MIN_LAMPORTS, timeoutMs = 30_000 } = options
  const keypair = await getStoragePayerKeypair(umi)

  try {
    await umi.rpc.airdrop(keypair.publicKey, sol(amountSol))
  } catch (e) {
    return {
      outcome: 'failed',
      lamports: await getStoragePayerLamports(umi).catch(() => 0n),
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lamports = await getStoragePayerLamports(umi)
    if (lamports >= minLamports) return { outcome: 'landed', lamports }
    if (Date.now() > deadline) return { outcome: 'pending', lamports }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

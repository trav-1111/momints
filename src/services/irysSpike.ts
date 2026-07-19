import { Paths, File as ExpoFile } from 'expo-file-system'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, sol, createGenericFile, type Umi, type Keypair } from '@metaplex-foundation/umi'
import { getClusterRpc } from '../store/network'

/**
 * Phase 0 spike for the IPFS → Arweave (Irys) migration. Proves, on-device:
 *  1. the Irys web SDK bundles and runs under Metro/Hermes,
 *  2. a plain keypair (no MWA involvement) can sign uploads and funding,
 *  3. devnet free-tier upload → gateway fetch round-trips, and (when the
 *     payer holds devnet SOL) lazy funding + paid upload work too.
 *
 * Hardcoded to devnet — it can never touch mainnet funds or the user's
 * wallet. The payer keypair persists across runs so one successful funding
 * (airdrop or manual faucet) unlocks the paid path permanently; the devnet
 * faucet rate-limits hard, so airdrop failure degrades the run instead of
 * failing it. Devnet data is retained ~60 days.
 */

export interface SpikeEvent {
  text: string
  kind: 'info' | 'ok' | 'warn' | 'err'
}

const DEVNET_IRYS_ADDRESS = 'https://devnet.irys.xyz'
const PAYER_FILE = 'irys-spike-payer.json'
const AIRDROP_SOL = 0.1
// Paid 150 KB upload needs ~70K lamports on devnet plus the funding tx fee.
const PAID_PATH_MIN_LAMPORTS = 2_000_000n
// Above the 100 KiB free tier so the paid upload + lazy-funding path runs.
const BINARY_SIZE_BYTES = 150_000

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  // getRandomValues caps each call at 64 KiB
  for (let offset = 0; offset < size; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, size)))
  }
  return bytes
}

/** Payer keypair persisted in the app documents dir — devnet throwaway only. */
async function loadOrCreatePayer(umi: Umi): Promise<{ keypair: Keypair; reused: boolean }> {
  const file = new ExpoFile(Paths.document, PAYER_FILE)
  try {
    if (file.exists) {
      const data = JSON.parse(await file.text())
      const secretKey = new Uint8Array(data.secretKey)
      return { keypair: umi.eddsa.createKeypairFromSecretKey(secretKey), reused: true }
    }
  } catch {
    // corrupt file — fall through and regenerate
  }
  const keypair = umi.eddsa.generateKeypair()
  try {
    file.write(JSON.stringify({ secretKey: Array.from(keypair.secretKey) }))
  } catch {
    // persistence is best-effort; the run still works with an in-memory key
  }
  return { keypair, reused: false }
}

async function getLamports(umi: Umi): Promise<bigint> {
  const balance = await umi.rpc.getBalance(umi.identity.publicKey)
  return balance.basisPoints
}

async function waitForLamports(umi: Umi, minLamports: bigint, timeoutMs = 30_000): Promise<bigint | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lamports = await getLamports(umi)
    if (lamports >= minLamports) return lamports
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 1500))
  }
}

async function verifyGatewayFetch(url: string, expectedBytes: number): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway returned ${res.status} for ${url}`)
  const body = await res.arrayBuffer()
  if (expectedBytes > 0 && body.byteLength !== expectedBytes) {
    throw new Error(`Size mismatch: expected ${expectedBytes} bytes, gateway served ${body.byteLength}`)
  }
  return `${res.status} ${res.headers.get('content-type') ?? '?'} · ${body.byteLength} bytes`
}

export interface SpikeResult {
  ok: boolean
  jsonUrl?: string
  binaryUrl?: string
}

export async function runIrysSpike(log: (e: SpikeEvent) => void): Promise<SpikeResult> {
  const info = (text: string) => log({ text, kind: 'info' })
  const ok = (text: string) => log({ text, kind: 'ok' })
  const warn = (text: string) => log({ text, kind: 'warn' })
  const started = Date.now()
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`

  try {
    const rpcUrl = getClusterRpc('devnet')
    info(`RPC: ${rpcUrl}`)
    info(`Irys node: ${DEVNET_IRYS_ADDRESS}`)

    // Lazy-loaded: expo-router evaluates route modules at startup, and a
    // module-init crash anywhere in the Irys tree would take out app launch
    // and route registration. Loading here surfaces any such crash in the
    // on-screen log instead.
    info('Loading Irys SDK…')
    const { irysUploader, isIrysUploader } = await import('@metaplex-foundation/umi-uploader-irys/web')
    ok(`Irys SDK loaded (${elapsed()})`)

    const umi = createUmi(rpcUrl).use(irysUploader({ address: DEVNET_IRYS_ADDRESS }))
    const { keypair, reused } = await loadOrCreatePayer(umi)
    umi.use(keypairIdentity(keypair))
    ok(`${reused ? 'Reusing persisted' : 'Generated new'} payer: ${keypair.publicKey}`)

    if (!isIrysUploader(umi.uploader)) throw new Error('Uploader plugin did not install')
    const uploader = umi.uploader

    const price2mb = await uploader.getUploadPriceFromBytes(2_000_000)
    ok(`Price check — 2 MB costs ${price2mb.basisPoints} lamports (${elapsed()})`)

    // Free tier first: uploads under 100 KiB are free on devnet, and the raw
    // Irys instance (unlike umi's upload wrapper) does not auto-fund — this
    // validates signing, upload, and gateway retrieval with a broke payer.
    info('Uploading metadata JSON (free tier, no funding needed)…')
    const irys = await uploader.irys()
    const payload = JSON.stringify({ spike: 'momints irys devnet spike', device: 'react-native', ts: Date.now() })
    const receipt = await irys.upload(payload, {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    })
    const jsonUrl = `https://gateway.irys.xyz/${receipt.id}`
    ok(`JSON uploaded: ${jsonUrl} (${elapsed()})`)
    ok(`JSON fetch-back: ${await verifyGatewayFetch(jsonUrl, 0)}`)

    // Paid path needs devnet SOL in the payer. Airdrop is best-effort — the
    // devnet faucet rate-limits by IP, and the payer persists, so a manual
    // top-up also unlocks this path for every future run.
    let lamports = await getLamports(umi)
    info(`Payer balance: ${lamports} lamports`)
    if (lamports < PAID_PATH_MIN_LAMPORTS) {
      info(`Requesting ${AIRDROP_SOL} devnet SOL airdrop…`)
      try {
        // No commitment option: umi's confirm strategy rides a websocket
        // subscription that is unreliable in RN — poll the balance instead.
        await umi.rpc.airdrop(keypair.publicKey, sol(AIRDROP_SOL))
        const landed = await waitForLamports(umi, PAID_PATH_MIN_LAMPORTS)
        if (landed !== null) {
          lamports = landed
          ok(`Airdrop landed: ${lamports} lamports (${elapsed()})`)
        } else {
          warn('Airdrop requested but not credited within 30s')
        }
      } catch (e) {
        warn(`Airdrop failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (lamports < PAID_PATH_MIN_LAMPORTS) {
      warn('Paid-path test skipped — payer has no devnet SOL (faucet rate-limited?).')
      warn(`Fund this address with devnet SOL, then rerun: ${keypair.publicKey}`)
      warn('Easiest: paste the address at faucet.solana.com, or send devnet SOL from any wallet.')
      ok(`SPIKE PASSED (free tier only) in ${elapsed()} — SDK runs, signing + upload + gateway verified`)
      return { ok: true, jsonUrl }
    }

    info(`Uploading ${Math.round(BINARY_SIZE_BYTES / 1000)} KB binary (paid path, auto-funds Irys account)…`)
    const bytes = randomBytes(BINARY_SIZE_BYTES)
    const file = createGenericFile(bytes, 'spike.bin', { contentType: 'application/octet-stream' })
    const [binaryUrl] = await umi.uploader.upload([file])
    ok(`Binary uploaded: ${binaryUrl} (${elapsed()})`)
    ok(`Binary fetch-back: ${await verifyGatewayFetch(binaryUrl, BINARY_SIZE_BYTES)}`)

    const irysBalance = await uploader.getBalance()
    info(`Remaining Irys balance: ${irysBalance.basisPoints} lamports`)

    ok(`SPIKE PASSED (full) in ${elapsed()} — free tier + lazy funding + paid upload verified`)
    return { ok: true, jsonUrl, binaryUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause = e instanceof Error && e.cause instanceof Error ? ` (cause: ${e.cause.message})` : ''
    log({ text: `FAILED after ${elapsed()}: ${msg}${cause}`, kind: 'err' })
    return { ok: false }
  }
}

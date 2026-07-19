import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, sol, createGenericFile, type Umi } from '@metaplex-foundation/umi'
import { irysUploader, isIrysUploader } from '@metaplex-foundation/umi-uploader-irys/web'
import { getClusterRpc } from '../store/network'

/**
 * Phase 0 spike for the IPFS → Arweave (Irys) migration. Proves, on-device:
 *  1. the Irys web SDK bundles and runs under Metro/Hermes,
 *  2. a plain keypair (no MWA involvement) can sign uploads and funding,
 *  3. devnet airdrop → lazy fund → upload → gateway fetch round-trips.
 *
 * Hardcoded to devnet with a throwaway in-memory keypair — it can never touch
 * mainnet funds or the user's wallet. Devnet data is retained ~60 days.
 */

export interface SpikeEvent {
  text: string
  kind: 'info' | 'ok' | 'err'
}

const DEVNET_IRYS_ADDRESS = 'https://devnet.irys.xyz'
const AIRDROP_SOL = 0.1
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

async function waitForBalance(umi: Umi, minLamports: bigint, timeoutMs = 30_000): Promise<bigint> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const balance = await umi.rpc.getBalance(umi.identity.publicKey)
    if (balance.basisPoints >= minLamports) return balance.basisPoints
    if (Date.now() > deadline) throw new Error(`Airdrop not credited within ${timeoutMs / 1000}s`)
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
  const started = Date.now()
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`

  try {
    const rpcUrl = getClusterRpc('devnet')
    info(`RPC: ${rpcUrl}`)
    info(`Irys node: ${DEVNET_IRYS_ADDRESS}`)

    const umi = createUmi(rpcUrl).use(irysUploader({ address: DEVNET_IRYS_ADDRESS }))
    const keypair = umi.eddsa.generateKeypair()
    umi.use(keypairIdentity(keypair))
    ok(`Throwaway payer: ${keypair.publicKey}`)

    if (!isIrysUploader(umi.uploader)) throw new Error('Uploader plugin did not install')
    const uploader = umi.uploader

    const price2mb = await uploader.getUploadPriceFromBytes(2_000_000)
    ok(`Price check — 2 MB costs ${price2mb.basisPoints} lamports (${elapsed()})`)

    info(`Requesting ${AIRDROP_SOL} devnet SOL airdrop…`)
    await umi.rpc.airdrop(keypair.publicKey, sol(AIRDROP_SOL), { commitment: 'confirmed' })
    const funded = await waitForBalance(umi, 1n)
    ok(`Airdrop landed: ${funded} lamports (${elapsed()})`)

    info('Uploading metadata JSON (auto-funds Irys account)…')
    const jsonUrl = await umi.uploader.uploadJson({
      spike: 'momints irys devnet spike',
      device: 'react-native',
      ts: Date.now(),
    })
    ok(`JSON uploaded: ${jsonUrl} (${elapsed()})`)

    info(`Uploading ${Math.round(BINARY_SIZE_BYTES / 1000)} KB binary (paid path, above free tier)…`)
    const bytes = randomBytes(BINARY_SIZE_BYTES)
    const file = createGenericFile(bytes, 'spike.bin', { contentType: 'application/octet-stream' })
    const [binaryUrl] = await umi.uploader.upload([file])
    ok(`Binary uploaded: ${binaryUrl} (${elapsed()})`)

    const irysBalance = await uploader.getBalance()
    info(`Remaining Irys balance: ${irysBalance.basisPoints} lamports`)

    info('Verifying gateway retrieval…')
    ok(`JSON fetch: ${await verifyGatewayFetch(jsonUrl, 0)}`)
    ok(`Binary fetch: ${await verifyGatewayFetch(binaryUrl, BINARY_SIZE_BYTES)}`)

    ok(`SPIKE PASSED in ${elapsed()} — Irys web SDK works under Hermes on devnet`)
    return { ok: true, jsonUrl, binaryUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause = e instanceof Error && e.cause instanceof Error ? ` (cause: ${e.cause.message})` : ''
    log({ text: `FAILED after ${elapsed()}: ${msg}${cause}`, kind: 'err' })
    return { ok: false }
  }
}

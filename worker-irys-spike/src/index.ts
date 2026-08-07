// THROWAWAY SPIKE — not production code.
//
// Answers one question: does the Irys SDK import, sign, and upload from
// inside the Cloudflare Workers runtime (V8 isolate, not full Node)?
//
// GET  /       usage hint
// POST /spike  runs the three stages below, in order, each in its own
//              try/catch so an earlier failure still returns a clean JSON
//              body instead of crashing the Worker.
import { Buffer } from 'node:buffer'
import { handleSpikeLarge } from './large'

export interface Env {
  /** Base58 Solana secret key for a DEVNET-ONLY funding wallet. Worker Secret — never logged. */
  IRYS_FUNDING_KEY?: string
  /**
   * Optional override for the Solana devnet RPC used for Irys funding txs.
   * The public `api.devnet.solana.com` blocks Cloudflare Workers' egress IPs
   * (403 "Your IP or provider is blocked from this endpoint") — a dedicated
   * RPC provider is needed for anything that actually sends a transaction.
   * Not a wallet key — an RPC provider API key, lower sensitivity, but still
   * a Worker Secret rather than hardcoded, on general principle.
   */
  SOLANA_RPC_URL?: string
}

const USAGE =
  'Momints Irys-in-Workers spike. POST /spike for the three-stage test, POST /spike-large?sizeMB=N (or a real binary body) for the payload-ceiling test. See README.md.\n'

type StageResult = 'pass' | 'fail' | 'skipped'

interface SpikeResult {
  stage1: StageResult
  stage2: StageResult
  stage3: StageResult
  uri: string | null
  detail: Record<string, unknown>
  error: { stage: string; message: string; stack: string | null } | null
}

function serializeError(stage: string, err: unknown): NonNullable<SpikeResult['error']> {
  if (err instanceof Error) {
    return { stage, message: err.message, stack: err.stack ?? null }
  }
  return { stage, message: String(err), stack: null }
}

// Dynamic import (not a top-level static import) is what makes Stage 1's
// try/catch actually able to catch a module-load-time failure — a static
// import that throws at link time would crash the whole Worker before any
// handler runs, which defeats the point of a per-stage report. Wrangler's
// bundler still statically analyzes and bundles these at build time; the
// dynamic `import()` just defers *evaluating* the module's top-level code
// until this call site, inside the try/catch.
// Irys's devnet bundler needs an explicit Solana devnet RPC — its default
// embedded RPC is mainnet-focused. Same public devnet endpoint the Momints
// app itself uses (see src/store/network.ts's getClusterRpc). Blocks
// Cloudflare Workers' egress IPs for anything that sends a transaction
// (funding) — see the SOLANA_RPC_URL field on Env — so this default is only
// safe for read-only-shaped calls; a real fund attempt needs the override.
const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com'

export async function buildUploader(env: Env) {
  if (!env.IRYS_FUNDING_KEY) {
    throw new Error('IRYS_FUNDING_KEY secret is not set.')
  }
  const { Uploader } = await import('@irys/upload')
  const { Solana } = await import('@irys/upload-solana')
  return Uploader(Solana)
    .withWallet(env.IRYS_FUNDING_KEY)
    .withRpc(env.SOLANA_RPC_URL || SOLANA_DEVNET_RPC)
    .devnet()
}

async function runSpike(env: Env): Promise<SpikeResult> {
  const result: SpikeResult = {
    stage1: 'fail',
    stage2: 'skipped',
    stage3: 'skipped',
    uri: null,
    detail: {},
    error: null,
  }

  if (!env.IRYS_FUNDING_KEY) {
    result.error = {
      stage: 'stage1',
      message: 'IRYS_FUNDING_KEY secret is not set. See README.md — wrangler secret put IRYS_FUNDING_KEY.',
      stack: null,
    }
    return result
  }

  // ---- Stage 1: import + instantiate ----
  let irysUploader: Awaited<ReturnType<typeof buildUploader>>
  try {
    irysUploader = await buildUploader(env)
    result.stage1 = 'pass'
  } catch (err) {
    result.error = serializeError('stage1', err)
    return result
  }

  // ---- Stage 2: sign / signer-adjacent path ----
  // The SDK doesn't expose a standalone "sign this message" primitive on the
  // uploader, so this stage exercises the closest available proxies and is
  // honest about it in `detail`: `.address` proves key derivation from the
  // secret succeeded; `.getPrice()` is a real network round-trip through the
  // same client (proves outbound fetch/axios works from the isolate), even
  // though pricing itself doesn't require a signature.
  try {
    await irysUploader.ready()
    const address = irysUploader.address
    const price = await irysUploader.getPrice(100)
    result.detail.address = address
    result.detail.priceFor100BytesAtomic = price?.toString?.() ?? String(price)
    result.detail.stage2Note = 'address = key derivation proof; getPrice = network round-trip proof (not a signature itself)'
    result.stage2 = 'pass'
  } catch (err) {
    result.stage2 = 'fail'
    result.error = serializeError('stage2', err)
    return result
  }

  // ---- Stage 3: fund + upload ----
  try {
    const payload = `momints-spike-${Date.now()}`
    const receipt = await irysUploader.upload(Buffer.from(payload))
    result.uri = `https://gateway.irys.xyz/${receipt.id}`
    result.detail.uploadedPayload = payload
    result.stage3 = 'pass'
  } catch (err) {
    result.stage3 = 'fail'
    result.error = serializeError('stage3', err)
  }

  return result
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(USAGE, { status: 200, headers: { 'content-type': 'text/plain' } })
    }

    if (request.method === 'POST' && url.pathname === '/spike') {
      const result = await runSpike(env)
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (request.method === 'POST' && url.pathname === '/spike-large') {
      return handleSpikeLarge(request, env, url)
    }

    return new Response('Not found. GET / for usage, POST /spike or /spike-large to run the tests.\n', { status: 404 })
  },
}

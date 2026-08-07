// THROWAWAY SPIKE 2, Part A — one payload size per invocation, deliberately.
//
// A single request that self-generated all four sizes internally would lose
// every earlier passing result if a larger size crashed the isolate outright
// (Workers can be killed mid-request on a hard memory/CPU limit, with no
// chance for our own try/catch to run). Testing one size per HTTP call, from
// an external script that aggregates results, means a crash at 5MB doesn't
// erase the 1MB/3MB passes that already returned cleanly.
import { Buffer } from 'node:buffer'
import { buildUploader, type Env } from './index'

type FailureMode = 'request-body-limit' | 'memory-limit' | 'cpu-limit' | 'irys-or-network' | 'unknown'

interface LargeResult {
  sizeMB: number | null
  actualBytes: number | null
  source: 'synthetic' | 'uploaded-body' | 'unknown'
  status: 'pass' | 'fail'
  ms: number
  fundMs: number | null
  uploadMs: number | null
  funded: boolean | null
  priceAtomic: string | null
  balanceBeforeAtomic: string | null
  uri: string | null
  error: { message: string; stack: string | null } | null
  failureMode: FailureMode | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } })
}

function classifyFailure(err: unknown, httpStatus?: number): FailureMode {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const lower = msg.toLowerCase()
  if (
    httpStatus === 413 ||
    lower.includes('too large') ||
    lower.includes('payload too large') ||
    lower.includes('body limit') ||
    lower.includes('request entity')
  ) {
    return 'request-body-limit'
  }
  if (lower.includes('out of memory') || lower.includes('oom') || lower.includes('exceeded memory') || lower.includes('memory limit')) {
    return 'memory-limit'
  }
  if (lower.includes('cpu') || lower.includes('exceeded time') || lower.includes('time limit') || lower.includes('script exceeded')) {
    return 'cpu-limit'
  }
  return 'irys-or-network'
}

// crypto.getRandomValues caps at 65536 bytes per call — fill in chunks.
// Random (not a repeating pattern) so it behaves like real compressed photo
// bytes, not artificially-compressible data, for anything downstream that
// might treat the two differently.
async function generateSyntheticBuffer(sizeMB: number): Promise<Uint8Array> {
  const totalBytes = Math.round(sizeMB * 1024 * 1024)
  const buf = new Uint8Array(totalBytes)
  const CHUNK = 65536
  for (let offset = 0; offset < totalBytes; offset += CHUNK) {
    const len = Math.min(CHUNK, totalBytes - offset)
    crypto.getRandomValues(buf.subarray(offset, offset + len))
  }
  return buf
}

export async function handleSpikeLarge(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.IRYS_FUNDING_KEY) {
    return json({ error: 'IRYS_FUNDING_KEY secret is not set. See README.md.' }, 400)
  }

  const start = Date.now()
  let bytes: Uint8Array
  let source: LargeResult['source']

  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > 0) {
      bytes = new Uint8Array(await request.arrayBuffer())
      source = 'uploaded-body'
    } else {
      const sizeMBParam = Number(url.searchParams.get('sizeMB') ?? '0')
      if (!sizeMBParam || sizeMBParam <= 0) {
        return json({ error: 'Provide a binary request body, or ?sizeMB=N to self-generate one.' }, 400)
      }
      bytes = await generateSyntheticBuffer(sizeMBParam)
      source = 'synthetic'
    }
  } catch (err) {
    const result: LargeResult = {
      sizeMB: null,
      actualBytes: null,
      source: 'unknown',
      status: 'fail',
      ms: Date.now() - start,
      fundMs: null,
      uploadMs: null,
      funded: null,
      priceAtomic: null,
      balanceBeforeAtomic: null,
      uri: null,
      error: err instanceof Error ? { message: err.message, stack: err.stack ?? null } : { message: String(err), stack: null },
      failureMode: classifyFailure(err),
    }
    return json(result, 200)
  }

  const result: LargeResult = {
    sizeMB: Math.round((bytes.byteLength / (1024 * 1024)) * 100) / 100,
    actualBytes: bytes.byteLength,
    source,
    status: 'fail',
    ms: 0,
    fundMs: null,
    uploadMs: null,
    funded: null,
    priceAtomic: null,
    balanceBeforeAtomic: null,
    uri: null,
    error: null,
    failureMode: null,
  }

  try {
    const irysUploader = await buildUploader(env)
    await irysUploader.ready()

    // The raw @irys/upload-solana SDK does not appear to auto-fund from the
    // wallet's on-chain SOL during .upload() the way some other Irys clients
    // do — a wallet with plenty of on-chain devnet SOL still 402'd on upload
    // in earlier testing. Check the pre-funded Irys-node balance explicitly
    // and top it up first if it's short, so a real payload-sized upload gets
    // a fair test instead of failing on funding mechanics.
    const price = await irysUploader.getPrice(bytes.byteLength)
    const balance = await irysUploader.getBalance()
    result.priceAtomic = price.toString()
    result.balanceBeforeAtomic = balance.toString()

    if (balance.lt(price)) {
      const fundStart = Date.now()
      try {
        await irysUploader.fund(price.minus(balance).multipliedBy(1.1).integerValue())
        result.funded = true
      } catch (fundErr) {
        result.funded = false
        result.error =
          fundErr instanceof Error ? { message: fundErr.message, stack: fundErr.stack ?? null } : { message: String(fundErr), stack: null }
        result.failureMode = classifyFailure(fundErr)
        result.fundMs = Date.now() - fundStart
        result.ms = Date.now() - start
        return json(result, 200)
      }
      result.fundMs = Date.now() - fundStart
    } else {
      result.funded = false // was already sufficient, no fund tx needed
    }

    const uploadStart = Date.now()
    const receipt = await irysUploader.upload(Buffer.from(bytes))
    result.uploadMs = Date.now() - uploadStart
    result.uri = `https://gateway.irys.xyz/${receipt.id}`
    result.status = 'pass'
  } catch (err) {
    result.error = err instanceof Error ? { message: err.message, stack: err.stack ?? null } : { message: String(err), stack: null }
    result.failureMode = classifyFailure(err)
  } finally {
    result.ms = Date.now() - start
  }

  return json(result, 200)
}

// THROWAWAY SPIKE — one question only:
//
//   Can a Cloudflare Worker (V8 isolate + nodejs_compat) sign an ANS-104 data
//   item with the funding key and upload it to Turbo, landing on genuine
//   Arweave?
//
// The Arweave-path investigation proved the arbundles classes LOAD and that a
// live Turbo API call works from inside the isolate. It could NOT prove keyed
// signing, because that needs a real key. This closes that gap.
//
// Four stages, each independently try/caught, so a failure is localized:
//   1 LOAD    — import arbundles and CONSTRUCT the signer from the secret
//   2 SIGN    — build and sign an ANS-104 data item        <- the core question
//   3 UPLOAD  — POST it to Turbo                            <- SPENDS MONEY
//   4 VERIFY  — report the arweave.net URL (never blocks)
//
// Stages 1-2 cost NOTHING. They are what actually answers the question, so they
// are the DEFAULT. Stage 3 only runs with ?confirm=upload, so no accidental
// request can spend.
//
// The signing key is a Worker secret. This file never logs, returns, or derives
// anything from it except the PUBLIC address (needed to check the credit
// balance, and already public on-chain).

import bs58 from 'bs58'

export interface Env {
  /** base58-encoded 64-byte Solana secret key. Same format as IRYS_FUNDING_KEY. */
  TURBO_SIGNING_KEY?: string
}

const TURBO_UPLOAD = 'https://upload.ardrive.io/v1'
const TURBO_PAYMENT = 'https://payment.ardrive.io/v1'
const TOKEN = 'solana'
const ARWEAVE_GATEWAY = 'https://arweave.net'

const USAGE = `Momints Turbo/Arweave Workers spike (THROWAWAY).

  POST /spike-sign-upload                  stages 1-2 only: LOAD + SIGN. FREE, spends nothing.
                                           This is what answers the question.
  POST /spike-sign-upload?confirm=upload   stages 1-4: also UPLOADS. SPENDS REAL CREDITS.
  GET  /balance                            Turbo credit balance for the signing wallet (read-only)
  GET  /                                   this text

Run the free one first. Only run ?confirm=upload once stages 1-2 PASS.
`

type StageName = 'LOAD' | 'SIGN' | 'UPLOAD' | 'VERIFY'

interface StageResult {
  stage: StageName
  ok: boolean
  detail?: unknown
  error?: string
  /** Named so a failure says WHICH primitive is missing, not just "it broke". */
  errorName?: string
  stack?: string[]
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function describe(err: unknown): Pick<StageResult, 'error' | 'errorName' | 'stack'> {
  if (err instanceof Error) {
    return {
      error: err.message,
      errorName: err.name,
      // Enough frames to name the failing dependency, not so many it's noise.
      stack: (err.stack ?? '').split('\n').slice(0, 10),
    }
  }
  return { error: String(err), errorName: 'unknown' }
}

async function runSpike(env: Env, doUpload: boolean): Promise<Response> {
  const stages: StageResult[] = []
  const startedAt = new Date().toISOString()

  // ---- STAGE 1: LOAD --------------------------------------------------------
  // Import arbundles and construct the signer from the real key. The
  // investigation proved the classes import; this proves one CONSTRUCTS.
  let signer: { publicKey: Uint8Array } & Record<string, unknown>
  let createData: (data: string | Uint8Array, signer: unknown, opts?: unknown) => {
    sign: (s: unknown) => Promise<unknown>
    isValid: () => Promise<boolean>
    getRaw: () => Uint8Array
    id: string
  }
  let signingAddress: string
  // The API-shape checks run BEFORE the key is touched, so running this with no
  // secret set still tells you whether THIS SPIKE'S CODE is correct. That keeps
  // "the spike is miswired" from being misread as "signing doesn't work here".
  const apiShape: Record<string, string> = {}
  try {
    const arbundles = await import('@dha-team/arbundles')
    const bag = arbundles as unknown as Record<string, unknown>
    apiShape.SolanaSigner = typeof bag.SolanaSigner
    apiShape.createData = typeof bag.createData
    const badExports = Object.entries(apiShape)
      .filter(([, t]) => t !== 'function')
      .map(([n, t]) => `${n} is ${t}`)
    if (badExports.length > 0) {
      throw new Error(`arbundles imported, but its export shape changed: ${badExports.join(', ')}`)
    }

    const key = env.TURBO_SIGNING_KEY
    if (!key) {
      throw new Error(
        'arbundles imported and its API shape is correct, but the TURBO_SIGNING_KEY secret is not set, ' +
          'so the signer could not be constructed. This is a SETUP gap, not a runtime failure. Set it with ' +
          '`wrangler secret put TURBO_SIGNING_KEY` (base58-encoded 64-byte Solana secret key — README "Key format").',
      )
    }

    const SolanaSigner = bag.SolanaSigner as new (k: string) => never
    signer = new SolanaSigner(key.trim()) as never
    createData = bag.createData as typeof createData
    // PUBLIC address only. Never the secret. Needed to check the credit balance.
    signingAddress = bs58.encode(signer.publicKey)
    stages.push({
      stage: 'LOAD',
      ok: true,
      detail: {
        apiShape,
        signerConstructed: true,
        signatureType: (signer as unknown as { signatureType: number }).signatureType,
        ownerLength: (signer as unknown as { ownerLength: number }).ownerLength,
        signingAddress,
      },
    })
  } catch (err) {
    stages.push({ stage: 'LOAD', ok: false, detail: { apiShape }, ...describe(err) })
    return finish(stages, startedAt, doUpload)
  }

  // ---- STAGE 2: SIGN --------------------------------------------------------
  // THE CORE QUESTION. ed25519 via @noble/ed25519 (pure JS) plus arbundles'
  // deepHash over the ANS-104 structure. Nothing here touches the network.
  let raw: Uint8Array
  let dataItemId: string
  try {
    const payload = JSON.stringify({
      spike: 'momints-turbo-spike',
      note: 'Throwaway ANS-104 signing + upload probe from a Cloudflare Worker.',
      createdAt: startedAt,
      // Pad to a few hundred bytes so this is a realistic small data item.
      padding: 'x'.repeat(200),
    })
    const item = createData(payload, signer, {
      tags: [
        // The content type our real metadata uploads would use.
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: 'momints-turbo-spike' },
      ],
    })
    await item.sign(signer)
    const valid = await item.isValid()
    if (!valid) throw new Error('data item signed but isValid() returned false — signature did not verify')
    raw = item.getRaw()
    dataItemId = item.id
    stages.push({
      stage: 'SIGN',
      ok: true,
      detail: {
        signedAndSelfVerified: true,
        dataItemId,
        payloadBytes: payload.length,
        signedItemBytes: raw.byteLength,
      },
    })
  } catch (err) {
    stages.push({ stage: 'SIGN', ok: false, ...describe(err) })
    return finish(stages, startedAt, doUpload)
  }

  if (!doUpload) {
    stages.push({
      stage: 'UPLOAD',
      ok: false,
      detail: 'SKIPPED — no spend. Re-run with ?confirm=upload to perform the paid upload.',
    })
    return finish(stages, startedAt, doUpload)
  }

  // ---- STAGE 3: UPLOAD (SPENDS) --------------------------------------------
  let uploadedId: string
  try {
    const res = await fetch(`${TURBO_UPLOAD}/tx/${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: raw,
      signal: AbortSignal.timeout(60_000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Turbo upload returned ${res.status}: ${text.slice(0, 400)}`)
    }
    const body = JSON.parse(text) as { id?: string; owner?: string; winc?: string }
    uploadedId = body.id ?? dataItemId
    stages.push({ stage: 'UPLOAD', ok: true, detail: { id: uploadedId, wincSpent: body.winc ?? null, raw: body } })
  } catch (err) {
    stages.push({ stage: 'UPLOAD', ok: false, ...describe(err) })
    return finish(stages, startedAt, doUpload)
  }

  // ---- STAGE 4: VERIFY (reports, never blocks) -----------------------------
  // Arweave mining takes time; a not-yet-resolvable id is NOT a spike failure.
  const arweaveUrl = `${ARWEAVE_GATEWAY}/${uploadedId}`
  try {
    const head = await fetch(arweaveUrl, { method: 'HEAD', signal: AbortSignal.timeout(20_000) })
    stages.push({
      stage: 'VERIFY',
      ok: true,
      detail: {
        arweaveUrl,
        httpStatus: head.status,
        contentType: head.headers.get('content-type'),
        note:
          head.status === 200
            ? 'Already resolvable on arweave.net.'
            : 'Not resolvable yet — normal, Arweave mining takes minutes. Re-check the URL by hand.',
      },
    })
  } catch (err) {
    stages.push({
      stage: 'VERIFY',
      ok: true,
      detail: { arweaveUrl, note: 'Gateway check failed; this does NOT invalidate the upload. Check by hand.' },
      ...describe(err),
    })
  }

  return finish(stages, startedAt, doUpload)
}

function finish(stages: StageResult[], startedAt: string, attemptedUpload: boolean): Response {
  const failed = stages.find((s) => !s.ok && s.stage !== 'UPLOAD')
  const uploadStage = stages.find((s) => s.stage === 'UPLOAD')
  const signOk = stages.some((s) => s.stage === 'SIGN' && s.ok)
  const uploadOk = uploadStage?.ok === true
  const uploadFailed = attemptedUpload && uploadStage?.ok === false

  // A missing secret is a SETUP gap, not evidence about the runtime. Saying
  // "FAIL" here would wrongly condemn the lean-arbundles recommendation.
  const notConfigured = stages.some(
    (s) => s.stage === 'LOAD' && !s.ok && (s.error ?? '').includes('TURBO_SIGNING_KEY secret is not set'),
  )

  let verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_RUN'
  let headline: string
  if (notConfigured) {
    verdict = 'NOT_RUN'
    headline =
      'Nothing was proven or disproven: the signing key is not set. arbundles imported and its API shape is correct ' +
      '(so the spike itself is wired up) — set TURBO_SIGNING_KEY and run again.'
  } else if (!signOk) {
    verdict = 'FAIL'
    headline = `Keyed ANS-104 signing does NOT work in workerd — failed at stage ${failed?.stage}. The lean-arbundles recommendation must be revisited.`
  } else if (uploadOk) {
    verdict = 'PASS'
    headline = 'Keyed signing AND a real Turbo upload both work inside a Cloudflare Worker. Genuine Arweave path is clear.'
  } else if (uploadFailed) {
    verdict = 'PARTIAL'
    headline =
      'Keyed ANS-104 signing WORKS in workerd (the core question is answered YES). The upload leg failed — see the UPLOAD stage; often credits or connectivity, not runtime.'
  } else {
    verdict = 'PARTIAL'
    headline =
      'Keyed ANS-104 signing WORKS in workerd (the core question is answered YES). Upload was deliberately skipped — re-run with ?confirm=upload to prove end-to-end.'
  }

  return json(
    {
      verdict,
      headline,
      coreQuestion: {
        question: 'Can a Cloudflare Worker sign an ANS-104 data item with the funding key?',
        answer: signOk ? 'YES' : notConfigured ? 'UNANSWERED (key not set)' : 'NO',
      },
      spentMoney: uploadOk,
      startedAt,
      runtime: { nodejs_compat: true, compatibility_date: '2026-07-22' },
      stages,
    },
    verdict === 'FAIL' ? 500 : 200,
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (request.method === 'GET' && path === '/') {
        return new Response(USAGE, { headers: { 'content-type': 'text/plain' } })
      }

      if (request.method === 'GET' && path === '/balance') {
        if (!env.TURBO_SIGNING_KEY) {
          return json({ error: 'TURBO_SIGNING_KEY is not set — cannot derive the wallet address.' }, 500)
        }
        const arbundles = await import('@dha-team/arbundles')
        const SolanaSigner = (arbundles as unknown as Record<string, new (k: string) => { publicKey: Uint8Array }>)
          .SolanaSigner
        const address = bs58.encode(new SolanaSigner(env.TURBO_SIGNING_KEY.trim()).publicKey)
        const res = await fetch(`${TURBO_PAYMENT}/account/balance/${TOKEN}?address=${address}`, {
          signal: AbortSignal.timeout(20_000),
        })
        const body = await res.text()
        return json({
          address,
          httpStatus: res.status,
          balance: (() => {
            try {
              return JSON.parse(body)
            } catch {
              return body.slice(0, 300)
            }
          })(),
          topUpNote: `Send SOL to Turbo's Solana payment address to buy credits for ${address}. See README.`,
        })
      }

      if (request.method === 'POST' && path === '/spike-sign-upload') {
        // Default is the FREE path. Spending requires saying so explicitly.
        const doUpload = url.searchParams.get('confirm') === 'upload'
        return await runSpike(env, doUpload)
      }

      return json({ error: `No route: ${request.method} ${path}. GET / for usage.` }, 404)
    } catch (err) {
      // Anything that escaped a stage — still report it structurally.
      return json({ verdict: 'FAIL', headline: 'Unhandled error outside the staged run', ...describe(err) }, 500)
    }
  },
}

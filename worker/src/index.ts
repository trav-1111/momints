// Momints roll backend — Worker entry. On-demand endpoints, plus ONE cron: the
// read-only treasury monitor (ops/monitor.ts), which reads the Irys balance and
// posts Discord alerts. No keeper acts on funds — top-up and SOL -> $SKR
// conversion remain manual operator tasks, documented in README.md.
import { OpsAlertStore, RollDb } from './db'
import { ConfigError, validateEnv, type Env, type ValidatedEnv } from './env'
import { HttpError, json } from './lib/http'
import { postDiscordAlert, type AlertSeverity } from './ops/discord'
import {
  ALERT_THRESHOLD_CRITICAL_ROLLS,
  ALERT_THRESHOLD_LOW_ROLLS,
  FUNDING_ALERT_KEY,
  readFundingSnapshot,
  runTreasuryMonitor,
  type AlertLevel,
} from './ops/monitor'
import { buildIrysUploader } from './providers/irysUploader'
import { ManualFunding } from './providers/funding/manual'
import { IrysProvider } from './providers/storage/irys'
import { PinataProvider } from './providers/storage/pinata'
import { ManualSink } from './providers/treasury/manual'
import type { FundingProvider, StorageProvider } from './providers/types'
import { createRoll, type CreateRollRequest } from './rolls/create'
import { mintFrame, summarizeFrames } from './rolls/frames'
import { createWorkerUmi } from './solana/client'

const USAGE = `Momints roll backend (devnet).
  GET  /health                          config + D1 reachability
  GET  /funding/status                  Irys balance sufficiency (operator)
  GET  /treasury/status                 accrued fees pending manual conversion (operator)
  GET  /ops/status                      treasury monitor: current level, roll headroom, last alert
  GET  /ops/test-alert?severity=low     post a dummy Discord alert (low|critical|healthy)
  POST /rolls                           create a prepaid roll (JSON body)
  GET  /rolls/open?wallet=<address>     the wallet's open roll, if any
  GET  /rolls/<collection>              roll + per-frame checkpoint status
  POST /rolls/<collection>/frames       mint one frame (multipart form)
  POST /rolls/<collection>/complete     close a roll early (frees the wallet's slot)
See README.md for request shapes and the operator runbook.
`

/**
 * Per-invocation context, shared by fetch() and the cron scheduled() handler.
 * D1-backed pieces are cheap and always available; the Irys-backed seams
 * (StorageProvider + FundingProvider) construct lazily — pure-read endpoints
 * never touch the bundler node.
 * Business logic sees only the three provider seams; swap impls here,
 * nowhere else.
 */
class WorkerContext {
  readonly db: RollDb
  readonly treasury: ManualSink
  readonly opsAlerts: OpsAlertStore
  private uploaderSeams: Promise<{ storage: StorageProvider; funding: FundingProvider }> | null = null

  constructor(readonly env: ValidatedEnv) {
    this.db = new RollDb(env.DB)
    this.treasury = new ManualSink(env.DB)
    this.opsAlerts = new OpsAlertStore(env.DB)
  }

  irysSeams(): Promise<{ storage: StorageProvider; funding: FundingProvider }> {
    this.uploaderSeams ??= (async () => {
      const uploader = await buildIrysUploader(this.env)
      await uploader.ready()

      let storage: StorageProvider
      if ((this.env.STORAGE_PROVIDER ?? 'irys') === 'pinata') {
        // TEST-ONLY fallback — IPFS pinning is not permanent. Never production.
        if (!this.env.PINATA_JWT) {
          throw new ConfigError('STORAGE_PROVIDER=pinata requires the PINATA_JWT secret')
        }
        console.warn('[storage] TEST-ONLY PinataProvider active — IPFS is NOT permanent storage')
        storage = new PinataProvider(this.env.PINATA_JWT)
      } else {
        storage = new IrysProvider(uploader)
      }
      return { storage, funding: new ManualFunding(uploader) }
    })()
    return this.uploaderSeams
  }
}

async function handleCreateRoll(ctx: WorkerContext, request: Request): Promise<Response> {
  let body: CreateRollRequest
  try {
    body = (await request.json()) as CreateRollRequest
  } catch {
    throw new HttpError(400, 'Body must be JSON: { wallet, size, artist?, skrIdentity?, localDate?, feeSignature? }')
  }
  const result = await createRoll(
    {
      db: ctx.db,
      rpcUrl: ctx.env.SOLANA_RPC_URL,
      treasury: ctx.treasury,
      getUmi: () => createWorkerUmi(ctx.env),
      getSeams: () => ctx.irysSeams(),
    },
    body,
  )
  return json(result, 201)
}

async function handleMintFrame(ctx: WorkerContext, request: Request, collectionAddress: string): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'Body must be multipart/form-data with fields: image (file), frameIndex, description?, attributes?')
  }
  const image = form.get('image')
  const frameIndex = Number(form.get('frameIndex'))
  const description = form.get('description')
  const attributesRaw = form.get('attributes')

  if (!(image instanceof File)) {
    throw new HttpError(400, 'Missing "image" file field')
  }
  let attributes: Array<{ trait_type: string; value: string }> | undefined
  if (typeof attributesRaw === 'string' && attributesRaw.length > 0) {
    try {
      const parsed = JSON.parse(attributesRaw)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      attributes = parsed
        .filter((a) => a && typeof a.trait_type === 'string' && a.value != null)
        .map((a) => ({ trait_type: String(a.trait_type).slice(0, 64), value: String(a.value).slice(0, 256) }))
    } catch {
      throw new HttpError(400, 'attributes must be a JSON array of { trait_type, value }')
    }
  }

  const result = await mintFrame(
    {
      db: ctx.db,
      rpcUrl: ctx.env.SOLANA_RPC_URL,
      getUmi: () => createWorkerUmi(ctx.env),
      getSeams: () => ctx.irysSeams(),
    },
    {
      collectionAddress,
      frameIndex,
      imageBytes: new Uint8Array(await image.arrayBuffer()),
      mime: image.type || 'image/jpeg',
      description: typeof description === 'string' && description ? description : undefined,
      attributes,
    },
  )
  return json(result, result.alreadyMinted ? 200 : 201)
}

async function handleGetRoll(ctx: WorkerContext, collectionAddress: string): Promise<Response> {
  const roll = await ctx.db.getRoll(collectionAddress)
  if (!roll) throw new HttpError(404, `No roll with collection address ${collectionAddress}`)
  const frames = await ctx.db.listFrames(collectionAddress)
  return json({
    collectionAddress: roll.collection_address,
    wallet: roll.wallet,
    name: roll.name,
    size: roll.size,
    artist: roll.artist,
    skrIdentity: roll.skr_identity,
    coverUri: roll.cover_uri,
    metadataUri: roll.metadata_uri,
    mintedCount: roll.minted_count,
    status: roll.status,
    createdAt: roll.created_at,
    frames: summarizeFrames(frames),
  })
}

/**
 * Close a roll early. Idempotent: completing an already-COMPLETE roll is a
 * success, so a client that retries (or races its own auto-completion when the
 * last frame lands) never sees a spurious failure.
 */
async function handleCompleteRoll(ctx: WorkerContext, collectionAddress: string): Promise<Response> {
  const roll = await ctx.db.getRoll(collectionAddress)
  if (!roll) throw new HttpError(404, `No roll with collection address ${collectionAddress}`)

  const alreadyComplete = roll.status === 'COMPLETE'
  if (!alreadyComplete) {
    await ctx.db.closeRoll(collectionAddress)
  }
  return json({
    collectionAddress: roll.collection_address,
    name: roll.name,
    size: roll.size,
    mintedCount: roll.minted_count,
    status: 'COMPLETE' as const,
    alreadyComplete,
  })
}

async function handleGetOpenRoll(ctx: WorkerContext, url: URL): Promise<Response> {
  const wallet = url.searchParams.get('wallet')
  if (!wallet) throw new HttpError(400, 'Missing ?wallet= query parameter')
  const roll = await ctx.db.getOpenRoll(wallet)
  if (!roll) return json({ openRoll: null })
  return json({
    openRoll: {
      collectionAddress: roll.collection_address,
      name: roll.name,
      size: roll.size,
      mintedCount: roll.minted_count,
      status: roll.status,
    },
  })
}

async function handleHealth(env: Env): Promise<Response> {
  const checks: Record<string, boolean | string> = {
    rpcConfigured: Boolean(env.SOLANA_RPC_URL),
    irysKeyConfigured: Boolean(env.IRYS_FUNDING_KEY),
    // Informational only — alerting is optional and deliberately not part of `ok`.
    discordWebhookConfigured: Boolean(env.DISCORD_WEBHOOK_URL),
  }
  try {
    await env.DB.prepare('SELECT 1').first()
    checks.d1 = true
  } catch (err) {
    checks.d1 = err instanceof Error ? `unreachable: ${err.message}` : 'unreachable'
  }
  const ok = checks.rpcConfigured === true && checks.irysKeyConfigured === true && checks.d1 === true
  return json({ ok, checks }, ok ? 200 : 500)
}

/**
 * Read-only introspection into what the treasury monitor currently thinks,
 * without waiting for the next cron. Reads the balance; posts nothing.
 */
async function handleOpsStatus(ctx: WorkerContext): Promise<Response> {
  const { funding } = await ctx.irysSeams()
  const snapshot = await readFundingSnapshot(funding)
  const state = await ctx.opsAlerts.get(FUNDING_ALERT_KEY)
  // Missing state reads as `healthy` — same rule the scheduled check applies.
  const lastLevel: AlertLevel = state?.last_level ?? 'healthy'

  return json({
    alertKey: FUNDING_ALERT_KEY,
    level: snapshot.level,
    rollsRemaining: snapshot.rollsRemaining,
    balanceSol: snapshot.balanceSol,
    balanceAtomic: snapshot.balanceAtomic,
    perRollSol: snapshot.perRollSol,
    perRollAtomic: snapshot.perRollAtomic,
    perFrameAtomic: snapshot.perFrameAtomic,
    sufficientForOneFrame: snapshot.funding.sufficient,
    thresholds: { lowRolls: ALERT_THRESHOLD_LOW_ROLLS, criticalRolls: ALERT_THRESHOLD_CRITICAL_ROLLS },
    lastAlerted: state
      ? { level: state.last_level, value: state.last_value, updatedAt: state.updated_at }
      : null,
    /** What the next cron run would do at this instant. */
    wouldPost: snapshot.level !== lastLevel,
    discordConfigured: Boolean(ctx.env.DISCORD_WEBHOOK_URL),
    operatorMentionConfigured: Boolean(ctx.env.OPERATOR_DISCORD_ID),
  })
}

/**
 * Post a dummy alert of the requested severity — proves the webhook, the embed
 * colours, and the @-mention render correctly BEFORE the scheduled path is
 * trusted. Reads no balance and touches no funds.
 *
 * TODO(mainnet): remove or put behind operator auth. It is unauthenticated, so
 * anyone who learns the URL can spam the channel (never the webhook itself —
 * the secret is not exposed). Acceptable on devnet only.
 */
async function handleOpsTestAlert(ctx: WorkerContext, url: URL): Promise<Response> {
  const requested = url.searchParams.get('severity') ?? 'low'
  if (requested !== 'healthy' && requested !== 'low' && requested !== 'critical') {
    throw new HttpError(400, `severity must be one of healthy, low, critical (got "${requested}")`)
  }
  const severity: AlertSeverity = requested

  const delivery = await postDiscordAlert(ctx.env, {
    severity,
    title: `TEST alert (${severity}) — treasury monitor wiring check`,
    description:
      'Manual test from GET /ops/test-alert. No balance was read and nothing was funded — this only ' +
      'exercises the webhook, the severity colour, and (on critical) the operator mention.',
    mention: severity === 'critical',
    fields: [
      { name: 'Source', value: 'GET /ops/test-alert' },
      { name: 'Severity', value: severity },
      { name: 'Real alert?', value: 'No — dummy payload' },
    ],
  })

  return json({ severity, delivered: delivery.ok, error: delivery.error ?? null }, delivery.ok ? 200 : 502)
}

type Route =
  | { kind: 'funding-status' }
  | { kind: 'treasury-status' }
  | { kind: 'ops-status' }
  | { kind: 'ops-test-alert' }
  | { kind: 'create-roll' }
  | { kind: 'open-roll' }
  | { kind: 'get-roll'; collection: string }
  | { kind: 'mint-frame'; collection: string }
  | { kind: 'complete-roll'; collection: string }

/** Match secret-requiring routes. Unknown paths 404 before env validation. */
function matchRoute(method: string, path: string): Route | null {
  if (method === 'GET' && path === '/funding/status') return { kind: 'funding-status' }
  if (method === 'GET' && path === '/treasury/status') return { kind: 'treasury-status' }
  if (method === 'GET' && path === '/ops/status') return { kind: 'ops-status' }
  if (method === 'GET' && path === '/ops/test-alert') return { kind: 'ops-test-alert' }
  if (method === 'POST' && path === '/rolls') return { kind: 'create-roll' }
  if (method === 'GET' && path === '/rolls/open') return { kind: 'open-roll' }
  const rollMatch = path.match(/^\/rolls\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/frames|\/complete)?$/)
  if (rollMatch) {
    const [, collection, suffix] = rollMatch
    if (!suffix && method === 'GET') return { kind: 'get-roll', collection }
    if (suffix === '/frames' && method === 'POST') return { kind: 'mint-frame', collection }
    if (suffix === '/complete' && method === 'POST') return { kind: 'complete-roll', collection }
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (request.method === 'GET' && path === '/') {
        return new Response(USAGE, { headers: { 'content-type': 'text/plain' } })
      }
      if (request.method === 'GET' && path === '/health') {
        return handleHealth(env)
      }

      const route = matchRoute(request.method, path)
      if (!route) {
        return json({ error: `No route: ${request.method} ${path}. GET / for usage.` }, 404)
      }

      // Fail fast, operator-facing, before any work: required secrets present
      // and not pointing at a public RPC (no public fallback exists).
      const ctx = new WorkerContext(validateEnv(env))

      switch (route.kind) {
        case 'funding-status': {
          const { funding } = await ctx.irysSeams()
          // Same single balance read the cron uses (ops/monitor.ts). Response
          // is the original FundingStatus plus the derived roll headroom.
          const snapshot = await readFundingSnapshot(funding)
          return json({
            ...snapshot.funding,
            balanceSol: snapshot.balanceSol,
            perRollSol: snapshot.perRollSol,
            rollsRemaining: snapshot.rollsRemaining,
            level: snapshot.level,
          })
        }
        case 'treasury-status':
          return json(await ctx.treasury.status())
        case 'ops-status':
          return await handleOpsStatus(ctx)
        case 'ops-test-alert':
          return await handleOpsTestAlert(ctx, url)
        case 'create-roll':
          return await handleCreateRoll(ctx, request)
        case 'open-roll':
          return await handleGetOpenRoll(ctx, url)
        case 'get-roll':
          return await handleGetRoll(ctx, route.collection)
        case 'mint-frame':
          return await handleMintFrame(ctx, request, route.collection)
        case 'complete-roll':
          return await handleCompleteRoll(ctx, route.collection)
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status)
      }
      if (err instanceof ConfigError) {
        return json({ error: `Worker misconfigured: ${err.message}` }, 500)
      }
      console.error('[unhandled]', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
      return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
    }
  },

  /**
   * Cron entry — schedule lives in wrangler.toml [triggers]. A thin dispatcher:
   * every check, and all of the severity/hysteresis logic, lives in
   * ops/monitor.ts.
   *
   * READ-AND-NOTIFY ONLY. It reads the Irys balance and posts to Discord. It
   * never funds, signs, or moves anything — auto top-up would be the
   * AutomatedFunding keeper, which deliberately does not exist
   * (providers/funding/automated.ts).
   *
   * NEVER THROWS. A scheduled handler that throws fails silently, so the
   * operator would lose monitoring at exactly the moment they need it. Errors
   * are logged (visible in `wrangler tail` / Workers logs) and the next run
   * retries.
   */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const ctx = new WorkerContext(validateEnv(env))
      const { checks } = await runTreasuryMonitor({
        env: ctx.env,
        alerts: ctx.opsAlerts,
        getFunding: async () => (await ctx.irysSeams()).funding,
      })
      for (const check of checks) {
        console.log(`[ops] cron ${controller.cron} · ${check.key}: ${check.ok ? 'ok' : 'FAILED'} — ${check.note}`)
      }
    } catch (err) {
      console.error(
        `[ops] scheduled run (${controller.cron}) failed:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
    }
  },
}

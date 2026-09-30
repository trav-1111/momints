// Momints roll backend — Worker entry. On-demand endpoints, plus ONE cron that
// does two read-mostly jobs: the treasury monitor (ops/monitor.ts), which reads
// the Turbo credit balance and posts Discord alerts, and the quick-mint sweep
// (quick/sweep.ts), which reaps abandoned stages and re-drives paid finalizes
// that never completed. No keeper acts on funds — top-up and SOL -> $SKR
// conversion remain manual operator tasks, documented in README.md.
import { OpsAlertStore, RollDb } from './db'
import {
  ConfigError,
  validateEnv,
  validateQuickEnv,
  type Env,
  type QuickFinalizeMessage,
  type ValidatedEnv,
} from './env'
import { FeeCache } from './fees/cache'
import { runFeeRecompute } from './fees/compute'
import { isBase58Address } from './lib/address'
import { HttpError, json } from './lib/http'
import {
  isHttpRouteBlockedByMaintenance,
  isMaintenanceMode,
  MAINTENANCE_QUEUE_RETRY_SECONDS,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from './maintenance'
import { sanitizeAttributes } from './lib/sanitize'
import { getHealthSnapshot, getMetricsSnapshot, getWalletsSnapshot, type MetricsWindow } from './ops/dashboard'
import { postDiscordAlert, type AlertSeverity } from './ops/discord'
import {
  ALERT_THRESHOLD_CRITICAL_ROLLS,
  ALERT_THRESHOLD_LOW_ROLLS,
  FUNDING_ALERT_KEY,
  readFundingSnapshot,
  runTreasuryMonitor,
  type AlertLevel,
} from './ops/monitor'
import { buildTurboClient, TurboFundingShortError } from './providers/turboClient'
import { TurboFunding } from './providers/funding/turbo'
import { TurboProvider } from './providers/storage/turbo'
import { PinataProvider } from './providers/storage/pinata'
import { ManualSink } from './providers/treasury/manual'
import type { FundingProvider, StorageProvider } from './providers/types'
import { finalizeQuickMintJob, type AlertFn } from './quick/consumer'
import { finalizeQuickMint, type FinalizeQuickMintRequest } from './quick/finalize'
import { releaseQuickStage, stageQuickMint } from './quick/stage'
import { redriveDeferredFinalizes, sweepQuickMints } from './quick/sweep'
import { createRoll, type CreateRollRequest } from './rolls/create'
import { completeAuthorizedRoll } from './rolls/complete'
import { isRollSize } from './rolls/config'
import { mintFrame, summarizeFrames } from './rolls/frames'
import { revokeRollDelegate, revokeRollDelegateSafely } from './rolls/handoff'
import {
  assertRollCapability,
  authorizeRollRequest,
  hashRollCapability,
  verifyLegacyClaimSignature,
} from './rolls/auth'
import { verifyFrameArtifact } from './rolls/imageArtifact'
import { issueSkrQuote, type SkrQuoteRequest } from './skr/quote'
import { createWorkerUmi, getWorkerPublicKey } from './solana/client'
import { resolveSkrNames } from './skr/resolve'
import { FILMSTOCK_CATALOGUE, FILMSTOCK_CATALOGUE_UPDATED_AT, catalogueItem } from './filmstocks/catalogue'
import { deriveUnlockedFilmStocks } from './filmstocks/das'

// Must equal one of the strings in wrangler.toml [triggers] crons exactly —
// scheduled() below uses it to tell the two registered cron schedules apart.
// The OTHER schedule (treasury monitor + sweeps, every 6h) has no constant of
// its own: it is simply "not this one" in scheduled()'s dispatch.
const FEE_RECOMPUTE_CRON = '0 */3 * * *'

function connectingIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

const USAGE = `Momints roll backend.
  GET  /health                          config + D1 reachability
  GET  /funding/status                  Turbo credit balance sufficiency (operator; bearer token required)
  GET  /treasury/status                 accrued fees pending manual conversion (operator; bearer token required)
  GET  /fees                            current cost-plus mint fees (quick, roll 12/24)
  GET  /identity/skr?wallet=<address>  read-only reverse skr display identity
  GET  /ops/status                      treasury monitor: current level, roll headroom, last alert
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  GET  /ops/test-alert?severity=low     post a dummy Discord alert (low|critical|healthy)
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  GET  /ops/recompute-fees              manually run the cost-plus fee recompute (operator)
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  GET  /ops/sweep-quick-mints           manually re-drive deferred quick-mint finalizes (operator)
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  POST /rolls                           create a prepaid roll (JSON body)
  GET  /rolls/open?wallet=<address>     the wallet's open roll, if any
  GET  /rolls/<collection>              roll + per-frame checkpoint status
  POST /rolls/<collection>/frames       mint one frame (multipart form)
  POST /rolls/<collection>/authorize    wallet-signed recovery for a pre-contract roll
  POST /rolls/<collection>/complete     close a roll early (frees the wallet's slot)
  POST /quick/stage                     park a quick-mint image, get its mint params (multipart form)
  POST /quick/finalize                  prove the fee landed on-chain, queue the Arweave upload (JSON body)
  DEL  /quick/stage/<stagingKey>        give back an unminted stage (user declined the wallet prompt)
  GET  /quick/<asset>                   quick-mint finalize status
  POST /skr/quote                       Worker-issued $SKR fee quote (JSON: {context:'quick',stagingKey} or {context:'roll',wallet,size})
  GET  /v1/filmstocks                   public filmstock catalogue (server-time availability)
  POST /v1/filmstocks/unlocked          stateless developed-roll unlock scan ({creatorAddress})
  GET  /v1/filmstocks/assets/<path>     immutable recipe/preview/texture asset from R2
  GET  /ops/dashboard/wallets           signer + treasury balances (SOL, $SKR, Turbo credits) — operator dashboard
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  GET  /ops/dashboard/health            cron last-run, stuck/DEAD counts, current fees — operator dashboard
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
  GET  /ops/dashboard/metrics?window=all|7d|30d   aggregate usage metrics ONLY, never per-wallet — operator dashboard
                                         requires: Authorization: Bearer <OPS_AUTH_TOKEN>
See README.md for request shapes and the operator runbook.
`

/**
 * Per-invocation context, shared by fetch() and the cron scheduled() handler.
 * D1-backed pieces are cheap and always available; the Turbo-backed seams
 * (StorageProvider + FundingProvider) construct lazily — pure-read endpoints
 * never touch Turbo.
 * Business logic sees only the three provider seams; swap impls here,
 * nowhere else.
 */
class WorkerContext {
  readonly db: RollDb
  readonly treasury: ManualSink
  readonly opsAlerts: OpsAlertStore
  /** Cost-plus fee cache (fees/cache.ts) — a plain D1 read, always cheap; never triggers a live recompute. */
  readonly feeCache: FeeCache
  private uploaderSeams: Promise<{ storage: StorageProvider; funding: FundingProvider }> | null = null

  constructor(readonly env: ValidatedEnv) {
    this.db = new RollDb(env.DB)
    this.treasury = new ManualSink(env.DB)
    this.opsAlerts = new OpsAlertStore(env.DB)
    this.feeCache = new FeeCache(env.DB)
  }

  storageSeams(): Promise<{ storage: StorageProvider; funding: FundingProvider }> {
    this.uploaderSeams ??= (async () => {
      const turbo = buildTurboClient(this.env)

      let storage: StorageProvider
      if ((this.env.STORAGE_PROVIDER ?? 'turbo') === 'pinata') {
        // TEST-ONLY fallback — IPFS pinning is not permanent. Never production.
        if (!this.env.PINATA_JWT) {
          throw new ConfigError('STORAGE_PROVIDER=pinata requires the PINATA_JWT secret')
        }
        console.warn('[storage] TEST-ONLY PinataProvider active — IPFS is NOT permanent storage')
        storage = new PinataProvider(this.env.PINATA_JWT)
      } else {
        storage = new TurboProvider(turbo)
      }
      return { storage, funding: new TurboFunding(turbo) }
    })()
    return this.uploaderSeams
  }
}

async function handleCreateRoll(ctx: WorkerContext, request: Request): Promise<Response> {
  let body: CreateRollRequest
  try {
    body = (await request.json()) as CreateRollRequest
  } catch {
    throw new HttpError(
      400,
      'Body must be JSON: { wallet, size, filmStockId, feeSignature, rollCapability, artist?, skrIdentity?, localDate?, payment? }',
    )
  }
  // Not folded into validateEnv: a half-configured quick flow (missing
  // QUICK_PLACEHOLDER_URI) must never take roll creation down with it, so this
  // checks only the one thing roll fee verification actually needs.
  if (!ctx.env.QUICK_TREASURY_ADDRESS) {
    throw new ConfigError(
      'QUICK_TREASURY_ADDRESS is not set. Put the treasury address in wrangler.toml [vars] — rolls cannot verify fee payment without it.',
    )
  }
  const result = await createRoll(
    {
      db: ctx.db,
      rpcUrl: ctx.env.SOLANA_RPC_URL,
      treasury: ctx.treasury,
      treasuryAddress: ctx.env.QUICK_TREASURY_ADDRESS,
      feeCache: ctx.feeCache,
      getUmi: () => createWorkerUmi(ctx.env),
      getSeams: () => ctx.storageSeams(),
    },
    body,
  )
  return json(result, 201)
}

async function handleMintFrame(ctx: WorkerContext, request: Request, collectionAddress: string): Promise<Response> {
  // This D1 read and capability comparison must happen before formData(),
  // which consumes and buffers the multipart image body.
  const roll = await authorizeRollRequest(ctx.db, request, collectionAddress)
  const limit = await ctx.env.ROLL_MUTATION_LIMITER.limit({ key: collectionAddress })
  if (!limit.success) throw new HttpError(429, 'Roll frame rate limit exceeded')
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(
      400,
      'Body must be multipart/form-data with fields: image (file), frameIndex, description?, attributes?',
    )
  }
  const image = form.get('image')
  const frameIndex = Number(form.get('frameIndex'))
  const description = form.get('description')
  const attributesRaw = form.get('attributes')

  if (!(image instanceof File)) {
    throw new HttpError(400, 'Missing "image" file field')
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer())
  const artifact = await verifyFrameArtifact(imageBytes, roll.protocol_version)
  let attributes: Array<{ trait_type: string; value: string }> | undefined
  if (typeof attributesRaw === 'string' && attributesRaw.length > 0) {
    try {
      const parsed = JSON.parse(attributesRaw)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      attributes = sanitizeAttributes(parsed)
    } catch {
      throw new HttpError(400, 'attributes must be a JSON array of { trait_type, value }')
    }
  }

  const result = await mintFrame(
    {
      db: ctx.db,
      rpcUrl: ctx.env.SOLANA_RPC_URL,
      getUmi: () => createWorkerUmi(ctx.env),
      getSeams: () => ctx.storageSeams(),
    },
    {
      collectionAddress,
      frameIndex,
      imageBytes,
      artifact,
      mime: artifact.mime,
      description: typeof description === 'string' && description ? description : undefined,
      attributes,
    },
  )
  return json(result, result.alreadyMinted ? 200 : 201)
}

async function handleGetRoll(ctx: WorkerContext, request: Request, collectionAddress: string): Promise<Response> {
  const roll = await authorizeRollRequest(ctx.db, request, collectionAddress)
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
    developedOnChain: roll.minted_count === roll.size && roll.handoff_signature !== null,
    createdAt: roll.created_at,
    frames: summarizeFrames(frames),
  })
}

async function handleAuthorizeLegacyRoll(
  ctx: WorkerContext,
  request: Request,
  collectionAddress: string,
): Promise<Response> {
  const limit = await ctx.env.ROLL_MUTATION_LIMITER.limit({ key: `authorize:${collectionAddress}` })
  if (!limit.success) throw new HttpError(429, 'Roll authorization rate limit exceeded')
  let body: { wallet?: unknown; rollCapability?: unknown; issuedAt?: unknown; signature?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    throw new HttpError(400, 'Body must be JSON: { wallet, rollCapability, issuedAt, signature }')
  }
  const roll = await ctx.db.getRoll(collectionAddress)
  if (!roll) throw new HttpError(404, `No roll with collection address ${collectionAddress}`)
  if (typeof body.wallet !== 'string' || body.wallet !== roll.wallet) {
    throw new HttpError(403, 'Only the roll wallet can recover its authorization')
  }
  assertRollCapability(body.rollCapability)
  const capabilityHash = await hashRollCapability(body.rollCapability)
  if (roll.auth_hash) {
    if (roll.auth_hash !== capabilityHash) throw new HttpError(409, 'This roll already has different authorization')
    return json({ collectionAddress, protocolVersion: roll.protocol_version, alreadyAuthorized: true })
  }
  if (roll.protocol_version !== 1) throw new HttpError(409, 'Only a pre-contract roll can use authorization recovery')
  if (typeof body.issuedAt !== 'string' || typeof body.signature !== 'string') {
    throw new HttpError(400, 'issuedAt and signature are required')
  }
  const verified = await verifyLegacyClaimSignature({
    collectionAddress,
    wallet: body.wallet,
    capabilityHash,
    issuedAt: body.issuedAt,
    signature: body.signature,
  })
  if (!verified) throw new HttpError(403, 'Wallet signature did not authorize this roll')
  const claimed = await ctx.db.claimLegacyRollCapability(collectionAddress, body.wallet, capabilityHash)
  if (!claimed) {
    const current = await ctx.db.getRoll(collectionAddress)
    if (current?.auth_hash !== capabilityHash) throw new HttpError(409, 'This roll was authorized by another request')
  }
  return json({ collectionAddress, protocolVersion: 1, alreadyAuthorized: false })
}

/**
 * Close a roll early. Idempotent: completing an already-COMPLETE roll is a
 * success, so a client that retries (or races its own auto-completion when the
 * last frame lands) never sees a spurious failure.
 */
async function handleCompleteRoll(ctx: WorkerContext, request: Request, collectionAddress: string): Promise<Response> {
  const roll = await authorizeRollRequest(ctx.db, request, collectionAddress)
  const limit = await ctx.env.ROLL_MUTATION_LIMITER.limit({ key: collectionAddress })
  if (!limit.success) throw new HttpError(429, 'Roll completion rate limit exceeded')
  const result = await completeAuthorizedRoll(
    {
      closeRoll: (address) => ctx.db.closeRoll(address),
      // Non-fatal and safe to call unconditionally: a no-op if already handed
      // off, and another attempt if an earlier response was lost mid-handoff.
      retryHandoff: (address) =>
        revokeRollDelegateSafely(
          { db: ctx.db, rpcUrl: ctx.env.SOLANA_RPC_URL, getUmi: () => createWorkerUmi(ctx.env) },
          address,
        ),
    },
    roll,
  )
  return json(result)
}

// ─── Quick mints ──────────────────────────────────────────────────────────────

async function handleStageQuickMint(ctx: WorkerContext, request: Request): Promise<Response> {
  const env = validateQuickEnv(ctx.env)
  const limit = await ctx.env.QUICK_MINT_LIMITER.limit({ key: `stage:${connectingIp(request)}` })
  if (!limit.success) throw new HttpError(429, 'Quick mint staging rate limit exceeded')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'Body must be multipart/form-data with fields: image (file), metadata (JSON), wallet')
  }
  const image = form.get('image')
  const wallet = form.get('wallet')
  const metadataRaw = form.get('metadata')

  if (!(image instanceof File)) {
    throw new HttpError(400, 'Missing "image" file field')
  }
  if (typeof wallet !== 'string' || !isBase58Address(wallet)) {
    throw new HttpError(400, 'wallet must be a valid Solana public key')
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer())
  const artifact = await verifyFrameArtifact(imageBytes, 2)
  let metadata: unknown
  try {
    metadata = typeof metadataRaw === 'string' && metadataRaw ? JSON.parse(metadataRaw) : {}
  } catch {
    throw new HttpError(400, 'metadata must be a JSON object')
  }

  const result = await stageQuickMint(
    {
      db: ctx.db,
      bucket: ctx.env.QUICK_STAGING,
      placeholderUri: env.QUICK_PLACEHOLDER_URI,
      treasury: env.QUICK_TREASURY_ADDRESS,
      workerPubkey: getWorkerPublicKey(ctx.env),
      feeCache: ctx.feeCache,
    },
    {
      wallet,
      imageBytes,
      mime: artifact.mime,
      artifact,
      metadata,
    },
  )
  return json(result, 201)
}

async function handleFinalizeQuickMint(ctx: WorkerContext, request: Request): Promise<Response> {
  const env = validateQuickEnv(ctx.env)
  const limit = await ctx.env.QUICK_MINT_LIMITER.limit({ key: `finalize:${connectingIp(request)}` })
  if (!limit.success) throw new HttpError(429, 'Quick mint finalize rate limit exceeded')

  let body: FinalizeQuickMintRequest
  try {
    body = (await request.json()) as FinalizeQuickMintRequest
  } catch {
    throw new HttpError(400, 'Body must be JSON: { stagingKey, signature, assetAddress }')
  }

  const result = await finalizeQuickMint(
    {
      db: ctx.db,
      queue: ctx.env.QUICK_FINALIZE,
      treasury: ctx.treasury,
      rpcUrl: ctx.env.SOLANA_RPC_URL,
      placeholderUri: env.QUICK_PLACEHOLDER_URI,
      treasuryAddress: env.QUICK_TREASURY_ADDRESS,
      getUmi: () => createWorkerUmi(ctx.env),
      alert: discordAlerts(ctx.env),
    },
    body,
  )
  return json(result, result.alreadyFinalizing ? 200 : 202)
}

async function handleReleaseQuickStage(ctx: WorkerContext, stagingKey: string): Promise<Response> {
  const result = await releaseQuickStage({ db: ctx.db, bucket: ctx.env.QUICK_STAGING }, stagingKey)
  return json(result)
}

async function handleGetQuickMint(ctx: WorkerContext, assetAddress: string): Promise<Response> {
  const row = await ctx.db.getQuickMintByAsset(assetAddress)
  if (!row) throw new HttpError(404, `No quick mint for asset ${assetAddress}`)
  return json({
    assetAddress: row.asset_address,
    wallet: row.wallet,
    status: row.status,
    imageUri: row.image_uri,
    metadataUri: row.arweave_uri,
    signature: row.signature,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
    mime: row.mime,
    byteLength: row.byte_length,
    width: row.width,
    height: row.height,
    imageHash: row.image_hash,
  })
}

async function handleIdentitySkr(ctx: WorkerContext, url: URL): Promise<Response> {
  const wallet = url.searchParams.get('wallet')
  if (!wallet || !isBase58Address(wallet)) throw new HttpError(400, 'wallet must be a valid Solana public key')
  try {
    const names = await resolveSkrNames(ctx.env.SOLANA_RPC_URL, wallet)
    return json({ domain: names[0] ?? null }, 200, { 'cache-control': 'public, max-age=300' })
  } catch (error) {
    console.warn('[identity/skr] lookup failed', error instanceof Error ? error.message : 'unknown')
    throw new HttpError(503, 'Wallet name lookup temporarily unavailable')
  }
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
    deployment: env.DEPLOYMENT_ENV ?? 'unspecified',
    maintenance: isMaintenanceMode(env),
    rpcConfigured: Boolean(env.SOLANA_RPC_URL),
    fundingKeyConfigured: Boolean(env.IRYS_FUNDING_KEY),
    // Informational only — alerting is optional and deliberately not part of `ok`.
    discordWebhookConfigured: Boolean(env.DISCORD_WEBHOOK_URL),
  }
  try {
    await env.DB.prepare('SELECT 1').first()
    checks.d1 = true
  } catch (err) {
    checks.d1 = err instanceof Error ? `unreachable: ${err.message}` : 'unreachable'
  }
  const ok = checks.rpcConfigured === true && checks.fundingKeyConfigured === true && checks.d1 === true
  return json({ ok, checks }, ok ? 200 : 500)
}

/**
 * Read-only introspection into what the treasury monitor currently thinks,
 * without waiting for the next cron. Reads the balance; posts nothing.
 */
/**
 * Gate for the two ops routes. Fails CLOSED: an unset OPS_AUTH_TOKEN refuses
 * every request rather than leaving the route open, since forgetting to set
 * the secret must never silently reproduce the exact hole this closes.
 */
function requireOpsAuth(ctx: WorkerContext, request: Request): void {
  if (!ctx.env.OPS_AUTH_TOKEN) {
    throw new ConfigError('OPS_AUTH_TOKEN secret is not set. Set it with `wrangler secret put OPS_AUTH_TOKEN`.')
  }
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (token !== ctx.env.OPS_AUTH_TOKEN) {
    throw new HttpError(401, 'Missing or invalid Authorization: Bearer <OPS_AUTH_TOKEN> header')
  }
}

/**
 * CORS for GET /ops/dashboard/* only — every other route here is app-to-
 * worker, which browsers don't CORS-check. Never reflects an arbitrary
 * Origin: the allow-origin header is set ONLY when it exactly matches the
 * configured DASHBOARD_ORIGIN, so this can't be tricked into allowing a
 * different site — see env.ts's doc comment on why this is a courtesy
 * header, not the actual security boundary (requireOpsAuth is).
 */
function dashboardOriginMatch(env: Env, request: Request): string | null {
  const origin = request.headers.get('origin')
  return env.DASHBOARD_ORIGIN && origin === env.DASHBOARD_ORIGIN ? env.DASHBOARD_ORIGIN : null
}

function dashboardCorsPreflight(env: Env, request: Request): Response {
  const headers = new Headers()
  const allowedOrigin = dashboardOriginMatch(env, request)
  if (allowedOrigin) {
    headers.set('access-control-allow-origin', allowedOrigin)
    headers.set('access-control-allow-headers', 'authorization, content-type')
    headers.set('access-control-allow-methods', 'GET, OPTIONS')
    headers.set('access-control-max-age', '86400')
    headers.set('vary', 'origin')
  }
  return new Response(null, { status: 204, headers })
}

function withDashboardCors(response: Response, env: Env, request: Request): Response {
  const allowedOrigin = dashboardOriginMatch(env, request)
  if (!allowedOrigin) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', allowedOrigin)
  headers.set('vary', 'origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function handleOpsStatus(ctx: WorkerContext): Promise<Response> {
  const { funding } = await ctx.storageSeams()
  const snapshot = await readFundingSnapshot(funding)
  const state = await ctx.opsAlerts.get(FUNDING_ALERT_KEY)
  // Missing state reads as `healthy` — same rule the scheduled check applies.
  const lastLevel: AlertLevel = state?.last_level ?? 'healthy'

  return json({
    alertKey: FUNDING_ALERT_KEY,
    level: snapshot.level,
    rollsRemaining: snapshot.rollsRemaining,
    balanceCredits: snapshot.balanceCredits,
    balanceAtomic: snapshot.balanceAtomic,
    perRollCredits: snapshot.perRollCredits,
    perRollAtomic: snapshot.perRollAtomic,
    perFrameAtomic: snapshot.perFrameAtomic,
    sufficientForOneFrame: snapshot.funding.sufficient,
    thresholds: { lowRolls: ALERT_THRESHOLD_LOW_ROLLS, criticalRolls: ALERT_THRESHOLD_CRITICAL_ROLLS },
    lastAlerted: state ? { level: state.last_level, value: state.last_value, updatedAt: state.updated_at } : null,
    /** What the next cron run would do at this instant. */
    wouldPost: snapshot.level !== lastLevel,
    discordConfigured: Boolean(ctx.env.DISCORD_WEBHOOK_URL),
    operatorMentionConfigured: Boolean(ctx.env.OPERATOR_DISCORD_ID),
  })
}

/**
 * Post a dummy alert of the requested severity — proves the webhook, the embed
 * colours, and the @-mention render correctly BEFORE the scheduled path is
 * trusted. Reads no balance and touches no funds. Gated by requireOpsAuth()
 * at the call site — the webhook secret itself is never exposed either way.
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

/**
 * Current cost-plus mint fees, straight off fee_cache — a plain D1 read, never
 * a live recompute (that only ever happens on the 3-hourly cron or via
 * GET /ops/recompute-fees). This is what the app calls at mint confirmation
 * time (README "Cost-plus fee pricing") so the price shown always matches
 * what verify.ts will actually check.
 */
async function handleGetFees(ctx: WorkerContext): Promise<Response> {
  const row = await ctx.feeCache.get()
  if (!row) {
    throw new ConfigError('fee_cache has no row — re-run migrations (0007_fee_cache.sql seeds it).')
  }

  return json({
    quickFeeLamports: row.quickFeeLamports,
    rollFee12Lamports: row.rollFee12Lamports,
    rollFee24Lamports: row.rollFee24Lamports,
    computedAt: row.computedAt,
    lastGood: row.lastGood,
  })
}

/**
 * The real $SKR amount for a mint/roll fee, right now — a live Jupiter quote
 * of (cost-plus SOL fee x SKR_DISCOUNT), PERSISTED so a later finalize/create
 * call verifies against exactly this number and never a client-declared
 * amount. Supersedes the old GET /fees `skrTargetUsd` field, which was a
 * speculative USD-only estimate with no real Jupiter quote behind it.
 */
function parseSkrQuoteRequest(body: unknown): SkrQuoteRequest {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.context === 'quick') {
    if (typeof b.stagingKey !== 'string' || b.stagingKey.length === 0) {
      throw new HttpError(400, "$SKR quote for context 'quick' requires a non-empty stagingKey")
    }
    return { context: 'quick', stagingKey: b.stagingKey }
  }
  if (b.context === 'roll') {
    if (typeof b.wallet !== 'string' || !isBase58Address(b.wallet)) {
      throw new HttpError(400, "$SKR quote for context 'roll' requires wallet to be a base58 Solana address")
    }
    if (typeof b.size !== 'number' || !isRollSize(b.size)) {
      throw new HttpError(
        400,
        `$SKR quote for context 'roll' requires size to be 12 or 24, got ${JSON.stringify(b.size)}`,
      )
    }
    return { context: 'roll', wallet: b.wallet, size: b.size }
  }
  throw new HttpError(400, "Body must be JSON: { context: 'quick', stagingKey } or { context: 'roll', wallet, size }")
}

async function handleSkrQuote(ctx: WorkerContext, request: Request): Promise<Response> {
  if (!ctx.env.QUICK_TREASURY_ADDRESS) {
    throw new ConfigError(
      'QUICK_TREASURY_ADDRESS is not set. Put the treasury address in wrangler.toml [vars] — ' +
        '$SKR quotes cannot derive the treasury ATA without it.',
    )
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, "Body must be JSON: { context: 'quick', stagingKey } or { context: 'roll', wallet, size }")
  }
  const req = parseSkrQuoteRequest(body)

  const result = await issueSkrQuote(
    {
      db: ctx.db,
      feeCache: ctx.feeCache,
      getUmi: () => createWorkerUmi(ctx.env),
      treasuryAddress: ctx.env.QUICK_TREASURY_ADDRESS,
    },
    req,
  )
  return json(result)
}

/**
 * Manually run the cost-plus fee recompute — the GET /ops/test-alert of the
 * fee system: lets the operator exercise the guards and see a real result
 * without waiting for the 3-hourly cron. Gated by requireOpsAuth() at the
 * call site, same as every other /ops route.
 */
async function handleOpsRecomputeFees(ctx: WorkerContext): Promise<Response> {
  const turbo = buildTurboClient(ctx.env)
  const result = await runFeeRecompute({ env: ctx.env, cache: ctx.feeCache, turbo })
  return json(result, result.ok ? 200 : 503)
}

/**
 * Manually run the deferred-finalize redrive sweep without waiting for the
 * cron. Same purpose as GET /ops/recompute-fees for the fee system: lets the
 * operator (or this session, verifying a fix) see a real result on demand.
 * Requires the quick-mint env — a half-configured quick flow reports that
 * clearly instead of a confusing failure deeper in.
 */
async function handleOpsSweepQuickMints(ctx: WorkerContext): Promise<Response> {
  const env = validateQuickEnv(ctx.env)
  const result = await redriveDeferredFinalizes({
    db: ctx.db,
    queue: ctx.env.QUICK_FINALIZE,
    treasury: ctx.treasury,
    rpcUrl: ctx.env.SOLANA_RPC_URL,
    placeholderUri: env.QUICK_PLACEHOLDER_URI,
    treasuryAddress: env.QUICK_TREASURY_ADDRESS,
    getUmi: () => createWorkerUmi(ctx.env),
    alert: discordAlerts(ctx.env),
  })
  return json(result)
}

// ─── Operator dashboard (ops/dashboard.ts) ─────────────────────────────────
//
// Three read-only, aggregate-only, OPS_AUTH_TOKEN-gated endpoints for the
// Cloudflare Pages dashboard — see worker/README.md "Operator dashboard" and
// dashboard/README.md. requireOpsAuth() at each call site below is the real
// security boundary; withDashboardCors()/dashboardCorsPreflight() near the
// bottom of this file are a browser-side courtesy on top of it, not a
// substitute for it.

async function handleOpsDashboardWallets(ctx: WorkerContext): Promise<Response> {
  const env = validateQuickEnv(ctx.env) // needs QUICK_TREASURY_ADDRESS
  const result = await getWalletsSnapshot({
    env: ctx.env,
    rpcUrl: ctx.env.SOLANA_RPC_URL,
    treasuryAddress: env.QUICK_TREASURY_ADDRESS,
    getUmi: () => createWorkerUmi(ctx.env),
    getFunding: async () => (await ctx.storageSeams()).funding,
  })
  return json(result)
}

async function handleOpsDashboardHealth(ctx: WorkerContext): Promise<Response> {
  const result = await getHealthSnapshot({ db: ctx.db, feeCache: ctx.feeCache, opsAlerts: ctx.opsAlerts })
  return json(result)
}

async function handleOpsDashboardMetrics(ctx: WorkerContext, url: URL): Promise<Response> {
  const raw = url.searchParams.get('window')
  const window: MetricsWindow = raw === '7d' || raw === '30d' ? raw : 'all'
  const result = await getMetricsSnapshot({ db: ctx.db }, window)
  return json(result)
}

type Route =
  | { kind: 'filmstock-catalogue' }
  | { kind: 'filmstock-unlocked' }
  | { kind: 'filmstock-asset'; key: string }
  | { kind: 'funding-status' }
  | { kind: 'treasury-status' }
  | { kind: 'fees' }
  | { kind: 'ops-status' }
  | { kind: 'ops-test-alert' }
  | { kind: 'ops-recompute-fees' }
  | { kind: 'ops-sweep-quick-mints' }
  | { kind: 'create-roll' }
  | { kind: 'open-roll' }
  | { kind: 'get-roll'; collection: string }
  | { kind: 'mint-frame'; collection: string }
  | { kind: 'authorize-roll'; collection: string }
  | { kind: 'complete-roll'; collection: string }
  | { kind: 'stage-quick' }
  | { kind: 'finalize-quick' }
  | { kind: 'release-quick'; stagingKey: string }
  | { kind: 'get-quick'; asset: string }
  | { kind: 'skr-quote' }
  | { kind: 'identity-skr' }
  | { kind: 'ops-dashboard-wallets' }
  | { kind: 'ops-dashboard-health' }
  | { kind: 'ops-dashboard-metrics' }

/** Match secret-requiring routes. Unknown paths 404 before env validation. */
function matchRoute(method: string, path: string): Route | null {
  if (method === 'GET' && path === '/v1/filmstocks') return { kind: 'filmstock-catalogue' }
  if (method === 'POST' && path === '/v1/filmstocks/unlocked') return { kind: 'filmstock-unlocked' }
  const filmstockAssetMatch = path.match(/^\/v1\/filmstocks\/assets\/(.+)$/)
  if (filmstockAssetMatch && method === 'GET') return { kind: 'filmstock-asset', key: filmstockAssetMatch[1] }
  if (method === 'GET' && path === '/funding/status') return { kind: 'funding-status' }
  if (method === 'GET' && path === '/treasury/status') return { kind: 'treasury-status' }
  if (method === 'GET' && path === '/fees') return { kind: 'fees' }
  if (method === 'GET' && path === '/ops/status') return { kind: 'ops-status' }
  if (method === 'GET' && path === '/ops/test-alert') return { kind: 'ops-test-alert' }
  if (method === 'GET' && path === '/ops/recompute-fees') return { kind: 'ops-recompute-fees' }
  if (method === 'GET' && path === '/ops/sweep-quick-mints') return { kind: 'ops-sweep-quick-mints' }
  if (method === 'POST' && path === '/rolls') return { kind: 'create-roll' }
  if (method === 'GET' && path === '/rolls/open') return { kind: 'open-roll' }
  if (method === 'POST' && path === '/quick/stage') return { kind: 'stage-quick' }
  if (method === 'POST' && path === '/quick/finalize') return { kind: 'finalize-quick' }
  if (method === 'POST' && path === '/skr/quote') return { kind: 'skr-quote' }
  if (method === 'GET' && path === '/identity/skr') return { kind: 'identity-skr' }
  if (method === 'GET' && path === '/ops/dashboard/wallets') return { kind: 'ops-dashboard-wallets' }
  if (method === 'GET' && path === '/ops/dashboard/health') return { kind: 'ops-dashboard-health' }
  if (method === 'GET' && path === '/ops/dashboard/metrics') return { kind: 'ops-dashboard-metrics' }
  // stagingKey is a uuid, not an address — matched before the base58 rule below.
  const releaseMatch = path.match(/^\/quick\/stage\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  if (releaseMatch && method === 'DELETE') return { kind: 'release-quick', stagingKey: releaseMatch[1] }
  const rollMatch = path.match(/^\/rolls\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/frames|\/authorize|\/complete)?$/)
  if (rollMatch) {
    const [, collection, suffix] = rollMatch
    if (!suffix && method === 'GET') return { kind: 'get-roll', collection }
    if (suffix === '/frames' && method === 'POST') return { kind: 'mint-frame', collection }
    if (suffix === '/authorize' && method === 'POST') return { kind: 'authorize-roll', collection }
    if (suffix === '/complete' && method === 'POST') return { kind: 'complete-roll', collection }
  }
  // Checked after the literals above; "stage"/"finalize" are too short to be
  // mistaken for a base58 address, but order makes that a fact, not a hope.
  const quickMatch = path.match(/^\/quick\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)
  if (quickMatch && method === 'GET') return { kind: 'get-quick', asset: quickMatch[1] }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    // Only the operator dashboard's data routes are ever called from a
    // browser — every other route here is app-to-worker, which CORS doesn't
    // apply to. Scoping CORS to this prefix keeps every other route's
    // response byte-for-byte unchanged.
    const isDashboardRoute = path.startsWith('/ops/dashboard/')
    if (isDashboardRoute && request.method === 'OPTIONS') {
      return dashboardCorsPreflight(env, request)
    }

    const response = await (async (): Promise<Response> => {
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

        // This guard runs before secret validation, request-body parsing,
        // storage, D1 mutation, queue sends or signer construction. It remains
        // effective even after valid production credentials are installed.
        if (isMaintenanceMode(env) && isHttpRouteBlockedByMaintenance(route.kind)) {
          return json(
            {
              error: 'Momints minting is temporarily paused for maintenance. No payment or image was accepted.',
              maintenance: true,
            },
            503,
            { 'cache-control': 'no-store', 'retry-after': String(MAINTENANCE_RETRY_AFTER_SECONDS) },
          )
        }

        if (route.kind === 'filmstock-catalogue') {
          const serverTime = new Date()
          return json(
            {
              serverTime: serverTime.toISOString(),
              catalogueUpdatedAt: FILMSTOCK_CATALOGUE_UPDATED_AT,
              filmstocks: FILMSTOCK_CATALOGUE.map((stock) => catalogueItem(stock, url)),
            },
            200,
            { 'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400' },
          )
        }
        if (route.kind === 'filmstock-asset') {
          const key = decodeURIComponent(route.key)
          if (key.includes('..') || key.startsWith('/')) throw new HttpError(400, 'Invalid filmstock asset path')
          const object = await env.FILMSTOCK_ASSETS.get(key)
          if (!object) throw new HttpError(404, 'Filmstock asset not found')
          const headers = new Headers()
          object.writeHttpMetadata(headers)
          headers.set('etag', object.httpEtag)
          headers.set('cache-control', 'public, max-age=31536000, immutable')
          return new Response(object.body, { headers })
        }

        // Fail fast, operator-facing, before any work: required secrets present
        // and not pointing at a public RPC (no public fallback exists).
        const ctx = new WorkerContext(validateEnv(env))

        switch (route.kind) {
          case 'filmstock-unlocked': {
            let body: { creatorAddress?: unknown }
            try {
              body = (await request.json()) as { creatorAddress?: unknown }
            } catch {
              throw new HttpError(400, 'Body must be JSON: { creatorAddress }')
            }
            if (typeof body.creatorAddress !== 'string') {
              throw new HttpError(400, 'creatorAddress must be a Solana wallet address')
            }
            const limit = await ctx.env.FILMSTOCK_UNLOCK_LIMITER.limit({ key: body.creatorAddress })
            if (!limit.success) throw new HttpError(429, 'Film cabinet refresh rate limit exceeded')
            const ids = await deriveUnlockedFilmStocks(
              ctx.env.SOLANA_RPC_URL,
              body.creatorAddress,
              getWorkerPublicKey(ctx.env),
            )
            return json({ creatorAddress: body.creatorAddress, unlockedFilmStockIds: ids }, 200, {
              'cache-control': 'private, no-store',
            })
          }
          case 'funding-status': {
            requireOpsAuth(ctx, request)
            const { funding } = await ctx.storageSeams()
            // Same single balance read the cron uses (ops/monitor.ts). Response
            // is the original FundingStatus plus the derived roll headroom.
            const snapshot = await readFundingSnapshot(funding)
            return json({
              ...snapshot.funding,
              balanceCredits: snapshot.balanceCredits,
              perRollCredits: snapshot.perRollCredits,
              rollsRemaining: snapshot.rollsRemaining,
              level: snapshot.level,
            })
          }
          case 'treasury-status':
            requireOpsAuth(ctx, request)
            return json(await ctx.treasury.status())
          case 'fees':
            return await handleGetFees(ctx)
          case 'ops-status':
            requireOpsAuth(ctx, request)
            return await handleOpsStatus(ctx)
          case 'ops-test-alert':
            requireOpsAuth(ctx, request)
            return await handleOpsTestAlert(ctx, url)
          case 'ops-recompute-fees':
            requireOpsAuth(ctx, request)
            return await handleOpsRecomputeFees(ctx)
          case 'ops-sweep-quick-mints':
            requireOpsAuth(ctx, request)
            return await handleOpsSweepQuickMints(ctx)
          case 'create-roll':
            return await handleCreateRoll(ctx, request)
          case 'open-roll':
            return await handleGetOpenRoll(ctx, url)
          case 'get-roll':
            return await handleGetRoll(ctx, request, route.collection)
          case 'mint-frame':
            return await handleMintFrame(ctx, request, route.collection)
          case 'authorize-roll':
            return await handleAuthorizeLegacyRoll(ctx, request, route.collection)
          case 'complete-roll':
            return await handleCompleteRoll(ctx, request, route.collection)
          case 'stage-quick':
            return await handleStageQuickMint(ctx, request)
          case 'finalize-quick':
            return await handleFinalizeQuickMint(ctx, request)
          case 'release-quick':
            return await handleReleaseQuickStage(ctx, route.stagingKey)
          case 'get-quick':
            return await handleGetQuickMint(ctx, route.asset)
          case 'skr-quote':
            return await handleSkrQuote(ctx, request)
          case 'identity-skr':
            return await handleIdentitySkr(ctx, url)
          case 'ops-dashboard-wallets':
            requireOpsAuth(ctx, request)
            return await handleOpsDashboardWallets(ctx)
          case 'ops-dashboard-health':
            requireOpsAuth(ctx, request)
            return await handleOpsDashboardHealth(ctx)
          case 'ops-dashboard-metrics':
            requireOpsAuth(ctx, request)
            return await handleOpsDashboardMetrics(ctx, url)
        }
      } catch (err) {
        if (err instanceof HttpError) {
          return json({ error: err.message }, err.status)
        }
        if (err instanceof ConfigError) {
          return json({ error: `Worker misconfigured: ${err.message}` }, 500)
        }
        if (err instanceof TurboFundingShortError) {
          // Same operator-facing shape as the ensureFunded() pre-check 503s —
          // this is the backstop for the balance moving between that check and
          // the upload itself. Never a user-facing bug; see turboClient.ts.
          return json({ error: `Storage funding: ${err.message}` }, 503)
        }
        console.error('[unhandled]', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
        return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
      }
    })()

    // CORS is a browser-side courtesy header, applied uniformly to success
    // AND error responses alike (a 401 from requireOpsAuth must still be
    // readable by the dashboard's own fetch(), or it shows as an opaque
    // network error instead of "wrong token"). requireOpsAuth() above is
    // what actually gates the data — this never widens access.
    return isDashboardRoute ? withDashboardCors(response, env, request) : response
  },

  /**
   * Quick-mint finalize consumer.
   *
   * Every message here is work the operator has ALREADY BEEN PAID FOR, so the
   * bias is the opposite of the fetch handler's: never drop a message. An
   * unexpected throw retries rather than acks, and only exhausting max_retries
   * moves it to the DLQ — where it becomes an operator alert, not a silent loss.
   */
  async queue(batch: MessageBatch<QuickFinalizeMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (isMaintenanceMode(env)) {
      // Never acknowledge paid work while paused. Delivery is also paused and
      // consumers are detached during cutover; this is defense in depth for a
      // stale/in-flight invocation.
      for (const message of batch.messages) {
        message.retry({ delaySeconds: MAINTENANCE_QUEUE_RETRY_SECONDS })
      }
      console.warn(`[maintenance] deferred ${batch.messages.length} queue message(s) from ${batch.queue}`)
      return
    }
    const ctx = new WorkerContext(validateEnv(env))
    const alert = discordAlerts(env)

    if (batch.queue.endsWith('-dlq')) {
      for (const message of batch.messages) {
        await handleDeadLetter(ctx, alert, message.body.quickMintId)
        message.ack()
      }
      return
    }

    for (const message of batch.messages) {
      const { quickMintId } = message.body
      try {
        const outcome = await finalizeQuickMintJob(
          {
            db: ctx.db,
            bucket: env.QUICK_STAGING,
            rpcUrl: ctx.env.SOLANA_RPC_URL,
            getUmi: () => createWorkerUmi(ctx.env),
            getSeams: () => ctx.storageSeams(),
            alert,
          },
          quickMintId,
        )
        if (outcome.kind === 'retry') {
          console.warn(`[quick] ${quickMintId} deferred: ${outcome.reason}`)
          message.retry({ delaySeconds: outcome.delaySeconds })
        } else {
          message.ack()
        }
      } catch (err) {
        console.error(`[quick] finalize ${quickMintId} failed:`, err instanceof Error ? err.message : String(err))
        message.retry()
      }
    }
  },

  /**
   * Cron entry — TWO independent schedules live in wrangler.toml [triggers],
   * dispatched here by `controller.cron`: the fee recompute (fees/compute.ts,
   * every 3h) and everything below it (treasury monitor + sweeps, every 6h).
   * They are deliberately separate cron STRINGS, not just separate try/catch
   * blocks within one run, per the feature spec — a stuck or slow fee
   * recompute must never delay the funding-alert/sweep cadence or vice versa.
   *
   * READ-AND-NOTIFY ONLY on the funding side. It reads the Turbo credit
   * balance and posts to Discord. It never funds, signs, or moves anything —
   * auto top-up would be the AutomatedFunding keeper, which deliberately does
   * not exist (providers/funding/automated.ts).
   *
   * NEVER THROWS. A scheduled handler that throws fails silently, so the
   * operator would lose monitoring at exactly the moment they need it. Errors
   * are logged (visible in `wrangler tail` / Workers logs) and the next run
   * retries.
   *
   * The jobs below the fee-recompute branch are isolated from EACH OTHER too:
   * a monitor failure must not skip the sweeps, because the quick-mint sweep
   * re-drives paid mints whose finalize job was never enqueued, and the
   * roll-handoff sweep retries revokes that failed at completion time.
   */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (isMaintenanceMode(env)) {
      console.warn(`[maintenance] skipped scheduled run ${controller.cron}`)
      return
    }
    let ctx: WorkerContext
    try {
      ctx = new WorkerContext(validateEnv(env))
    } catch (err) {
      console.error(
        `[ops] scheduled run (${controller.cron}) could not start:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
      return
    }

    // Must match wrangler.toml [triggers] crons exactly — that array is the
    // source of truth; this string only decides which job an already-fired
    // cron runs.
    if (controller.cron === FEE_RECOMPUTE_CRON) {
      try {
        const turbo = buildTurboClient(ctx.env)
        const result = await runFeeRecompute({ env: ctx.env, cache: ctx.feeCache, turbo })
        console.log(`[fees] cron ${controller.cron} · recompute ${result.ok ? 'ok' : 'FAILED'} — ${result.note}`)
        for (const note of result.alertNotes) {
          console.log(`[fees] cron ${controller.cron} · ${note}`)
        }
      } catch (err) {
        console.error(
          `[fees] recompute (${controller.cron}) failed:`,
          err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
        )
      }
      return
    }

    try {
      const { checks } = await runTreasuryMonitor({
        env: ctx.env,
        alerts: ctx.opsAlerts,
        getFunding: async () => (await ctx.storageSeams()).funding,
      })
      for (const check of checks) {
        console.log(`[ops] cron ${controller.cron} · ${check.key}: ${check.ok ? 'ok' : 'FAILED'} — ${check.note}`)
      }
    } catch (err) {
      console.error(
        `[ops] treasury monitor (${controller.cron}) failed:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
    }

    try {
      const result = await sweepQuickMints({ db: ctx.db, bucket: env.QUICK_STAGING, queue: env.QUICK_FINALIZE })
      console.log(
        `[quick:sweep] reaped ${result.orphansReaped} orphaned stage(s), re-drove ${result.stalledRedriven} stalled finalize(s)`,
      )
    } catch (err) {
      console.error(
        `[quick:sweep] scheduled run (${controller.cron}) failed:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
    }

    // Deferred finalizes (verify said "not visible to the RPC yet") — a
    // SEPARATE try/catch from the sweep above, deliberately: this is the
    // recovery path for the real incident that motivated it, so a failure
    // here must never silently suppress the orphan/stalled sweep or vice
    // versa. Needs the quick-mint env (placeholder URI, treasury address) —
    // caught and logged rather than thrown, so a half-configured quick flow
    // never takes the rest of this cron run down with it.
    try {
      const quickEnv = validateQuickEnv(ctx.env)
      const result = await redriveDeferredFinalizes({
        db: ctx.db,
        queue: env.QUICK_FINALIZE,
        treasury: ctx.treasury,
        rpcUrl: ctx.env.SOLANA_RPC_URL,
        placeholderUri: quickEnv.QUICK_PLACEHOLDER_URI,
        treasuryAddress: quickEnv.QUICK_TREASURY_ADDRESS,
        getUmi: () => createWorkerUmi(ctx.env),
        alert: discordAlerts(env),
      })
      console.log(
        `[quick:sweep] deferred finalizes — attempted ${result.attempted}, completed ${result.completed}, ` +
          `still deferred ${result.stillDeferred}, gave up ${result.gaveUp}`,
      )
    } catch (err) {
      console.error(
        `[quick:sweep] deferred-finalize redrive (${controller.cron}) failed:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
    }

    // Backstop for the synchronous revoke calls in handleCompleteRoll and
    // mintFrame: retries any COMPLETE roll whose delegate revoke never landed.
    // Per-roll, not per-batch — one stuck roll must not block the rest.
    try {
      const stalled = await ctx.db.listStalledRollHandoffs(50)
      let revoked = 0
      for (const roll of stalled) {
        try {
          await revokeRollDelegate(
            { db: ctx.db, rpcUrl: ctx.env.SOLANA_RPC_URL, getUmi: () => createWorkerUmi(ctx.env) },
            roll,
          )
          revoked++
        } catch (err) {
          console.error(
            `[handoff:sweep] revoke failed for ${roll.collection_address}:`,
            err instanceof Error ? err.message : String(err),
          )
        }
      }
      console.log(`[handoff:sweep] revoked ${revoked}/${stalled.length} stalled roll delegate(s)`)
    } catch (err) {
      console.error(
        `[handoff:sweep] scheduled run (${controller.cron}) failed:`,
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      )
    }
  },
}

/** Bind the consumer's injected alert seam to the ops notification primitive. */
function discordAlerts(env: Env): AlertFn {
  return async (alert) => {
    await postDiscordAlert(env, alert)
  }
}

/**
 * A dead-lettered finalize means a PAID mint is stuck on the placeholder.
 * Recoverable by definition — the fee was collected and the asset exists — so
 * the row is marked DEAD for triage rather than deleted, and the operator is
 * pinged.
 */
async function handleDeadLetter(ctx: WorkerContext, alert: AlertFn, quickMintId: string): Promise<void> {
  const row = await ctx.db.getQuickMint(quickMintId).catch(() => null)
  await ctx.db.markQuickMintDead(quickMintId).catch((err) => {
    console.error(`[quick] could not mark ${quickMintId} DEAD:`, err)
  })
  await alert({
    severity: 'critical',
    title: 'Quick mint stuck on placeholder',
    description:
      'A paid quick mint exhausted its finalize retries. The fee was collected and the asset is minted, so this ' +
      'is recoverable: fix the underlying failure, then re-drive it by sending { quickMintId } to ' +
      'momints-quick-finalize (README runbook).',
    fields: [
      { name: 'Quick mint', value: quickMintId },
      { name: 'Asset', value: row?.asset_address ?? 'unknown' },
      { name: 'Wallet', value: row?.wallet ?? 'unknown' },
      { name: 'Image uploaded', value: row?.image_uri ? 'yes' : 'no' },
      { name: 'Metadata uploaded', value: row?.arweave_uri ? 'yes' : 'no' },
    ],
    mention: true,
  })
}

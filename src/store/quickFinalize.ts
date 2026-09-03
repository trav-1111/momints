import { Paths, File } from 'expo-file-system'
import { finalizeQuickMint } from '../services/quickMintApi'
import { RollApiError } from '../services/rollApi'

/**
 * Pending quick-mint finalizes, persisted across app launches.
 *
 * This closes the one hole the Worker cannot cover on its own. A quick mint is
 * paid the moment the user's transaction lands, but the Worker does not learn
 * about it until POST /quick/finalize — and that call is made by the app. Kill
 * the app in between and the fee is collected, the asset is live on the
 * placeholder, and nobody is left to say so.
 *
 * mintQueue.ts persists only *history*, not in-flight work, so it cannot serve
 * this purpose. An entry is written the instant a signature exists (before the
 * transaction is even sent) and removed only once the Worker has definitively
 * accepted or refused it.
 */

const STORAGE_KEY = 'quick-finalize'

export interface PendingFinalize {
  stagingKey: string
  signature: string
  assetAddress: string
  /**
   * The mint queue photoId this entry is for — the correlator checkPriorAttempt
   * uses to find "did THIS photo already get signed" across a retry, which
   * always starts a brand-new stagingKey and has no other way to know.
   * Optional: entries written by an app build before this field existed won't
   * have it. They stay in the queue and drainPendingFinalizes() still retries
   * them by stagingKey exactly as before — they just can't be found by
   * checkPriorAttempt, which only helps for mints signed after this update.
   */
  photoId?: string
  createdAt: number
  attempts: number
}

/**
 * A runaway list would mean re-POSTing forever. Entries only survive
 * indefinite/transient failures, so this cap is a backstop, not a normal path.
 */
const MAX_PENDING = 200

let cache: PendingFinalize[] | null = null
let writing: Promise<void> = Promise.resolve()

function file(): File {
  return new File(Paths.document, `${STORAGE_KEY}.json`)
}

function parse(raw: unknown): PendingFinalize[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is PendingFinalize =>
      e !== null &&
      typeof e === 'object' &&
      typeof e.stagingKey === 'string' &&
      typeof e.signature === 'string' &&
      typeof e.assetAddress === 'string' &&
      // photoId is optional (see the interface doc) — entries from before it
      // existed are kept, just unreachable by checkPriorAttempt.
      (e.photoId === undefined || typeof e.photoId === 'string'),
  )
}

async function load(): Promise<PendingFinalize[]> {
  if (cache) return cache
  try {
    const f = file()
    cache = f.exists ? parse(JSON.parse(await f.text())) : []
  } catch {
    cache = []
  }
  return cache
}

/** Serialized so concurrent chunk items cannot interleave read-modify-write. */
function persist(next: PendingFinalize[]): Promise<void> {
  cache = next
  writing = writing.then(async () => {
    try {
      file().write(JSON.stringify(next))
    } catch {
      // Non-critical: the in-memory copy still drains this session.
    }
  })
  return writing
}

/**
 * Remember a mint that has been signed but not yet finalized.
 *
 * Called as soon as the signature exists — deliberately BEFORE the transaction
 * is sent, because the confirm wait is the longest window in which the app can
 * die holding a paid mint nobody knows about. A recorded entry for a
 * transaction that never landed is harmless: finalize refuses it and it is
 * dropped.
 *
 * NEVER REJECTS, even though the call site (useMint.ts's onItemSigned) now
 * awaits this — awaiting is there to guarantee the write has actually
 * happened before the transaction that spends the fee is sent, not to let a
 * failure here propagate. Failing to persist is bad — it costs the
 * crash-safety net for this one mint — but it must not also break the mint
 * that is currently succeeding.
 */
export async function recordPendingFinalize(
  entry: Omit<PendingFinalize, 'createdAt' | 'attempts'>,
): Promise<void> {
  try {
    const pending = await load()
    if (pending.some((e) => e.stagingKey === entry.stagingKey)) return
    const next = [...pending, { ...entry, createdAt: Date.now(), attempts: 0 }].slice(-MAX_PENDING)
    await persist(next)
  } catch (err) {
    console.warn(`[quickFinalize] could not record ${entry.assetAddress}:`, err)
  }
}

/** NEVER REJECTS, for the same reason as recordPendingFinalize. */
export async function clearPendingFinalize(stagingKey: string): Promise<void> {
  try {
    const pending = await load()
    const next = pending.filter((e) => e.stagingKey !== stagingKey)
    if (next.length !== pending.length) await persist(next)
  } catch (err) {
    console.warn(`[quickFinalize] could not clear ${stagingKey}:`, err)
  }
}

export async function countPendingFinalizes(): Promise<number> {
  return (await load()).length
}

/**
 * A failure is only worth retrying if it left the mint finalizable.
 *
 * 402 (fee not verifiable), 404 (the stage was reaped) and 409 (this payment
 * already bought a different upload) are the Worker's definitive answers —
 * re-POSTing them forever would never change the outcome. Everything else,
 * including the 503/504 that `resumable` covers, is worth another pass.
 */
function isDefinitive(err: unknown): boolean {
  return err instanceof RollApiError && (err.status === 402 || err.status === 404 || err.status === 409)
}

export interface DrainResult {
  finalized: number
  stillPending: number
}

/**
 * Retry every pending finalize. Safe to call as often as you like: finalize is
 * idempotent by stagingKey, so a duplicate call returns the in-flight state
 * rather than paying twice.
 */
export async function drainPendingFinalizes(): Promise<DrainResult> {
  const pending = await load()
  if (pending.length === 0) return { finalized: 0, stillPending: 0 }

  const survivors: PendingFinalize[] = []
  let finalized = 0

  for (const entry of pending) {
    try {
      await finalizeQuickMint({
        stagingKey: entry.stagingKey,
        signature: entry.signature,
        assetAddress: entry.assetAddress,
      })
      finalized++
    } catch (err) {
      if (isDefinitive(err)) {
        // Nothing more this app can do; keeping it would just re-POST forever.
        console.warn(`[quickFinalize] dropping ${entry.assetAddress}: ${err instanceof Error ? err.message : err}`)
        continue
      }
      survivors.push({ ...entry, attempts: entry.attempts + 1 })
    }
  }

  await persist(survivors)
  return { finalized, stillPending: survivors.length }
}

/**
 * Solana blockhash validity is ~150 slots (~60-90s at typical slot times).
 * Comfortably past that, a still-unresolved signature can never land — its
 * blockhash has expired, so a NEW mint attempt is safe again. Short of that,
 * it may yet land, so checkPriorAttempt refuses to let a fresh mint proceed.
 */
const RECOVERY_WINDOW_MS = 3 * 60 * 1000

export type PriorAttemptCheck =
  | { action: 'none' }
  | { action: 'resolved'; signature: string; assetAddress: string }
  | { action: 'wait' }
  | { action: 'clear' }

/**
 * Before minting a quick shot — first attempt OR a retry — check whether a
 * PRIOR attempt for this exact photo already got as far as a signature. A
 * "failed" item in the UI is not proof nothing happened: a client-side
 * confirmation timeout looks identical to a genuine failure, but the
 * transaction may have already landed and been paid for. Minting again
 * without checking would be a second, real, paid asset for the same photo.
 *
 * Resolves against the chain — the same authoritative read finalize itself
 * uses — rather than trusting the client's own "it failed" view:
 *   - no prior entry: `none`, a fresh mint is exactly as safe as it always was.
 *   - finalize succeeds: `resolved` — the prior attempt landed and is now
 *     finalizing; report it as the successful mint it always was, don't mint again.
 *   - finalize definitively rejects it, or the recovery window has passed
 *     with no resolution: `clear` — the prior attempt is confirmed dead (or
 *     someone else already resolved it), a fresh mint is safe.
 *   - finalize says "not visible yet" and we're still inside the recovery
 *     window: `wait` — it may still land; do not mint again yet.
 */
export async function checkPriorAttempt(photoId: string): Promise<PriorAttemptCheck> {
  const pending = await load()
  const entry = pending.find((e) => e.photoId === photoId)
  if (!entry) return { action: 'none' }

  try {
    await finalizeQuickMint({
      stagingKey: entry.stagingKey,
      signature: entry.signature,
      assetAddress: entry.assetAddress,
    })
    await clearPendingFinalize(entry.stagingKey)
    return { action: 'resolved', signature: entry.signature, assetAddress: entry.assetAddress }
  } catch (err) {
    if (isDefinitive(err) || Date.now() - entry.createdAt >= RECOVERY_WINDOW_MS) {
      await clearPendingFinalize(entry.stagingKey)
      return { action: 'clear' }
    }
    return { action: 'wait' }
  }
}

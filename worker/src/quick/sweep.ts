import type { Umi } from '@metaplex-foundation/umi'
import type { RollDb } from '../db'
import type { QuickFinalizeMessage } from '../env'
import type { TreasurySink } from '../providers/types'
import type { AlertFn } from './consumer'
import { finalizeQuickMint } from './finalize'

export interface QuickSweepDeps {
  db: RollDb
  bucket: R2Bucket
  queue: Queue<QuickFinalizeMessage>
}

export interface QuickSweepResult {
  orphansReaped: number
  stalledRedriven: number
}

/** Abandoned stages are worthless after a day, and the bucket agrees (lifecycle rule). */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Deliberately generous. A row's created_at is its STAGE time, not its claim
 * time, so a job that is simply slow — a funding stall retries on a 15-minute
 * delay — must not be re-driven underneath itself. Re-driving is harmless when
 * it does happen (the consumer is idempotent), just wasteful.
 */
const STALLED_AGE_MS = 60 * 60 * 1000

// Worth knowing when reading the two together: the cron runs every 6h
// (wrangler.toml [triggers]), so this threshold is a floor, not a promise — a
// stall can sit for up to a cron period. That is fine, because the queue's own
// retries cover ordinary failures; this only catches the rarer case where the
// enqueue never happened, so the job was never in the queue to retry.

const BATCH_LIMIT = 100

/**
 * Housekeeping for the two ways a quick mint can fall out of the happy path.
 *
 * Orphans (STAGED, never minted) are pure housekeeping: nothing was paid, and
 * nothing reached Arweave. Stalls (FINALIZING, never finished) are the opposite
 * — the fee is collected and the asset is live on the placeholder — so they are
 * re-driven, not reaped. That asymmetry is the whole point of the sweep: it is
 * the backstop for a queue message that was never sent (the enqueue itself
 * failed) or was lost.
 */
export async function sweepQuickMints(deps: QuickSweepDeps): Promise<QuickSweepResult> {
  const { db, bucket, queue } = deps
  const now = Date.now()

  const orphans = await db.listStaleStagedQuickMints(new Date(now - ORPHAN_AGE_MS).toISOString(), BATCH_LIMIT)
  for (const orphan of orphans) {
    if (orphan.staging_key) {
      await bucket.delete(orphan.staging_key).catch((err: unknown) => {
        console.warn(`[quick:sweep] could not delete ${orphan.staging_key}:`, err)
      })
    }
    // Restricted to STAGED in SQL, so this can never delete a paid mint.
    await db.deleteStagedQuickMint(orphan.id)
  }

  const stalled = await db.listStalledFinalizingQuickMints(new Date(now - STALLED_AGE_MS).toISOString(), BATCH_LIMIT)
  for (const job of stalled) {
    console.warn(`[quick:sweep] re-driving stalled finalize ${job.id} (asset ${job.asset_address ?? '?'})`)
    await queue.send({ quickMintId: job.id })
  }

  return { orphansReaped: orphans.length, stalledRedriven: stalled.length }
}

export interface DeferredFinalizeSweepDeps {
  db: RollDb
  queue: Queue<QuickFinalizeMessage>
  treasury: TreasurySink
  rpcUrl: string
  placeholderUri: string
  treasuryAddress: string
  getUmi: () => Promise<Umi>
  alert: AlertFn
}

export interface DeferredFinalizeSweepResult {
  attempted: number
  completed: number
  stillDeferred: number
  gaveUp: number
}

/**
 * A row can only be found here once recordFinalizeAttempt has run — before
 * that (an app that never even reached this Worker) there is genuinely
 * nothing server-side to recover from; see listStaleStagedQuickMints for that
 * case instead. A candidate must be at least this old before this sweep
 * touches it, so it never races a finalize call still in flight from the
 * request that just wrote the signature.
 */
const DEFERRED_RETRY_AFTER_MS = 2 * 60 * 1000

/**
 * Past this, automatic retry stops and the row is handed to the operator
 * instead. A day is the same "something is genuinely wrong, not just slow"
 * bar the rest of this file already uses for orphaned stages — ordinary RPC
 * propagation lag (the normal reason a finalize defers) resolves in seconds,
 * not hours, so a row still stuck here this long warrants a look rather than
 * an indefinite retry loop.
 */
const DEFERRED_GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Re-attempt finalizes that DEFERRED (verify said "transaction not visible to
 * the RPC yet" — a normal, frequent event, never a failure) and never got a
 * chance to complete, independent of whether the client that signed them ever
 * calls back. This is what makes recordFinalizeAttempt's persisted signature
 * actually useful rather than just informational — without this sweep, a
 * deferred finalize would still be recoverable in principle but nothing would
 * ever actually retry it if the client didn't.
 *
 * Each candidate just gets a normal finalizeQuickMint call — the exact same
 * path a client retry or the background drain would take, fully idempotent
 * and safe to race against either. A row past the give-up window is handed to
 * the operator instead of retried forever.
 */
export async function redriveDeferredFinalizes(deps: DeferredFinalizeSweepDeps): Promise<DeferredFinalizeSweepResult> {
  const { db, queue, treasury, rpcUrl, placeholderUri, treasuryAddress, getUmi, alert } = deps
  const now = Date.now()

  const candidates = await db.listDeferredFinalizeQuickMints(
    new Date(now - DEFERRED_RETRY_AFTER_MS).toISOString(),
    BATCH_LIMIT,
  )

  let completed = 0
  let stillDeferred = 0
  let gaveUp = 0

  for (const row of candidates) {
    if (!row.signature || !row.asset_address) continue // listDeferredFinalizeQuickMints guarantees this; guard for the type only.

    const ageMs = now - new Date(row.created_at).getTime()
    if (ageMs >= DEFERRED_GIVE_UP_AFTER_MS) {
      await db.markQuickMintDead(row.id)
      await alert({
        severity: 'critical',
        title: 'Quick mint finalize stuck deferred for 24h+ — needs operator review',
        description:
          "A quick mint's finalize kept deferring (the RPC could not see the transaction) for over 24 hours and " +
          'has been marked DEAD rather than retried forever. This could mean the transaction never actually ' +
          'landed (a genuine failure) or a persistent RPC issue — check the signature on Solscan before assuming ' +
          'either.',
        fields: [
          { name: 'Quick mint', value: row.id },
          { name: 'Asset', value: row.asset_address },
          { name: 'Signature', value: row.signature },
          { name: 'Wallet', value: row.wallet },
        ],
        mention: true,
      })
      gaveUp++
      continue
    }

    try {
      await finalizeQuickMint(
        { db, queue, treasury, rpcUrl, placeholderUri, treasuryAddress, getUmi, alert },
        { stagingKey: row.id, signature: row.signature, assetAddress: row.asset_address },
      )
      completed++
    } catch (err) {
      // Still deferred (retryable — most common), or just became DEAD via
      // finalizeQuickMint's own 402 path (which already alerted). Either way,
      // nothing more to do for this row this cycle.
      stillDeferred++
      console.warn(
        `[quick:sweep] deferred finalize ${row.id} still unresolved:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return { attempted: candidates.length, completed, stillDeferred, gaveUp }
}

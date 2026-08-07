import type { RollDb } from '../db'
import type { QuickFinalizeMessage } from '../env'

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

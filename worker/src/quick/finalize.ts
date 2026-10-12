import { publicKey, type Umi } from '@metaplex-foundation/umi'
import { DuplicateSignatureError, type QuickMintRow, type RollDb } from '../db'
import type { QuickFinalizeMessage } from '../env'
import { isBase58Address } from '../lib/address'
import { HttpError } from '../lib/http'
import type { AlertFn } from './consumer'
import type { TreasurySink } from '../providers/types'
import { deriveAta } from '../skr/ata'
import { SKR_MINT_ADDRESS } from '../skr/config'
import { verifyQuickMintPayment } from './verify'
import { preserveQuickAttempt } from './preserve'

/**
 * Fallback for quick_mints rows STAGED before migrations/0007_fee_cache.sql
 * added fee_lamports_required — those rows have NULL there. Such a row can
 * only exist in the narrow window right after this feature deploys, and is
 * expected to finalize (or die) within minutes; this is not a live fee, just
 * what the flat fee was immediately before the cost-plus swap.
 */
export const LEGACY_QUICK_FEE_LAMPORTS_FALLBACK = 6_500_000

export interface FinalizeQuickMintRequest {
  stagingKey: string
  signature: string
  assetAddress: string
}

export interface FinalizeQuickMintDeps {
  db: RollDb
  bucket: R2Bucket
  queue: Queue<QuickFinalizeMessage>
  treasury: TreasurySink
  rpcUrl: string
  placeholderUri: string
  treasuryAddress: string
  /** Lazy: the idempotent replay path and all validation are pure-D1. */
  getUmi: () => Promise<Umi>
  /** Fires when verify definitively rejects an already-landed transaction — see the 402 branch below. */
  alert: AlertFn
}

export interface FinalizeQuickMintResult {
  stagingKey: string
  assetAddress: string
  signature: string
  status: 'FINALIZING' | 'FINALIZED' | 'DEAD'
  /** The permanent metadata URI, once the consumer has uploaded it. */
  metadataUri: string | null
  imageUri: string | null
  mime: string
  byteLength: number | null
  width: number | null
  height: number | null
  imageHash: string | null
  /** True when this request found work already in flight or done. */
  alreadyFinalizing: boolean
}

function describe(row: QuickMintRow, alreadyFinalizing: boolean): FinalizeQuickMintResult {
  return {
    stagingKey: row.id,
    assetAddress: row.asset_address ?? '',
    signature: row.signature ?? '',
    status: row.status === 'STAGED' ? 'FINALIZING' : row.status,
    metadataUri: row.arweave_uri,
    imageUri: row.image_uri,
    mime: row.mime,
    byteLength: row.byte_length,
    width: row.width,
    height: row.height,
    imageHash: row.image_hash,
    alreadyFinalizing,
  }
}

/**
 * Turn a staged image into paid, queued work — the one place where "the user
 * says they paid" becomes "the Worker knows they paid".
 *
 * Everything before the claim is free and reversible. Everything after it
 * commits the operator to an Arweave spend. So the ordering is load-bearing:
 * verify against the chain, THEN claim the row (atomically, so a race or a
 * replayed signature cannot enqueue twice), THEN record the fee, THEN enqueue.
 *
 * The user has already signed and paid by the time this runs, which is why
 * failures are split so carefully. A definitive rejection marks the row DEAD
 * and alerts — never deletes it (see the 402 branch below: by that point a
 * REAL landed transaction has been read off the chain, so "verify rejected
 * it" is not the same fact as "nothing was paid"); a transient one leaves it
 * completely untouched so the app can retry into the same idempotent path.
 */
export async function finalizeQuickMint(
  deps: FinalizeQuickMintDeps,
  req: FinalizeQuickMintRequest,
): Promise<FinalizeQuickMintResult> {
  const { db, queue, treasury, rpcUrl, placeholderUri, treasuryAddress, getUmi, alert } = deps

  if (!isBase58Address(req.assetAddress)) {
    throw new HttpError(400, 'assetAddress must be a base58 Solana address')
  }
  if (typeof req.signature !== 'string' || req.signature.length < 64) {
    throw new HttpError(400, 'signature must be a base58 transaction signature')
  }

  const row = await db.getQuickMint(req.stagingKey)
  if (!row) {
    throw new HttpError(404, `No staged quick mint ${req.stagingKey}. Stage the image again before minting.`)
  }

  // ---- Replay: the work is already claimed. Cheap, pure-D1, never re-verifies. ----
  if (row.status !== 'STAGED') {
    if (row.signature && row.signature !== req.signature) {
      throw new HttpError(
        409,
        `Staged quick mint ${row.id} was already finalized with transaction ${row.signature}. ` +
          'Stage a new image rather than reusing this one.',
      )
    }
    return describe(row, true)
  }

  // ---- Record the attempt BEFORE verify, so even a DEFERRED finalize (verify
  // says "not visible yet" below — a normal, frequent event) leaves this row
  // discoverable server-side. See recordFinalizeAttempt's doc: this is what a
  // real incident was missing — a deferral used to leave signature/asset_address
  // NULL forever, recoverable only if the calling client itself came back. ----
  if (
    (row.signature && row.signature !== req.signature) ||
    (row.asset_address && row.asset_address !== req.assetAddress)
  )
    throw new HttpError(409, 'This image already has a different signed attempt. Recover its original receipt.')
  try {
    await db.recordFinalizeAttempt(row.id, req.assetAddress, req.signature)
  } catch (err) {
    if (err instanceof DuplicateSignatureError) {
      throw new HttpError(
        409,
        `Transaction ${req.signature} has already paid for a different quick mint. ` + 'One payment buys one upload.',
      )
    }
    throw err
  }

  // ---- Verify the LANDED transaction. Nothing below trusts the request body. ----
  const requiredLamports = row.fee_lamports_required ?? LEGACY_QUICK_FEE_LAMPORTS_FALLBACK
  const umi = await getUmi()
  const verdict = await verifyQuickMintPayment(umi, rpcUrl, {
    signature: req.signature,
    assetAddress: req.assetAddress,
    wallet: row.wallet,
    treasury: treasuryAddress,
    placeholderUri,
    requiredLamports,
    expectedStagingKey: row.id,
    // Set by POST /skr/quote (recordQuickSkrQuote) the moment a quote is
    // issued — a row's OWN fee_currency, not the request body, decides which
    // branch verify takes, so a client can never claim a different currency
    // than what was actually quoted for this exact row.
    skr:
      row.fee_currency === 'SKR'
        ? {
            treasurySkrAta: deriveAta(umi, publicKey(treasuryAddress), publicKey(SKR_MINT_ADDRESS)).toString(),
            requiredAtomic: row.skr_quote_atomic ?? 0,
            quoteExpiresAt: row.skr_quote_expires_at,
          }
        : undefined,
  })

  if (!verdict.ok) {
    await db.recordQuickVerification(
      row.id,
      verdict.retryable ? 'UNKNOWN' : 'REJECTED',
      verdict.retryable ? 'RPC_PENDING' : 'VERIFICATION_REJECTED',
    )
    if (verdict.retryable) {
      // Deliberately leaves the stage intact: the mint may well be valid and
      // simply not visible yet, and tearing it down would strand a paid mint.
      throw new HttpError(503, `${verdict.reason}. Retry this finalize — nothing has been changed.`)
    }
    // NOT a delete. verifyQuickMintPayment only reaches a definitive verdict
    // after reading a transaction that actually LANDED — the rejection is
    // about one specific check (fee amount, URI, owner, authority...), not
    // proof nothing happened. Deleting here was the bug behind a real
    // incident: a rejected-but-landed mint left no trace anywhere, no alert,
    // nothing to investigate. Mark DEAD and alert instead — same shape as the
    // consumer's dead-letter path (handleDeadLetter in index.ts) — so this is
    // always operator-visible. The staged image in R2 is deliberately left in
    // place too (recoverable until the bucket's 24h lifecycle rule reaps it —
    // see the alert's own note on that window).
    await db.markQuickMintDead(row.id, { assetAddress: req.assetAddress, signature: req.signature })
    await alert({
      severity: 'critical',
      title: 'Quick mint finalize REJECTED — needs operator review',
      description:
        'A quick-mint finalize was definitively rejected, but verify only reaches that verdict after reading a ' +
        'transaction that already landed on-chain — this may be a real paid mint, not a bogus attempt. Marked ' +
        'DEAD rather than deleted so it can be investigated. The staged image in R2 is preserved but expires ' +
        "under the bucket's 24h lifecycle rule — recover it soon if the image is needed.",
      fields: [
        { name: 'Quick mint', value: row.id },
        { name: 'Asset', value: req.assetAddress },
        { name: 'Wallet', value: row.wallet },
        { name: 'Signature', value: req.signature },
        { name: 'Rejection reason', value: verdict.reason.slice(0, 1000) },
      ],
      mention: true,
    })
    throw new HttpError(402, `Quick mint refused: ${verdict.reason}`)
  }

  await db.recordQuickVerification(row.id, 'CONFIRMED', null)
  // Only a verified payment may buy retention outside the public staging
  // quota/lifecycle. A forged signature must not create unbounded R2 storage.
  await preserveQuickAttempt(db, deps.bucket, row)

  // ---- Claim: the single transition from "free" to "we owe an upload". ----
  let claimed: boolean
  try {
    claimed = await db.claimQuickMintForFinalize(row.id, req.assetAddress, req.signature)
  } catch (err) {
    if (err instanceof DuplicateSignatureError) {
      throw new HttpError(
        409,
        `Transaction ${req.signature} has already paid for a different quick mint. ` + 'One payment buys one upload.',
      )
    }
    throw err
  }

  if (!claimed) {
    // A concurrent finalize won the row. Report its state instead of failing —
    // the user's mint is being handled either way.
    const current = await db.getQuickMint(row.id)
    if (current) return describe(current, true)
    throw new HttpError(503, `Staged quick mint ${row.id} changed underneath this request — retry.`)
  }

  // treasury_entries tracks SOL that needs manual -> $SKR conversion
  // (ManualSink's doc comment); a $SKR payment needs no conversion, the
  // treasury already holds the target currency the instant it lands, so
  // there is nothing to record here. quick_mints.fee_currency/
  // skr_quote_atomic (already written by POST /skr/quote) are themselves the
  // full audit trail for $SKR revenue — see README "Pay with $SKR".
  if (row.fee_currency !== 'SKR') {
    await treasury.record(requiredLamports, {
      kind: 'quick_mint_fee',
      asset: req.assetAddress,
      wallet: row.wallet,
      signature: req.signature,
    })
  }

  // A send failure here leaves a FINALIZING row with no message. The scheduled
  // sweep re-drives stalled FINALIZING rows, so the work is not lost — surface
  // it as resumable rather than pretending the queue accepted it.
  try {
    await queue.send({ quickMintId: row.id })
  } catch (err) {
    throw new HttpError(
      503,
      `Fee verified and recorded, but the finalize job could not be enqueued ` +
        `(${err instanceof Error ? err.message : String(err)}). The mint is safe: retry, or the scheduled ` +
        'sweep will pick it up.',
    )
  }

  return {
    stagingKey: row.id,
    assetAddress: req.assetAddress,
    signature: req.signature,
    status: 'FINALIZING',
    metadataUri: null,
    imageUri: null,
    mime: row.mime,
    byteLength: row.byte_length,
    width: row.width,
    height: row.height,
    imageHash: row.image_hash,
    alreadyFinalizing: false,
  }
}

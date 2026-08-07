import type { Umi } from '@metaplex-foundation/umi'
import { DuplicateSignatureError, type QuickMintRow, type RollDb } from '../db'
import type { QuickFinalizeMessage } from '../env'
import { isBase58Address } from '../lib/address'
import { HttpError } from '../lib/http'
import type { TreasurySink } from '../providers/types'
import { QUICK_MINT_FEE_LAMPORTS } from './config'
import { verifyQuickMintPayment } from './verify'

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
}

export interface FinalizeQuickMintResult {
  stagingKey: string
  assetAddress: string
  signature: string
  status: 'FINALIZING' | 'FINALIZED' | 'DEAD'
  /** The permanent metadata URI, once the consumer has uploaded it. */
  metadataUri: string | null
  imageUri: string | null
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
 * failures are split so carefully. A definitive rejection tears the stage down;
 * a transient one leaves it completely untouched so the app can retry into the
 * same idempotent path.
 */
export async function finalizeQuickMint(
  deps: FinalizeQuickMintDeps,
  req: FinalizeQuickMintRequest,
): Promise<FinalizeQuickMintResult> {
  const { db, bucket, queue, treasury, rpcUrl, placeholderUri, treasuryAddress, getUmi } = deps

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

  // ---- Verify the LANDED transaction. Nothing below trusts the request body. ----
  const umi = await getUmi()
  const verdict = await verifyQuickMintPayment(umi, rpcUrl, {
    signature: req.signature,
    assetAddress: req.assetAddress,
    wallet: row.wallet,
    treasury: treasuryAddress,
    placeholderUri,
  })

  if (!verdict.ok) {
    if (verdict.retryable) {
      // Deliberately leaves the stage intact: the mint may well be valid and
      // simply not visible yet, and tearing it down would strand a paid mint.
      throw new HttpError(503, `${verdict.reason}. Retry this finalize — nothing has been changed.`)
    }
    await bucket.delete(row.staging_key ?? '').catch(() => {})
    await db.deleteStagedQuickMint(row.id)
    throw new HttpError(402, `Quick mint refused: ${verdict.reason}`)
  }

  // ---- Claim: the single transition from "free" to "we owe an upload". ----
  let claimed: boolean
  try {
    claimed = await db.claimQuickMintForFinalize(row.id, req.assetAddress, req.signature)
  } catch (err) {
    if (err instanceof DuplicateSignatureError) {
      throw new HttpError(
        409,
        `Transaction ${req.signature} has already paid for a different quick mint. ` +
          'One payment buys one upload.',
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

  await treasury.record(QUICK_MINT_FEE_LAMPORTS, {
    kind: 'quick_mint_fee',
    asset: req.assetAddress,
    wallet: row.wallet,
    signature: req.signature,
  })

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
    alreadyFinalizing: false,
  }
}

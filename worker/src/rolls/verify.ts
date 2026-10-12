import { extractTransactionMemos, getTransaction, type ParsedTransaction } from '../solana/confirm'
import { checkSkrTransfer } from '../skr/verify'
import type { RollSize } from './config'

/**
 * Proof that a roll was paid for.
 *
 * Unlike a quick mint, a roll's on-chain collection does not exist yet at
 * payment time — the Worker creates it AFTER this passes. So there is no
 * "asset created in the same transaction" binding to lean on; replay
 * protection instead comes from the UNIQUE index on rolls.fee_signature
 * (migrations/0005_roll_fee_signature.sql), checked by the caller.
 *
 * Everything here is read from the landed transaction, never trusted from
 * the client: the payer, the amount, and whether it landed at all.
 */
export interface RollVerifyRequest {
  signature: string
  /** Wallet the roll will belong to. The transaction must have been paid by it. */
  wallet: string
  treasury: string
  size: RollSize
  /**
   * Server-issued purchase quote for new clients; the current fee cache is
   * only the compatibility fallback for clients without a quote ID. A verified
   * creation checkpoint never re-prices the receipt on a later retry.
   *
   * Ignored when `skr` is set — the fee moved in $SKR, not SOL, in that case.
   */
  requiredLamports: number
  quoteCreatedAt?: string
  quoteExpiresAt?: string
  /** Expected SHA-256 hash of the bearer rollCapability bound in the on-chain payment SPL Memo */
  expectedCapabilityHash?: string
  /** Present only when this roll's fee is being paid in $SKR — see quick/verify.ts's identical field for the shape rationale. */
  skr?: {
    treasurySkrAta: string
    requiredAtomic: number
    quoteExpiresAt: string | null
  }
}

/**
 * `retryable` exists for the same reason it does in quick/verify.ts: by the
 * time this runs the client has already sent (and possibly confirmed) the fee
 * transfer. "I couldn't check yet" must never collapse into "this is invalid"
 * — the first should be retried with the same signature, the second refused.
 */
export type RollVerifyResult =
  | { ok: true; feeLamports: number; paidAt?: number }
  | { ok: false; retryable: boolean; reason: string }

function retry(reason: string): RollVerifyResult {
  return { ok: false, retryable: true, reason }
}

function reject(reason: string): RollVerifyResult {
  return { ok: false, retryable: false, reason }
}

/** Net lamports `address` received in this transaction, via balance delta — see quick/verify.ts. */
function lamportsReceived(tx: ParsedTransaction, address: string): number | null {
  const keys = tx.transaction.message.accountKeys
  const index = keys.findIndex((k) => k.pubkey === address)
  if (index === -1 || !tx.meta) return null
  const pre = tx.meta.preBalances[index]
  const post = tx.meta.postBalances[index]
  if (typeof pre !== 'number' || typeof post !== 'number') return null
  return post - pre
}

/** Verify that `signature` is a landed transaction paying at least the roll fee to the treasury. */
export async function verifyRollFeePayment(rpcUrl: string, req: RollVerifyRequest): Promise<RollVerifyResult> {
  let tx: ParsedTransaction | null
  try {
    tx = await getTransaction(rpcUrl, req.signature)
  } catch (err) {
    return retry(
      `RPC could not be reached to verify ${req.signature}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Absent is not invalid — a signature confirmed seconds ago may not be
  // queryable yet.
  if (!tx || !tx.meta) {
    return retry(`Transaction ${req.signature} is not visible to the RPC yet`)
  }
  if (tx.meta.err !== null) {
    return reject(`Transaction ${req.signature} failed on-chain: ${JSON.stringify(tx.meta.err)}`)
  }

  const feePayer = tx.transaction.message.accountKeys[0]?.pubkey
  if (feePayer !== req.wallet) {
    return reject(`Transaction ${req.signature} was paid by ${feePayer ?? 'nobody'}, not by ${req.wallet}`)
  }

  if (req.expectedCapabilityHash) {
    const memos = extractTransactionMemos(tx)
    const expectedMemo = `momints:roll:${req.expectedCapabilityHash}`
    const matchingMemo = memos.find((m) => m === expectedMemo)
    if (!matchingMemo) {
      const rollMemo = memos.find((m) => m.startsWith('momints:roll:'))
      if (rollMemo) {
        return reject(`Transaction ${req.signature} is bound to a different roll capability`)
      }
      return reject(`Transaction ${req.signature} is missing roll capability memo binding`)
    }
  }

  const expiresAt = req.quoteExpiresAt ?? req.skr?.quoteExpiresAt
  if (expiresAt) {
    // Compare against the chain's payment time, never the retry's wall clock.
    if (tx.blockTime === null) return retry('Payment block time is not available yet')
    const paidAt = tx.blockTime * 1000
    // Block timestamps are estimates, not the HTTP server's precise clock.
    if (paidAt > Date.parse(expiresAt) || (req.quoteCreatedAt && paidAt < Date.parse(req.quoteCreatedAt) - 60000)) {
      return reject('Payment landed outside its original quote window; preserve the receipt for support')
    }
  }

  if (req.skr) {
    if (!req.skr.quoteExpiresAt) {
      return reject(
        `No $SKR quote was ever issued for wallet ${req.wallet} — call POST /skr/quote before creating the roll`,
      )
    }
    const skrVerdict = checkSkrTransfer(tx, {
      treasurySkrAta: req.skr.treasurySkrAta,
      requiredAtomic: req.skr.requiredAtomic,
    })
    if (!skrVerdict.ok) {
      return reject(`Transaction ${req.signature}: ${skrVerdict.reason}`)
    }
    return { ok: true, feeLamports: 0, paidAt: tx.blockTime === null ? undefined : tx.blockTime * 1000 }
  }

  const required = req.requiredLamports
  const received = lamportsReceived(tx, req.treasury)
  if (received === null) {
    return reject(`Transaction ${req.signature} does not touch the treasury account ${req.treasury}`)
  }
  if (received < required) {
    return reject(
      `Transaction ${req.signature} paid the treasury ${received} lamports, below the ${required} required for a ${req.size}-roll`,
    )
  }

  return { ok: true, feeLamports: received, paidAt: tx.blockTime === null ? undefined : tx.blockTime * 1000 }
}

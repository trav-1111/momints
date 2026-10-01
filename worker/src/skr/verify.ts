import type { ParsedTransaction } from '../solana/confirm'
import { SKR_MINT_ADDRESS, SKR_VERIFY_TOLERANCE } from './config'

export interface SkrTransferCheck {
  treasurySkrAta: string
  /** The exact atomic amount the Worker's own stored quote said this payment is for. */
  requiredAtomic: number
}

/**
 * Always a definitive verdict — never retryable. By the time this runs, the
 * caller has already fetched the landed transaction (the retryable "not
 * visible to the RPC yet" case lives one level up, same as the SOL checks in
 * quick/verify.ts and rolls/verify.ts), so anything this function rejects is
 * a fact about a transaction that DID land.
 */
export type SkrTransferVerdict = { ok: true; atomicReceived: number } | { ok: false; reason: string }

/**
 * Net atomic units `ata` received in this transaction, and what mint they
 * were — a balance-delta read exactly like `lamportsReceived` in
 * quick/verify.ts and rolls/verify.ts, just against `preTokenBalances`/
 * `postTokenBalances` instead of `preBalances`/`postBalances`. Indifferent to
 * instruction ordering, CPI, or whether the transfer was Transfer vs
 * TransferChecked — whatever route the tokens took, this is the net that
 * landed in that specific account.
 */
function skrDelta(tx: ParsedTransaction, ata: string): { delta: bigint; mint: string } | null {
  const keys = tx.transaction.message.accountKeys
  const index = keys.findIndex((k) => k.pubkey === ata)
  if (index === -1) return null

  const pre = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === index)
  const post = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === index)
  const mint = post?.mint ?? pre?.mint
  if (!mint) return null // the account exists in the tx but never held an SPL token balance

  const preAmount = pre ? BigInt(pre.uiTokenAmount.amount) : 0n
  const postAmount = post ? BigInt(post.uiTokenAmount.amount) : 0n
  return { delta: postAmount - preAmount, mint }
}

/**
 * Verify a landed transaction paid at least `check.requiredAtomic` of the
 * CONFIGURED $SKR mint into the treasury's $SKR account — the $SKR analogue
 * of the SOL lamports check, called from quick/verify.ts and rolls/verify.ts
 * when a row's payment currency is $SKR. Quote existence/expiry is checked by
 * the caller (it owns the stored-quote lookup); this function only ever
 * judges the transaction itself.
 */
export function checkSkrTransfer(tx: ParsedTransaction, check: SkrTransferCheck): SkrTransferVerdict {
  const result = skrDelta(tx, check.treasurySkrAta)
  if (!result) {
    return {
      ok: false,
      reason: `Transaction does not deliver any SPL token balance to the treasury's $SKR account ${check.treasurySkrAta}`,
    }
  }
  if (result.mint !== SKR_MINT_ADDRESS) {
    return {
      ok: false,
      reason: `Transaction paid mint ${result.mint} to the treasury's $SKR account, not the configured $SKR mint ${SKR_MINT_ADDRESS}`,
    }
  }
  const floor = BigInt(Math.floor(check.requiredAtomic * (1 - SKR_VERIFY_TOLERANCE)))
  if (result.delta < floor) {
    return {
      ok: false,
      reason: `Transaction paid ${result.delta} atomic $SKR to the treasury, below the ${floor} floor (${check.requiredAtomic} quoted, ${SKR_VERIFY_TOLERANCE * 100}% tolerance)`,
    }
  }
  return { ok: true, atomicReceived: Number(result.delta) }
}

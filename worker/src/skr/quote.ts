import { publicKey, type Umi } from '@metaplex-foundation/umi'
import type { RollDb } from '../db'
import { ConfigError } from '../env'
import { SKR_DISCOUNT } from '../fees/config'
import type { FeeCache } from '../fees/cache'
import { HttpError } from '../lib/http'
import { LEGACY_QUICK_FEE_LAMPORTS_FALLBACK } from '../quick/finalize'
import type { RollSize } from '../rolls/config'
import { deriveAta } from './ata'
import { QUOTE_VALIDITY_MS, SKR_MINT_ADDRESS } from './config'
import { quoteSolToSkr } from './jupiter'

export interface SkrQuoteDeps {
  db: RollDb
  feeCache: FeeCache
  getUmi: () => Promise<Umi>
  /** Wallet address (not the ATA) — the same value quick/roll SOL verification already checks against. */
  treasuryAddress: string
}

export type SkrQuoteRequest =
  | { context: 'quick'; stagingKey: string }
  | { context: 'roll'; wallet: string; size: RollSize }

export interface SkrQuoteSuccess {
  /** Atomic $SKR units (6 decimals) — the exact amount finalize/create will verify against. */
  skrAmount: number
  expiresAt: string
  treasurySkrAta: string
}

export interface SkrQuoteUnavailable {
  unavailable: true
  reason: string
}

export type SkrQuoteResult = SkrQuoteSuccess | SkrQuoteUnavailable

/**
 * Issue and PERSIST a $SKR quote — the enforcement point for "the Worker
 * decides the amount, never the client." Reads the current cost-plus SOL fee
 * (quick: the fee already pinned at stage time, same source finalize's SOL
 * path checks; roll: the live fee_cache, same source roll creation's SOL path
 * checks), applies the $SKR discount, converts via Jupiter, and stores the
 * result so a later finalize/create call verifies against exactly this
 * number — never a re-quote, never a client-declared amount.
 *
 * A Jupiter failure returns `{unavailable: true}` rather than throwing: this
 * is an expected, recoverable outcome (spec: "never a hard 5xx for this
 * specific case") the app is expected to handle by falling back to SOL, not
 * an error condition. A malformed REQUEST (unknown stagingKey, wrong status,
 * missing fee_cache row) is a genuine client/config error and still throws.
 */
export async function issueSkrQuote(deps: SkrQuoteDeps, req: SkrQuoteRequest): Promise<SkrQuoteResult> {
  const { db, feeCache, getUmi, treasuryAddress } = deps

  let solFeeLamports: number
  if (req.context === 'quick') {
    const row = await db.getQuickMint(req.stagingKey)
    if (!row) {
      throw new HttpError(404, `No staged quick mint ${req.stagingKey}. Stage the image again before quoting.`)
    }
    if (row.status !== 'STAGED') {
      throw new HttpError(409, `Quick mint ${req.stagingKey} is ${row.status} — it cannot be re-quoted.`)
    }
    solFeeLamports = row.fee_lamports_required ?? LEGACY_QUICK_FEE_LAMPORTS_FALLBACK
  } else {
    const feeCacheRow = await feeCache.get()
    if (!feeCacheRow) {
      throw new ConfigError('fee_cache has no row — re-run migrations (0007_fee_cache.sql seeds it).')
    }
    solFeeLamports = req.size === 12 ? feeCacheRow.rollFee12Lamports : feeCacheRow.rollFee24Lamports
  }

  const discountedLamports = BigInt(Math.round(solFeeLamports * (1 - SKR_DISCOUNT)))

  let skrAmountAtomic: bigint
  try {
    skrAmountAtomic = await quoteSolToSkr(discountedLamports)
  } catch (err) {
    return { unavailable: true, reason: err instanceof Error ? err.message : String(err) }
  }
  // Safe: a realistic fee (cents to low tens of USD, per fees/config.ts's own
  // ceilings) converted to $SKR atomic units stays orders of magnitude under
  // Number.MAX_SAFE_INTEGER — consistent with how lamport amounts are already
  // handled as `number` throughout this codebase rather than bigint.
  const skrAmount = Number(skrAmountAtomic)

  const umi = await getUmi()
  const treasurySkrAta = deriveAta(umi, publicKey(treasuryAddress), publicKey(SKR_MINT_ADDRESS)).toString()
  const expiresAt = new Date(Date.now() + QUOTE_VALIDITY_MS).toISOString()

  if (req.context === 'quick') {
    await db.recordQuickSkrQuote(req.stagingKey, { atomic: skrAmount, expiresAt })
  } else {
    await db.upsertRollSkrQuote(req.wallet, {
      size: req.size,
      atomic: skrAmount,
      solFeeLamports,
      treasuryAta: treasurySkrAta,
      expiresAt,
    })
  }

  return { skrAmount, expiresAt, treasurySkrAta }
}

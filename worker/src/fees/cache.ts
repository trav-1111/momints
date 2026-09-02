// D1 access for the fee_cache singleton row (migrations/0007_fee_cache.sql).
// The ONLY thing the mint flow touches — a plain SELECT, never a live
// rent/Turbo/Jupiter read (fees/compute.ts does those, on the 3-hourly cron).

export interface FeeCacheRow {
  quickFeeLamports: number
  rollFee12Lamports: number
  rollFee24Lamports: number
  rentLamportsPerByte: number | null
  rentFrameLamports: number | null
  rentQuickAssetLamports: number | null
  storageCostLamports: number | null
  solUsdPrice: number | null
  lastGood: boolean
  computedAt: string
  lastAttemptAt: string | null
  lastAttemptOk: boolean
  lastAttemptNote: string | null
}

interface FeeCacheDbRow {
  quick_fee_lamports: number
  roll_fee_12_lamports: number
  roll_fee_24_lamports: number
  rent_lamports_per_byte: number | null
  rent_frame_lamports: number | null
  rent_quick_asset_lamports: number | null
  storage_cost_lamports: number | null
  sol_usd_price: number | null
  last_good: number
  computed_at: string
  last_attempt_at: string | null
  last_attempt_ok: number
  last_attempt_note: string | null
}

function fromDb(row: FeeCacheDbRow): FeeCacheRow {
  return {
    quickFeeLamports: row.quick_fee_lamports,
    rollFee12Lamports: row.roll_fee_12_lamports,
    rollFee24Lamports: row.roll_fee_24_lamports,
    rentLamportsPerByte: row.rent_lamports_per_byte,
    rentFrameLamports: row.rent_frame_lamports,
    rentQuickAssetLamports: row.rent_quick_asset_lamports,
    storageCostLamports: row.storage_cost_lamports,
    solUsdPrice: row.sol_usd_price,
    lastGood: row.last_good === 1,
    computedAt: row.computed_at,
    lastAttemptAt: row.last_attempt_at,
    lastAttemptOk: row.last_attempt_ok === 1,
    lastAttemptNote: row.last_attempt_note,
  }
}

export interface FeeRecomputeSuccess {
  quickFeeLamports: number
  rollFee12Lamports: number
  rollFee24Lamports: number
  rentLamportsPerByte: number
  rentFrameLamports: number
  rentQuickAssetLamports: number
  storageCostLamports: number
  solUsdPrice: number
  note: string
}

export class FeeCache {
  constructor(private readonly db: D1Database) {}

  /**
   * The served fees, straight off the migration-seeded (or last successfully
   * computed) row. Never null in practice — the migration seeds row id=1 —
   * but typed as such because a caller MUST decide what to do about a
   * genuinely missing row rather than silently guessing a fee (see index.ts).
   */
  async get(): Promise<FeeCacheRow | null> {
    const row = await this.db.prepare('SELECT * FROM fee_cache WHERE id = 1').first<FeeCacheDbRow>()
    return row ? fromDb(row) : null
  }

  /**
   * A validated recompute (passed Guards 1/2): overwrite the served fees and
   * their inputs, and record this same run as the last attempt.
   */
  async recordSuccess(values: FeeRecomputeSuccess): Promise<void> {
    await this.db
      .prepare(
        `UPDATE fee_cache SET
           quick_fee_lamports = ?, roll_fee_12_lamports = ?, roll_fee_24_lamports = ?,
           rent_lamports_per_byte = ?, rent_frame_lamports = ?, rent_quick_asset_lamports = ?,
           storage_cost_lamports = ?, sol_usd_price = ?, last_good = 1,
           computed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_attempt_ok = 1, last_attempt_note = ?
         WHERE id = 1`,
      )
      .bind(
        values.quickFeeLamports,
        values.rollFee12Lamports,
        values.rollFee24Lamports,
        values.rentLamportsPerByte,
        values.rentFrameLamports,
        values.rentQuickAssetLamports,
        values.storageCostLamports,
        values.solUsdPrice,
        values.note,
      )
      .run()
  }

  /**
   * A read failure or a Guard-2-rejected input (fees/compute.ts). NEVER
   * touches the served fee columns — Guard 3: a bad or unreachable read must
   * never zero a fee, break minting, or cache garbage. Only the attempt
   * bookkeeping moves, so `computed_at` keeps pointing at the last GOOD run.
   */
  async recordFailedAttempt(note: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE fee_cache SET
           last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_attempt_ok = 0, last_attempt_note = ?
         WHERE id = 1`,
      )
      .bind(note)
      .run()
  }
}

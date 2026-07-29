import type { TreasuryRecordContext, TreasurySink, TreasuryStatus } from '../types'

/**
 * ManualSink: records accrued treasury SOL to D1 as "conversion pending" and
 * exposes an operator-readable summary. Does NOT auto-swap — the operator
 * runs the SOL -> $SKR conversion by hand and marks rows CONVERTED via
 * `wrangler d1 execute` (README runbook).
 */
export class ManualSink implements TreasurySink {
  constructor(private readonly db: D1Database) {}

  async record(amountLamports: number, context: TreasuryRecordContext): Promise<void> {
    await this.db
      .prepare('INSERT INTO treasury_entries (amount_lamports, context) VALUES (?, ?)')
      .bind(amountLamports, JSON.stringify(context))
      .run()
  }

  async status(): Promise<TreasuryStatus> {
    const row = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'CONVERSION_PENDING' THEN amount_lamports END), 0) AS pending_lamports,
           COALESCE(SUM(CASE WHEN status = 'CONVERSION_PENDING' THEN 1 END), 0)               AS pending_count,
           COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN amount_lamports END), 0)          AS converted_lamports,
           COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN 1 END), 0)                        AS converted_count
         FROM treasury_entries`,
      )
      .first<{
        pending_lamports: number
        pending_count: number
        converted_lamports: number
        converted_count: number
      }>()

    return {
      pendingLamports: row?.pending_lamports ?? 0,
      pendingCount: row?.pending_count ?? 0,
      convertedLamports: row?.converted_lamports ?? 0,
      convertedCount: row?.converted_count ?? 0,
      note: 'Manual sink — SOL -> $SKR conversion is an operator task. See README runbook.',
    }
  }
}

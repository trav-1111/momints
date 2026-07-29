import type { TreasuryRecordContext, TreasurySink, TreasuryStatus } from '../types'

/**
 * TODO: AutomatedSink — SOL -> $SKR conversion keeper via Jupiter. NOT part
 * of this build: no always-on processes, no cron/keepers, and the treasury
 * address + conversion parameters are still pending. Stub only so the seam
 * is visible.
 */
export class AutomatedSink implements TreasurySink {
  record(_amountLamports: number, _context: TreasuryRecordContext): Promise<void> {
    throw new Error('AutomatedSink is not implemented in this build — use ManualSink. See TODO above.')
  }

  status(): Promise<TreasuryStatus> {
    throw new Error('AutomatedSink is not implemented in this build — use ManualSink. See TODO above.')
  }
}

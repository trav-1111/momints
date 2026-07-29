import type { FundingProvider, FundingStatus } from '../types'

/**
 * TODO: AutomatedFunding — a top-up keeper that watches the Irys balance and
 * funds it ahead of demand (asynchronously, never inside a user request —
 * funding confirmation takes 120+ seconds). NOT part of this build: no
 * always-on processes, no cron/keepers. Stub only so the seam is visible.
 */
export class AutomatedFunding implements FundingProvider {
  ensureFunded(_anticipatedBytes: number): Promise<FundingStatus> {
    throw new Error('AutomatedFunding is not implemented in this build — use ManualFunding. See TODO above.')
  }

  balanceStatus(): Promise<FundingStatus> {
    throw new Error('AutomatedFunding is not implemented in this build — use ManualFunding. See TODO above.')
  }
}

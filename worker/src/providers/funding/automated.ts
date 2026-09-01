import type { FundingProvider, FundingStatus } from '../types'

/**
 * TODO: AutomatedFunding — a top-up keeper that watches the Turbo credit
 * (winc) balance and funds it ahead of demand (asynchronously, never inside a
 * user request — a SOL top-up needs on-chain confirmation first). NOT part of
 * this build. Stub only so the seam is visible.
 *
 * The scheduled treasury monitor (src/ops/monitor.ts) is NOT this: it watches
 * the same balance but only NOTIFIES the operator on Discord. Nothing in this
 * codebase sends a funding transaction. If a change to the monitor makes you
 * want to, that change belongs here instead.
 */
export class AutomatedFunding implements FundingProvider {
  ensureFunded(_anticipatedBytes: number): Promise<FundingStatus> {
    throw new Error('AutomatedFunding is not implemented in this build — use TurboFunding. See TODO above.')
  }

  balanceStatus(): Promise<FundingStatus> {
    throw new Error('AutomatedFunding is not implemented in this build — use TurboFunding. See TODO above.')
  }
}

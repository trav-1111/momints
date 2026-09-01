import type { FundingProvider, FundingStatus } from '../types'
import type { TurboClient } from '../turboClient'

/**
 * Warn the operator while the balance still covers this multiple of the
 * anticipated work — i.e. before requests start failing, not after.
 */
const LOW_BALANCE_WARN_MULTIPLIER = 2

/**
 * TurboFunding: PRE-EMPTIVE credit-balance check against Turbo's payment
 * service. Replaces ManualFunding (which checked an Irys SOL balance).
 *
 * NEVER funds inline. Turbo credits (winc) are bought by sending SOL to
 * Turbo's payment address and are visible on the balance endpoint once that
 * transfer confirms — there is no `.fund()` call in this codebase to avoid in
 * the first place, but the invariant is unchanged from the Irys days: nothing
 * here may block a user-facing request on a top-up. The operator keeps the
 * Turbo credit balance topped up ahead of demand (README runbook); this class
 * only reports sufficiency and surfaces low-balance warnings.
 */
export class TurboFunding implements FundingProvider {
  constructor(private readonly turbo: TurboClient) {}

  async ensureFunded(anticipatedBytes: number): Promise<FundingStatus> {
    const [price, balance] = await Promise.all([
      this.turbo.priceForBytes(Math.max(1, Math.ceil(anticipatedBytes))),
      this.turbo.getBalance(),
    ])

    const sufficient = balance >= price
    let warning: string | null = null
    if (!sufficient) {
      warning =
        `OPERATOR ACTION REQUIRED: Turbo credit balance ${balance.toString()} winc is below the ` +
        `${price.toString()} winc needed for ~${anticipatedBytes} bytes. Top up Turbo credits (see README ` +
        'runbook — send SOL to the Turbo payment address). Top up ahead of demand.'
    } else if (balance < price * BigInt(LOW_BALANCE_WARN_MULTIPLIER)) {
      warning =
        `Turbo credit balance is low: ${balance.toString()} winc covers the anticipated ${anticipatedBytes} bytes ` +
        `(${price.toString()} winc) but less than ${LOW_BALANCE_WARN_MULTIPLIER}x that. Top up soon (README runbook).`
    }
    if (warning) {
      // Operator-facing breadcrumb in `wrangler tail` — contains no key material.
      console.warn(`[funding] ${warning}`)
    }

    return {
      sufficient,
      balanceAtomic: balance.toString(),
      requiredAtomic: price.toString(),
      anticipatedBytes,
      warning,
    }
  }

  async balanceStatus(): Promise<FundingStatus> {
    // Reference sufficiency check: one typical frame upload (see rolls/config).
    const { ESTIMATED_FRAME_BYTES } = await import('../../rolls/config')
    return this.ensureFunded(ESTIMATED_FRAME_BYTES)
  }
}

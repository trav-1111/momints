import type { FundingProvider, FundingStatus } from '../types'
import type { IrysUploader } from '../irysUploader'

/**
 * Warn the operator while the balance still covers this multiple of the
 * anticipated work — i.e. before requests start failing, not after.
 */
const LOW_BALANCE_WARN_MULTIPLIER = 2

/**
 * ManualFunding: PRE-EMPTIVE balance check against the Irys bundler node.
 *
 * NEVER funds inline. The Irys SDK tracks a pre-funded balance on the bundler
 * node — it does not auto-fund from on-chain SOL during .upload(), and
 * .fund() sends a real transaction that blocks 120+ seconds (measured,
 * reproducibly, at every payload size tested — worker-irys-spike/RESULT2.md).
 * No user-facing request may ever wait on that. The operator keeps the
 * balance topped up ahead of demand (README runbook); this class only reports
 * sufficiency and surfaces low-balance warnings.
 */
export class ManualFunding implements FundingProvider {
  constructor(private readonly uploader: IrysUploader) {}

  async ensureFunded(anticipatedBytes: number): Promise<FundingStatus> {
    const [price, balance] = await Promise.all([
      this.uploader.getPrice(Math.max(1, Math.ceil(anticipatedBytes))),
      this.uploader.getBalance(),
    ])

    const sufficient = balance.gte(price)
    let warning: string | null = null
    if (!sufficient) {
      warning =
        `OPERATOR ACTION REQUIRED: Irys balance ${balance.toString()} atomic is below the ` +
        `${price.toString()} atomic needed for ~${anticipatedBytes} bytes. Top up the funding wallet's ` +
        'Irys balance (see README runbook). Funding takes 120+ seconds to confirm — do it ahead of demand.'
    } else if (balance.lt(price.multipliedBy(LOW_BALANCE_WARN_MULTIPLIER))) {
      warning =
        `Irys balance is low: ${balance.toString()} atomic covers the anticipated ${anticipatedBytes} bytes ` +
        `(${price.toString()} atomic) but less than ${LOW_BALANCE_WARN_MULTIPLIER}x that. Top up soon — ` +
        'funding takes 120+ seconds to confirm (see README runbook).'
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

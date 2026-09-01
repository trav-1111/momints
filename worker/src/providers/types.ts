// The three provider seams. Roll/mint/cover logic calls ONLY these
// interfaces — never a concrete impl directly — so storage backends, treasury
// automation, and funding automation can each be swapped without touching
// business logic.

/**
 * Permanent-storage seam.
 * PRIMARY IMPL: TurboProvider (Turbo -> genuine Arweave, permanent). The real
 * one. Test-only fallback: PinataProvider (IPFS pinning — NOT permanent; must
 * not back any user-facing permanence claim).
 */
export interface StorageProvider {
  /** Upload a JSON document; returns a resolvable URI. */
  uploadJSON(obj: unknown): Promise<string>
  /** Upload image bytes with a MIME type; returns a resolvable URI. */
  uploadImage(bytes: Uint8Array, mime: string): Promise<string>
}

export type TreasuryRecordContext =
  | {
      kind: 'roll_fee'
      collection: string
      wallet: string
      size: number
      /** Client-reported fee-payment signature, stored for bookkeeping only. */
      feeSignature?: string
    }
  | {
      kind: 'quick_mint_fee'
      asset: string
      wallet: string
      /**
       * The mint+fee transaction, VERIFIED on-chain before this is recorded —
       * unlike roll_fee's feeSignature, which is client-reported bookkeeping.
       */
      signature: string
    }

export interface TreasuryStatus {
  pendingLamports: number
  pendingCount: number
  convertedLamports: number
  convertedCount: number
  note: string
}

/**
 * Treasury seam. IMPL NOW: ManualSink — records accrued SOL to D1 as
 * "conversion pending" and exposes an operator-readable summary. Does NOT
 * auto-swap. LATER: AutomatedSink (SOL -> $SKR Jupiter keeper) — stub only.
 */
export interface TreasurySink {
  record(amountLamports: number, context: TreasuryRecordContext): Promise<void>
  status(): Promise<TreasuryStatus>
}

export interface FundingStatus {
  /** True when the pre-funded Turbo credit (winc) balance covers the anticipated bytes. */
  sufficient: boolean
  balanceAtomic: string
  requiredAtomic: string
  anticipatedBytes: number
  /**
   * Operator-facing warning when the balance is low (even if currently
   * sufficient). Surfaced in API responses so the operator sees it before a
   * request fails outright.
   */
  warning: string | null
}

/**
 * Funding seam. ensureFunded() is a PRE-EMPTIVE CHECK, not a reactive fund:
 * it reports whether the pre-funded Turbo credit (winc) balance is sufficient
 * for the anticipated work and surfaces a warning to the operator. It must
 * NEVER fund inline — topping up Turbo credits means sending SOL on-chain and
 * waiting for it to confirm, which no user-facing request may ever wait on
 * (the same discipline the old Irys `.fund()` call was banned under —
 * docs/spikes/irys/RESULT2.md). Top-ups are a manual operator task (see
 * README runbook) until AutomatedFunding exists.
 */
export interface FundingProvider {
  ensureFunded(anticipatedBytes: number): Promise<FundingStatus>
  balanceStatus(): Promise<FundingStatus>
}

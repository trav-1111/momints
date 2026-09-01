import { ESTIMATED_FRAME_BYTES } from '../rolls/config'

// DECIDED — not a placeholder. Anchored to the MAX_QUICK_IMAGE_BYTES ceiling
// so a large photo can never lose money (a smaller one just carries wider
// margin):
//
//   Core asset rent           3_511_440 atomic  (measured: a real minted asset)
//   Arweave image @ 3 MiB     1_261_912 atomic  (measured, GET /funding/status)
//   URI-swap transaction          ~5_000        (Worker-paid, negligible)
//   ------------------------------------------
//   real cost                 4_775_352
//   × ~1.36 margin
//   ------------------------------------------
//   QUICK_MINT_FEE_LAMPORTS   6_500_000         (0.0065 SOL)
//
// The previous figure (2_000_000) never accounted for the asset's own rent —
// only Arweave + the URI-swap tx — despite the Worker paying that rent out of
// the same balance it pays storage from. It was covering ~42% of real cost.
//
// Denominated in lamports so this tracks SOL/USD automatically — but NOT
// AR/SOL: Arweave storage is priced in AR and converted through Turbo's own
// rate, which moves independently of SOL's own price. Re-check this if AR/SOL
// has moved a lot since the measurement above.
//
// Worth remembering when tuning: moving quick mints from a Token Metadata NFT
// to a standalone Core asset dropped the user's own mint cost by roughly
// 0.009 SOL (four rent-paying accounts down to one), so this fee still leaves
// a quick shot cheaper overall than it was before it was chargeable.
//
// TODO (flagged by the Turbo/Arweave storage swap, not resolved here — see
// ARWEAVE_PATH_OPTIONS.md "C. Real cost", investigated 2026-08-31 at SOL/USD
// $103.76, AR/USD $2.09): the "Arweave image @ 3 MiB" line above (1_261_912
// atomic) is a devnet Irys L1 price, not genuine Arweave storage cost.
// Recomputed against real Turbo/Arweave pricing:
//   real cost $0.1165 vs fee $0.6744 (6_500_000) = 5.79× margin
// — healthier than the margin above, not thinner. A candidate number, not a
// directive — operator should re-confirm against live Turbo/AR/SOL prices
// before relying on it; this comment does not change QUICK_MINT_FEE_LAMPORTS.
export const QUICK_MINT_FEE_LAMPORTS = 6_500_000

// Free quick mints per wallet per day before the fee applies. 0 = every quick
// mint pays. TODO: revisit once there is real usage data; a small allowance is
// a growth lever, not a correctness question, and the verification path
// already tolerates it (a zero-fee mint just skips the treasury check).
export const QUICK_MINT_FREE_ALLOWANCE = 0

// Hard image ceiling. MUST stay coupled to the fee's cost basis above: the fee
// buys 3 MiB of permanent storage, so staging anything larger would sell
// storage below cost. Reuses the roll planning figure — same photos, same
// camera, same conservative sizing.
export const MAX_QUICK_IMAGE_BYTES = ESTIMATED_FRAME_BYTES

// Brake on the unauthenticated stage endpoint. Staging cannot spend Arweave
// (nothing is uploaded until a fee-paying mint is verified on-chain), so the
// only exposure is R2 spam — bounded by this, the size ceiling, and the
// bucket's 24h lifecycle rule.
export const MAX_STAGES_PER_WALLET_PER_DAY = 60

/** R2 key for a staged image. Prefix matches the bucket's lifecycle rule. */
export function stagingKeyFor(wallet: string, id: string): string {
  return `quick-staging/${wallet}/${id}`
}

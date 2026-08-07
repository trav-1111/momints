import { ESTIMATED_FRAME_BYTES } from '../rolls/config'

// TODO: placeholder pricing — final numbers are not decided, same status as
// ROLL_FEE_LAMPORTS_* in rolls/config.ts. Do not ship these numbers.
//
// Cost basis, anchored to the MAX_QUICK_IMAGE_BYTES ceiling so a large photo
// can never lose money (a smaller one just carries wider margin):
//
//   Arweave storage @ 3 MiB   ~1_200_045 atomic  (measured, GET /funding/status)
//   URI-swap transaction      ~    5_000         (Worker-paid)
//   margin                     ~ 794_955
//   ------------------------------------------
//   QUICK_MINT_FEE_LAMPORTS    2_000_000         (0.002 SOL)
//
// Denominated in lamports, never a dollar amount, so it tracks the SOL price.
//
// Worth remembering when tuning: moving quick mints from a Token Metadata NFT
// to a standalone Core asset dropped the user's own mint cost by roughly
// 0.009 SOL (four rent-paying accounts down to one), so a fee in this range
// still leaves a quick shot cheaper than it was before it was chargeable.
export const QUICK_MINT_FEE_LAMPORTS = 2_000_000

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

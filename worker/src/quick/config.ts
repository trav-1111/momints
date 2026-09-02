import { ESTIMATED_FRAME_BYTES } from '../rolls/config'

// SUPERSEDED by cost-plus pricing (fees/compute.ts): the quick-mint fee is
// now storage_cost x QUICK_MARGIN, computed from a LIVE Turbo quote,
// recomputed every 3h, and served from fee_cache (fees/cache.ts) — see
// quick/stage.ts (quotes and persists it) and quick/finalize.ts (verifies
// against the persisted quote, never a live re-read — see quick/verify.ts's
// requiredLamports doc for why). The flat 6_500_000-lamport fee that used to
// live here now exists only as migrations/0007_fee_cache.sql's one-time
// bootstrap seed.

// Free quick mints per wallet per day before the fee applies. 0 = every quick
// mint pays. TODO: revisit once there is real usage data; a small allowance is
// a growth lever, not a correctness question, and the verification path
// already tolerates it (a zero-fee mint just skips the treasury check).
export const QUICK_MINT_FREE_ALLOWANCE = 0

// Hard image ceiling. MUST stay coupled to the cost-plus fee's storage
// ceiling (fees/config.ts quotes against this same ESTIMATED_FRAME_BYTES):
// the fee buys 3 MiB of permanent storage, so staging anything larger would
// sell storage below cost. Reuses the roll planning figure — same photos,
// same camera, same conservative sizing.
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

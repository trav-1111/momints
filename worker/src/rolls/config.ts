export type RollSize = 12 | 24

export function isRollSize(size: number): size is RollSize {
  return size === 12 || size === 24
}

// SUPERSEDED by cost-plus pricing (fees/compute.ts): roll fees are now
// computed from LIVE mainnet rent + Turbo storage cost, recomputed every 3h,
// and served from fee_cache (fees/cache.ts) — see rolls/create.ts and
// rolls/verify.ts, which read the cache rather than a flat constant. The flat
// 85_000_000 / 165_000_000 lamport fees that used to live here now exist only
// as migrations/0007_fee_cache.sql's one-time bootstrap seed (the values live
// immediately before this swap), so a fresh deploy never prices a roll before
// the first recompute has run.

/** Image types accepted for permanent storage — frames and quick mints alike. */
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Funding pre-check sizing. Spike data (docs/spikes/irys/RESULT2.md): 1–6 MB
// payloads all upload fine, ~2.5s server total pre-funded; app frames land
// around 1–3 MB. 3 MiB/frame is a deliberately conservative planning figure —
// used ONLY to size the ensureFunded() pre-check, never as an upload cap.
export const ESTIMATED_FRAME_BYTES = 3 * 1024 * 1024
export const COVER_MAX_BYTES = 200 * 1024
export const ESTIMATED_METADATA_BYTES = 4 * 1024

/** Bytes ensureFunded() should anticipate for a whole roll at creation time. */
export function estimatedRollBytes(size: RollSize): number {
  return size * (ESTIMATED_FRAME_BYTES + ESTIMATED_METADATA_BYTES) + COVER_MAX_BYTES + ESTIMATED_METADATA_BYTES
}

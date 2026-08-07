export type RollSize = 12 | 24

export function isRollSize(size: number): size is RollSize {
  return size === 12 || size === 24
}

// TODO: placeholder amounts — final pricing is not decided. The prepaid fee
// must cover N frame uploads + 1 cover upload. Keep in sync with the app's
// src/config/roll.ts until pricing is finalized. Do not ship these numbers.
export const ROLL_FEE_LAMPORTS_12 = 10_000_000 // 0.010 SOL — TODO placeholder
export const ROLL_FEE_LAMPORTS_24 = 18_000_000 // 0.018 SOL — TODO placeholder

export function getRollFeeLamports(size: RollSize): number {
  return size === 12 ? ROLL_FEE_LAMPORTS_12 : ROLL_FEE_LAMPORTS_24
}

/** Image types accepted for permanent storage — frames and quick mints alike. */
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Funding pre-check sizing. Spike data (worker-irys-spike/RESULT2.md): 1–6 MB
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

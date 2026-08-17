export type RollSize = 12 | 24

export function isRollSize(size: number): size is RollSize {
  return size === 12 || size === 24
}

// DECIDED — not a placeholder. Keep in sync with the app's src/config/roll.ts;
// there is no shared module between the two projects.
//
// Cost basis (real, measured on-chain/via /funding/status — see the 12-roll
// math below; 24 scales the per-frame line and reuses the fixed line):
//
//   Core asset rent (1 frame)         3_511_440  (measured: a real minted frame)
//   Arweave image @ 3 MiB ceiling     1_261_912  (measured, GET /funding/status)
//   ------------------------------------------
//   per-frame                         4_773_352
//   × 12 frames                      57_280_224
//   + collection rent (UpdateDelegate
//     + Royalties attached)            2_610_000  (measured: a real collection)
//   + cover upload (≤200 KiB, well
//     under a full frame)                 82_125
//   + collection metadata upload          ~1_500
//   ------------------------------------------
//   real cost, 12-roll                59_973_849  (≈ 0.0600 SOL)
//   × ~1.42 margin
//   ------------------------------------------
//   ROLL_FEE_LAMPORTS_12              85_000_000  (0.085 SOL)
//
// Real cost, 24-roll ≈ 117_254_073 (24 frames + the same fixed collection/cover
// overhead) → ROLL_FEE_LAMPORTS_24 = 165_000_000 (0.165 SOL, ≈1.41×). The
// 24-roll fee is not exactly 2× the 12-roll fee because the collection/cover
// overhead is fixed per roll, not per frame — amortized over more frames it
// is a smaller per-frame add, a small structural bulk discount.
//
// Per-frame, a roll frame's real cost is ~9% higher than a standalone quick
// mint (worker/src/quick/config.ts) — not a pricing inconsistency, it is the
// collection + cover art overhead a quick mint never creates.
//
// Denominated in lamports so this tracks SOL/USD automatically — but NOT
// AR/SOL: Arweave storage is priced in AR and converted through Irys's
// internal rate, which moves independently of SOL's own price. The ~1.4×
// margin is partly a buffer against that drift, not just profit; re-check
// these numbers if AR/SOL has moved a lot since the comment above was written.
export const ROLL_FEE_LAMPORTS_12 = 85_000_000 // 0.085 SOL
export const ROLL_FEE_LAMPORTS_24 = 165_000_000 // 0.165 SOL

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

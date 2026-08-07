/**
 * Prepaid roll configuration.
 *
 * A roll is paid for once, up front, at creation time. The fee must cover the
 * storage cost of N frame uploads plus 1 cover upload, and the collection
 * creation. Paid to ROLL_TREASURY_ADDRESS in the same transaction that
 * creates the roll's collection.
 */

export type PrepaidRollSize = 12 | 24

export const PREPAID_ROLL_SIZES: PrepaidRollSize[] = [12, 24]

// TODO: placeholder amounts — final pricing is not decided. Must cover
// 12/24 frame uploads + 1 cover upload. Do not ship these numbers.
export const ROLL_FEE_LAMPORTS_12 = 10_000_000 // 0.010 SOL — TODO placeholder
export const ROLL_FEE_LAMPORTS_24 = 18_000_000 // 0.018 SOL — TODO placeholder

/** Fee treasury — set EXPO_PUBLIC_ROLL_TREASURY in .env (base58 wallet address). */
export const ROLL_TREASURY_ADDRESS = (process.env.EXPO_PUBLIC_ROLL_TREASURY ?? '').trim()

export function isPrepaidRollSize(size: number): size is PrepaidRollSize {
  return size === 12 || size === 24
}

/** Lamports owed for a roll of `size` frames. Throws on any size but 12/24. */
export function getRollFeeLamports(size: number): number {
  if (!isPrepaidRollSize(size)) {
    throw new Error(`Invalid roll size ${size} — rolls are 12 or 24 exposures only`)
  }
  return size === 12 ? ROLL_FEE_LAMPORTS_12 : ROLL_FEE_LAMPORTS_24
}

export function formatSol(lamports: number): string {
  return `${(lamports / 1_000_000_000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} SOL`
}

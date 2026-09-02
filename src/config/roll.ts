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

// DISPLAY FALLBACK ONLY — not what a roll actually gets charged. Roll fees
// are cost-plus now (worker/src/fees/compute.ts): the Worker recomputes them
// every 3h from live rent + storage cost and serves the current numbers from
// GET /fees. rollCollection.ts's payRollFee() always fetches that live value
// at payment time; mode-select.tsx does too, for what it displays, falling
// back to these two constants only while that fetch is in flight or if the
// device is offline. These are the flat fees that were live immediately
// before the cost-plus swap — not kept in sync with anything going forward,
// they just need to be a plausible number for that brief fallback window.
export const ROLL_FEE_LAMPORTS_12 = 85_000_000 // 0.085 SOL
export const ROLL_FEE_LAMPORTS_24 = 165_000_000 // 0.165 SOL

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

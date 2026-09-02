// Cost-plus fee pricing constants. See fees/compute.ts for the formula and
// guards this backs; README "Cost-plus fee pricing" for the operator-facing
// explanation.

/**
 * fee = clamp(actual_cost x margin, floor, ceiling). Separate constants so
 * quick and roll margins can diverge later even though both start at 1.7x —
 * they are not accidentally the same value, they are pinned to it.
 */
export const QUICK_MARGIN = 1.7
export const ROLL_MARGIN = 1.7

/**
 * Guard 1 absolute bounds, USD-intent (converted to lamports each recompute
 * using that cycle's SOL/USD read — fees/compute.ts). Deliberately WIDE: they
 * must never bind across the whole SIMD-0437 rollout, and roll fees will FALL
 * substantially as rent drops (a 24-roll fee could go from ~$15 today toward
 * ~$6 once rent fully reduces) — a floor above that post-reduction price would
 * keep prices artificially high, exactly the failure this feature exists to
 * avoid. If a computed fee ever lands outside these, something is genuinely
 * wrong (a bad read that slipped past Guard 2, or a real cost move nobody
 * updated these for) — it gets clamped AND alerted, never silently served.
 */
export const QUICK_FLOOR_USD = 0.05
export const QUICK_CEILING_USD = 1.5
export const ROLL_12_FLOOR_USD = 0.5
export const ROLL_12_CEILING_USD = 25
export const ROLL_24_FLOOR_USD = 1.0
export const ROLL_24_CEILING_USD = 40

/** Guard 4: a valid recompute that moves a served fee by more than this fraction is applied, but alerted. */
export const LARGE_MOVE_ALERT_FRACTION = 0.5

/**
 * Guard 2: the rent sysvar's effective lamports_per_byte must land on one of
 * these — the pre-SIMD-0437 baseline or one of its five gated reduction
 * steps — or the read is treated as garbage and the whole recompute is
 * rejected (last-good kept). A step landing here (even a big jump) is a
 * legitimate SIMD-0437 activation, not a bad read — that distinction is the
 * whole point of validating against a known set instead of a magnitude check.
 *
 * Mirrors SIMD_0437_STEPS in scripts/mainnet-rent-quote.mjs — a plain Node
 * script outside this Worker's build, so kept in sync by hand, same
 * discipline as the app/worker roll-fee constant duplication elsewhere in
 * this repo. Update both if Solana ever revises the schedule.
 */
export const KNOWN_LAMPORTS_PER_BYTE: readonly number[] = [6960, 6333, 5080, 2575, 1322, 696]

/**
 * "https://arweave.net/" (20 chars) + a 44-char data item id — the
 * conservative case (43-char ids are one byte / one lamports_per_byte
 * shorter), same convention the old Irys-era model in
 * scripts/mainnet-rent-quote.mjs used for its own gateway URI.
 */
export const ARWEAVE_URI_LEN = 64

/**
 * Reference payment amount for Turbo's SOL->winc exchange-rate quote
 * (turboClient.ts's quoteWincForLamports). Any amount works — Turbo's
 * infrastructure fee is a flat percentage (verified live: `/v1/price/solana/N`
 * returns a `multiply` adjustment, not a fixed one) — 1 SOL is just a round,
 * comfortably-sized denominator.
 */
export const RATE_REFERENCE_LAMPORTS = 1_000_000_000n

/** $SKR pays a discount off the cost-plus fee. See fees/compute.ts's skrTargetUsd. */
export const SKR_DISCOUNT = 0.25

/**
 * Guard 2 sanity bounds on Turbo's storage quote for one ESTIMATED_FRAME_BYTES
 * (3 MiB) ceiling image, converted to lamports. Live-measured 2026-09-02:
 * ~1.21M lamports (~$0.0012 SOL). These bounds exist only to catch a garbled
 * read (zero, or absurdly large) — not to track the real price, which moves
 * with AR/SOL and Turbo's own rates.
 */
export const STORAGE_COST_MIN_LAMPORTS = 1
export const STORAGE_COST_MAX_LAMPORTS = 500_000_000 // ~0.5 SOL — orders of magnitude above any plausible quote

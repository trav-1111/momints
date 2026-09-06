// $SKR payment constants. See skr/quote.ts for the computation these back,
// README "Pay with $SKR" for the operator-facing explanation.

/**
 * Load-bearing: the ONLY token this Worker will ever accept as a $SKR fee
 * payment. Verified on Solscan once by the operator against the treasury's
 * actual held balance (README) — a wrong value here means accepting the
 * wrong token as payment.
 */
export const SKR_MINT_ADDRESS = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'

/** Immutable for a given SPL mint — verified against the live mint account. */
export const SKR_DECIMALS = 6

/** How long a Worker-issued quote is valid. Past this, verification rejects it. */
export const QUOTE_VALIDITY_MS = 120_000

/**
 * Verification floor = stored quote x (1 - this). Absorbs ordinary Jupiter
 * quote drift between the moment the Worker issues a quote and the moment the
 * payment transaction lands — not a discount, a tolerance band.
 */
export const SKR_VERIFY_TOLERANCE = 0.02

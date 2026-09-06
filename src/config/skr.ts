// $SKR payment constants — kept in sync BY HAND with the worker's copy
// (worker/src/skr/config.ts), same discipline as the app/worker duplication
// of KNOWN_LAMPORTS_PER_BYTE elsewhere in this repo (no shared module between
// the two projects).

/** Load-bearing: the ONLY token this app will ever build a fee transfer for. */
export const SKR_MINT_ADDRESS = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'

/** Immutable for a given SPL mint. */
export const SKR_DECIMALS = 6

/** Atomic $SKR units -> a human-readable string, same rounding style as formatSol (config/roll.ts). */
export function formatSkr(atomic: number): string {
  return `${(atomic / 10 ** SKR_DECIMALS).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} $SKR`
}

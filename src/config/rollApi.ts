/**
 * Roll backend Worker. REQUIRED — there is no on-device fallback: rolls and
 * quick mints both go through the server-side pipeline, which generates
 * covers, stores everything permanently on Arweave via Irys, verifies fee
 * payment on-chain before spending anything, and mints Core assets owned by
 * the shooter's wallet (signed by the Worker's key for roll frames, so those
 * cost the user no wallet approval at all).
 *
 * Left unset, `rollApi.ts`'s `request()` throws a clear "not configured"
 * error rather than degrading to a different, less-verified code path.
 */
export const ROLL_API_BASE = (process.env.EXPO_PUBLIC_ROLL_API ?? '').trim().replace(/\/+$/, '')

/** Whether the roll Worker is configured. Used for UI gating and defensive checks — not a feature toggle. */
export function isWorkerRollEnabled(): boolean {
  return ROLL_API_BASE.length > 0
}

/** Shooter's local calendar day (yyyy-mm-dd) — the Worker names rolls by it. */
export function localDateLabel(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

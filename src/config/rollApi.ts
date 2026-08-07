/**
 * Roll backend Worker.
 *
 * When `EXPO_PUBLIC_ROLL_API` is set, rolls go through the server-side
 * pipeline: the Worker generates the cover, stores everything permanently on
 * Arweave via Irys, and mints each frame as a Core asset owned by the
 * shooter's wallet — signed by the Worker's key, so frames cost the user no
 * wallet approvals at all.
 *
 * Left unset, the app keeps the on-device path (Pinata/IPFS uploads and
 * MWA-signed mints). Both paths stay live so a bad Worker day is one env var
 * away from a working fallback.
 */
export const ROLL_API_BASE = (process.env.EXPO_PUBLIC_ROLL_API ?? '').trim().replace(/\/+$/, '')

export function isWorkerRollEnabled(): boolean {
  return ROLL_API_BASE.length > 0
}

/** Shooter's local calendar day (yyyy-mm-dd) — the Worker names rolls by it. */
export function localDateLabel(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

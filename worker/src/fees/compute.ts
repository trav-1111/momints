// Cost-plus fee recompute: read live rent + storage cost, apply margin,
// guard, cache. Runs on its own 3-hourly cron (wrangler.toml), separate from
// the treasury monitor's 6-hourly one (ops/monitor.ts) — see index.ts's
// scheduled() dispatch. Mirrors that module's read -> guard -> alert shape.
//
// PRICING MODEL (see README "Cost-plus fee pricing" for the operator-facing
// version):
//   quick_fee = storage_cost x QUICK_MARGIN                          (user mints & pays own rent)
//   roll_fee  = frames x (rent_per_frame + storage_cost) x ROLL_MARGIN (Worker mints & pays rent)
// storage_cost is Turbo's live quote for one ESTIMATED_FRAME_BYTES (3 MiB)
// ceiling image — the fee always covers the worst case, same principle
// rolls/config.ts and quick/config.ts already used for the flat constants
// this replaces. rent_per_frame is a roll frame's live mainnet rent-exempt
// minimum (fees/rent.ts) — this is deliberately NOT amortized with the
// collection/cover overhead the old flat constants included; the per-frame
// formula is what tracks SIMD-0437 automatically, and the wide margin +
// floor/ceiling guards absorb the fixed-cost gap.
import type { Env } from '../env'
import { postDiscordAlert, type DiscordAlert } from '../ops/discord'
import type { TurboClient } from '../providers/turboClient'
import { ESTIMATED_FRAME_BYTES } from '../rolls/config'
import { FeeCache } from './cache'
import {
  KNOWN_LAMPORTS_PER_BYTE,
  LARGE_MOVE_ALERT_FRACTION,
  QUICK_CEILING_USD,
  QUICK_FLOOR_USD,
  QUICK_MARGIN,
  RATE_REFERENCE_LAMPORTS,
  ROLL_12_CEILING_USD,
  ROLL_12_FLOOR_USD,
  ROLL_24_CEILING_USD,
  ROLL_24_FLOOR_USD,
  ROLL_MARGIN,
  STORAGE_COST_MAX_LAMPORTS,
  STORAGE_COST_MIN_LAMPORTS,
} from './config'
import { readMainnetRent } from './rent'

const JUPITER_SOL_USD_URL = 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const LAMPORTS_PER_SOL = 1_000_000_000
const JUPITER_TIMEOUT_MS = 15_000

export interface FeeRecomputeDeps {
  env: Env
  cache: FeeCache
  turbo: TurboClient
}

export interface FeeRecomputeResult {
  ok: boolean
  note: string
  fees?: { quickFeeLamports: number; rollFee12Lamports: number; rollFee24Lamports: number }
  /** What was posted to Discord this run, for the caller's own log line. */
  alertNotes: string[]
}

/** SOL/USD spot price — same source and shape as scripts/mainnet-rent-quote.mjs. Used ONLY to convert the USD-intent Guard 1 bounds to lamports; never in the fee formula itself. */
async function fetchSolUsd(): Promise<number> {
  const res = await fetch(JUPITER_SOL_USD_URL, { signal: AbortSignal.timeout(JUPITER_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`Jupiter SOL/USD lookup failed: ${res.status}`)
  }
  const body = (await res.json()) as Record<string, { usdPrice?: number }>
  const price = body[SOL_MINT]?.usdPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error('Jupiter SOL/USD response missing a usable usdPrice')
  }
  return price
}

/** Lamports needed to buy `wincNeeded` credits, given Turbo's live net-of-fee rate for RATE_REFERENCE_LAMPORTS. Ceiling division — never quote less than actually required. */
function lamportsForWinc(wincNeeded: bigint, wincPerReferenceSol: bigint): number {
  const lamports = (wincNeeded * RATE_REFERENCE_LAMPORTS + wincPerReferenceSol - 1n) / wincPerReferenceSol
  return Number(lamports)
}

function clamp(value: number, floor: number, ceiling: number): { value: number; clamped: boolean } {
  if (value < floor) return { value: floor, clamped: true }
  if (value > ceiling) return { value: ceiling, clamped: true }
  return { value, clamped: false }
}

/** Guard 4: informational only — always applies the new value regardless of what this finds. */
function describeLargeMove(label: string, previous: number, next: number): string | null {
  if (previous <= 0) return null
  const fraction = Math.abs(next - previous) / previous
  if (fraction <= LARGE_MOVE_ALERT_FRACTION) return null
  const direction = next < previous ? 'dropped' : 'rose'
  return `${label} ${direction} ${(fraction * 100).toFixed(0)}% (${previous} -> ${next} lamports)`
}

function buildRecomputeFailedAlert(reason: string): DiscordAlert {
  return {
    severity: 'critical',
    title: 'Fee recompute FAILED — serving last-good fees',
    description:
      'The 3-hourly cost-plus fee recompute could not complete. Minting is unaffected: it is still charging the ' +
      'last successfully computed fees (fee_cache last_good row) — this never blocks a mint, but pricing has not ' +
      'moved since the last successful run.',
    mention: true,
    fields: [{ name: 'Reason', value: reason.slice(0, 1000) }],
  }
}

function buildClampAlert(notes: string[]): DiscordAlert {
  return {
    severity: 'low',
    title: 'Fee recompute: clamped to guard bounds',
    description:
      'A computed fee landed outside its absolute floor/ceiling (fees/config.ts) and was clamped before being ' +
      'served. Either a real cost moved a lot, or the guard bounds need revisiting — worth a look either way.',
    fields: notes.slice(0, 25).map((n, i) => ({ name: `Clamp ${i + 1}`, value: n })),
  }
}

function buildLargeMoveAlert(notes: string[]): DiscordAlert {
  return {
    severity: 'low',
    title: 'Fee recompute: large valid price move',
    description:
      'A recomputed fee moved by more than 50% from the last cached value. It was APPLIED — this passed every ' +
      'guard, so it is treated as real (most likely a SIMD-0437 rent step activating). Informational only.',
    fields: notes.slice(0, 25).map((n, i) => ({ name: `Move ${i + 1}`, value: n })),
  }
}

/**
 * The 3-hourly recompute. Every external read (mainnet rent, Turbo price +
 * exchange rate, Jupiter SOL/USD) is inside ONE try/catch: fees/quick/roll12/
 * roll24 are computed together from the same inputs each cycle, so a failure
 * in any one of them aborts the WHOLE cycle rather than caching a partial or
 * inconsistent set (Guard 3).
 */
export async function runFeeRecompute(deps: FeeRecomputeDeps): Promise<FeeRecomputeResult> {
  const { env, cache, turbo } = deps
  const alertNotes: string[] = []

  let lamportsPerByte: number
  let rollFrameRentLamports: number
  let quickAssetRentLamports: number
  let storageCostWinc: bigint
  let wincPerReferenceSol: bigint
  let solUsd: number
  try {
    const [rent, price, rate, usd] = await Promise.all([
      // SOLANA_RPC_URL is itself mainnet now — a strictly-better fallback
      // than the public endpoint rent.ts falls back to as a last resort.
      readMainnetRent(env.SOLANA_RPC_URL_MAINNET ?? env.SOLANA_RPC_URL),
      turbo.priceForBytes(ESTIMATED_FRAME_BYTES),
      turbo.quoteWincForLamports(RATE_REFERENCE_LAMPORTS),
      fetchSolUsd(),
    ])
    lamportsPerByte = rent.lamportsPerByte
    rollFrameRentLamports = rent.rollFrameRentLamports
    quickAssetRentLamports = rent.quickAssetRentLamports
    storageCostWinc = price
    wincPerReferenceSol = rate
    solUsd = usd
  } catch (err) {
    const reason = `read failed: ${err instanceof Error ? err.message : String(err)}`
    await cache.recordFailedAttempt(reason)
    const delivery = await postDiscordAlert(env, buildRecomputeFailedAlert(reason))
    alertNotes.push(delivery.ok ? 'posted recompute-failed alert' : `recompute-failed alert NOT delivered: ${delivery.error}`)
    return { ok: false, note: reason, alertNotes }
  }

  // ---- Guard 2: validate the RAW inputs before computing anything from them ----
  if (!KNOWN_LAMPORTS_PER_BYTE.includes(lamportsPerByte)) {
    const reason =
      `rejected rent read: lamports_per_byte=${lamportsPerByte} is not one of the known SIMD-0437 values ` +
      `(${KNOWN_LAMPORTS_PER_BYTE.join(', ')}) — treated as a bad read, not a real step`
    await cache.recordFailedAttempt(reason)
    const delivery = await postDiscordAlert(env, buildRecomputeFailedAlert(reason))
    alertNotes.push(delivery.ok ? 'posted recompute-failed alert' : `recompute-failed alert NOT delivered: ${delivery.error}`)
    return { ok: false, note: reason, alertNotes }
  }
  if (wincPerReferenceSol <= 0n) {
    const reason = `rejected Turbo SOL exchange rate: quoted ${wincPerReferenceSol} winc for ${RATE_REFERENCE_LAMPORTS} lamports`
    await cache.recordFailedAttempt(reason)
    const delivery = await postDiscordAlert(env, buildRecomputeFailedAlert(reason))
    alertNotes.push(delivery.ok ? 'posted recompute-failed alert' : `recompute-failed alert NOT delivered: ${delivery.error}`)
    return { ok: false, note: reason, alertNotes }
  }
  const storageCostLamports = lamportsForWinc(storageCostWinc, wincPerReferenceSol)
  if (storageCostLamports < STORAGE_COST_MIN_LAMPORTS || storageCostLamports > STORAGE_COST_MAX_LAMPORTS) {
    const reason =
      `rejected storage quote: ${storageCostLamports} lamports for ${ESTIMATED_FRAME_BYTES} bytes is outside the ` +
      `sane range [${STORAGE_COST_MIN_LAMPORTS}, ${STORAGE_COST_MAX_LAMPORTS}]`
    await cache.recordFailedAttempt(reason)
    const delivery = await postDiscordAlert(env, buildRecomputeFailedAlert(reason))
    alertNotes.push(delivery.ok ? 'posted recompute-failed alert' : `recompute-failed alert NOT delivered: ${delivery.error}`)
    return { ok: false, note: reason, alertNotes }
  }

  // ---- Raw fees ----
  const quickRaw = Math.round(storageCostLamports * QUICK_MARGIN)
  const roll12Raw = Math.round(12 * (rollFrameRentLamports + storageCostLamports) * ROLL_MARGIN)
  const roll24Raw = Math.round(24 * (rollFrameRentLamports + storageCostLamports) * ROLL_MARGIN)

  // ---- Guard 1: clamp to the USD-intent absolute bounds, converted via this cycle's SOL/USD ----
  const usdToLamports = (usd: number) => Math.round((usd / solUsd) * LAMPORTS_PER_SOL)
  const quick = clamp(quickRaw, usdToLamports(QUICK_FLOOR_USD), usdToLamports(QUICK_CEILING_USD))
  const roll12 = clamp(roll12Raw, usdToLamports(ROLL_12_FLOOR_USD), usdToLamports(ROLL_12_CEILING_USD))
  const roll24 = clamp(roll24Raw, usdToLamports(ROLL_24_FLOOR_USD), usdToLamports(ROLL_24_CEILING_USD))

  const clampNotes: string[] = []
  if (quick.clamped) clampNotes.push(`quick ${quickRaw} -> ${quick.value} lamports`)
  if (roll12.clamped) clampNotes.push(`roll12 ${roll12Raw} -> ${roll12.value} lamports`)
  if (roll24.clamped) clampNotes.push(`roll24 ${roll24Raw} -> ${roll24.value} lamports`)
  if (clampNotes.length > 0) {
    const delivery = await postDiscordAlert(env, buildClampAlert(clampNotes))
    alertNotes.push(delivery.ok ? 'posted clamp alert' : `clamp alert NOT delivered: ${delivery.error}`)
  }

  // ---- Guard 4: large-but-valid move vs. the currently SERVED fee (informational — always applied) ----
  const previous = await cache.get()
  const moveNotes: string[] = []
  if (previous) {
    for (const note of [
      describeLargeMove('quick', previous.quickFeeLamports, quick.value),
      describeLargeMove('roll12', previous.rollFee12Lamports, roll12.value),
      describeLargeMove('roll24', previous.rollFee24Lamports, roll24.value),
    ]) {
      if (note) moveNotes.push(note)
    }
  }
  if (moveNotes.length > 0) {
    const delivery = await postDiscordAlert(env, buildLargeMoveAlert(moveNotes))
    alertNotes.push(delivery.ok ? 'posted large-move alert' : `large-move alert NOT delivered: ${delivery.error}`)
  }

  const note =
    `computed OK — rent ${lamportsPerByte} lamports/byte, storage ${storageCostLamports} lamports/` +
    `${ESTIMATED_FRAME_BYTES}B, SOL/USD ${solUsd.toFixed(2)}` +
    (clampNotes.length ? `; clamped: ${clampNotes.join('; ')}` : '') +
    (moveNotes.length ? `; large moves: ${moveNotes.join('; ')}` : '')

  await cache.recordSuccess({
    quickFeeLamports: quick.value,
    rollFee12Lamports: roll12.value,
    rollFee24Lamports: roll24.value,
    rentLamportsPerByte: lamportsPerByte,
    rentFrameLamports: rollFrameRentLamports,
    rentQuickAssetLamports: quickAssetRentLamports,
    storageCostLamports,
    solUsdPrice: solUsd,
    note,
  })

  return {
    ok: true,
    note,
    fees: { quickFeeLamports: quick.value, rollFee12Lamports: roll12.value, rollFee24Lamports: roll24.value },
    alertNotes,
  }
}

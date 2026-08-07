// Treasury monitor: scheduled READ-AND-NOTIFY checks over operator-critical
// state. It reads balances and posts to Discord. It never funds, signs, or
// moves anything — auto top-up is the AutomatedFunding keeper, which
// deliberately does not exist yet (providers/funding/automated.ts).
//
// Shape for future checks: one exported check function per alert stream, one
// ops_alert_state row per stream, all reusing postDiscordAlert. Add the call
// to runTreasuryMonitor() and nothing else changes.
import type { AlertLevel, OpsAlertStore } from '../db'
import type { Env } from '../env'
import type { FundingProvider, FundingStatus } from '../providers/types'
import { postDiscordAlert, type DiscordAlert } from './discord'

export type { AlertLevel }

/** ops_alert_state key for the Irys funding-balance stream. */
export const FUNDING_ALERT_KEY = 'funding_balance'

// TODO tune (see README "Treasury monitor"). Deliberately GENEROUS: an Irys
// top-up takes 120+ seconds to confirm and the operator checks in roughly
// daily, so the first alert has to land while there is still comfortable
// runway. Tightening these to "a few rolls left" recreates the 503 it exists
// to prevent.
export const ALERT_THRESHOLD_LOW_ROLLS = 20 // "top up soon"  — days of runway
export const ALERT_THRESHOLD_CRITICAL_ROLLS = 5 // "top up today"

/**
 * Headroom is quoted in worst-case rolls: the largest RollSize (rolls/config.ts)
 * so the number is never optimistic. Keep in sync if a bigger size is added.
 */
const HEADROOM_FRAMES_PER_ROLL = 24

const LAMPORTS_PER_SOL = 1_000_000_000n

/** Ordering for healthy < low < critical, so a change can be read as a direction. */
const LEVEL_RANK: Record<AlertLevel, number> = { healthy: 0, low: 1, critical: 2 }

export interface FundingSnapshot {
  /** The provider read, exactly as GET /funding/status returns it. */
  funding: FundingStatus
  balanceAtomic: string
  balanceSol: string
  /** Irys price for one typical frame — the cost basis funding/status uses. */
  perFrameAtomic: string
  perRollAtomic: string
  perRollSol: string
  /** Full rolls the balance still covers, rounded DOWN. */
  rollsRemaining: number
  level: AlertLevel
}

export interface MonitorDeps {
  env: Env
  alerts: OpsAlertStore
  /** Lazy: checks that need no Irys read must not pay to build the uploader. */
  getFunding: () => Promise<FundingProvider>
}

export interface FundingCheckResult {
  snapshot: FundingSnapshot
  previousLevel: AlertLevel
  /** True only when the level changed AND the alert was actually delivered. */
  posted: boolean
  /**
   * True when a level change went undelivered. Distinct from `!posted`, which
   * is also the normal quiet case of an unchanged level.
   */
  deliveryFailed: boolean
  /** One-line explanation for the log — why it posted, or why it stayed quiet. */
  note: string
}

/**
 * The single funding-balance read. Both GET /funding/status and the scheduled
 * handler go through here so there is exactly one balance query and one cost
 * basis in the codebase.
 *
 * Headroom assumption: FundingProvider.balanceStatus() prices "one typical
 * frame" (ESTIMATED_FRAME_BYTES, a conservative 3 MiB — rolls/config.ts), and
 * a roll is that price × 24 frames. It ignores the cover and the small
 * metadata JSONs, which is fine in the conservative direction: the 3 MiB
 * per-frame figure already overstates real frames by a wide margin, so the
 * headroom reported here is a floor, not an estimate.
 */
export async function readFundingSnapshot(funding: FundingProvider): Promise<FundingSnapshot> {
  const status = await funding.balanceStatus()
  const balance = parseAtomic(status.balanceAtomic, 'balance')
  const perFrame = parseAtomic(status.requiredAtomic, 'per-frame price')
  if (perFrame <= 0n) {
    // A zero price means the read is broken, not that storage is free —
    // dividing by it would report infinite headroom and silence the monitor.
    throw new Error(
      `Irys quoted ${status.requiredAtomic} atomic for ${status.anticipatedBytes} bytes — ` +
        'cannot derive roll headroom from a zero price.',
    )
  }

  const perRoll = perFrame * BigInt(HEADROOM_FRAMES_PER_ROLL)
  const rollsRemaining = Number(balance / perRoll) // BigInt division floors — conservative.

  return {
    funding: status,
    balanceAtomic: balance.toString(),
    balanceSol: formatSol(balance),
    perFrameAtomic: perFrame.toString(),
    perRollAtomic: perRoll.toString(),
    perRollSol: formatSol(perRoll),
    rollsRemaining,
    level: levelFor(rollsRemaining),
  }
}

export function levelFor(rollsRemaining: number): AlertLevel {
  if (rollsRemaining < ALERT_THRESHOLD_CRITICAL_ROLLS) return 'critical'
  if (rollsRemaining < ALERT_THRESHOLD_LOW_ROLLS) return 'low'
  return 'healthy'
}

/**
 * Funding-balance check with hysteresis: post ONLY when the severity level
 * changes against the last level recorded in D1. Re-posting the same level
 * every 6 hours is alert fatigue, and an operator who mutes the channel gets
 * no warning at all.
 */
export async function checkFundingBalance(deps: MonitorDeps): Promise<FundingCheckResult> {
  const funding = await deps.getFunding()
  const snapshot = await readFundingSnapshot(funding)
  const previous = await deps.alerts.get(FUNDING_ALERT_KEY)
  // No row yet reads as `healthy`: a first run at a healthy balance stays
  // quiet, but a first run already below a threshold IS a change and fires.
  const previousLevel: AlertLevel = previous?.last_level ?? 'healthy'
  const summary = describeSnapshot(snapshot)

  if (snapshot.level === previousLevel) {
    // Nothing to say. Still bump the row so updated_at proves the cron ran.
    await deps.alerts.record(FUNDING_ALERT_KEY, snapshot.level, summary)
    return {
      snapshot,
      previousLevel,
      posted: false,
      deliveryFailed: false,
      note: `level unchanged (${snapshot.level}) — nothing posted`,
    }
  }

  const delivery = await postDiscordAlert(deps.env, buildFundingAlert(snapshot, previousLevel))
  if (!delivery.ok) {
    // Deliberately do NOT advance last_level. The operator never saw this
    // crossing; recording it would mark the alert delivered and go quiet
    // forever. Leaving the old level makes the next cron run retry.
    console.error(
      `[ops] funding alert ${previousLevel} -> ${snapshot.level} NOT delivered (${delivery.error}) — ` +
        `state left at "${previousLevel}" so the next run retries.`,
    )
    return {
      snapshot,
      previousLevel,
      posted: false,
      deliveryFailed: true,
      note: `post FAILED (${delivery.error}) — will retry next run`,
    }
  }

  await deps.alerts.record(FUNDING_ALERT_KEY, snapshot.level, summary)
  return {
    snapshot,
    previousLevel,
    posted: true,
    deliveryFailed: false,
    note: `posted ${previousLevel} -> ${snapshot.level}`,
  }
}

export interface MonitorRunResult {
  checks: Array<{ key: string; ok: boolean; note: string }>
}

/**
 * Run every ops check. Each is isolated in its own try/catch so one failing
 * check never suppresses the others, and the caller (scheduled()) stays a thin
 * dispatcher. Future checks — treasury pending conversion, health — get added
 * here as another call.
 */
export async function runTreasuryMonitor(deps: MonitorDeps): Promise<MonitorRunResult> {
  const checks: MonitorRunResult['checks'] = []

  try {
    const result = await checkFundingBalance(deps)
    checks.push({
      // An undelivered alert is a failed check: the operator was not told.
      key: FUNDING_ALERT_KEY,
      ok: !result.deliveryFailed,
      note: `${result.note} · ~${result.snapshot.rollsRemaining} rolls, ~${result.snapshot.balanceSol} SOL`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ops] ${FUNDING_ALERT_KEY} check failed: ${message}`)
    checks.push({ key: FUNDING_ALERT_KEY, ok: false, note: message })
  }

  return { checks }
}

/** Compose the embed for a funding level crossing, in the crossing's direction. */
function buildFundingAlert(snapshot: FundingSnapshot, previousLevel: AlertLevel): DiscordAlert {
  const worsening = LEVEL_RANK[snapshot.level] > LEVEL_RANK[previousLevel]

  let title: string
  let description: string
  if (snapshot.level === 'critical') {
    title = 'Irys funding CRITICAL — top up today'
    description =
      `Storage funding covers about ${snapshot.rollsRemaining} more roll(s). ` +
      'Top up now: confirmation takes 120+ seconds, and once the balance runs short frame uploads fail with a 503.'
  } else if (snapshot.level === 'low') {
    title = worsening ? 'Irys funding low — top up soon' : 'Irys funding recovering — still low'
    description = worsening
      ? `Storage funding covers about ${snapshot.rollsRemaining} more roll(s). Plenty of runway left — top up ` +
        'at your convenience, ahead of demand, rather than in response to a failure.'
      : `Balance improved to about ${snapshot.rollsRemaining} roll(s) of headroom, but it is still below the ` +
        `low threshold of ${ALERT_THRESHOLD_LOW_ROLLS}. Keep watching.`
  } else {
    title = 'Irys funding recovered — healthy'
    description =
      `Top-up landed. Storage funding now covers about ${snapshot.rollsRemaining} roll(s) — back above the ` +
      `healthy threshold of ${ALERT_THRESHOLD_LOW_ROLLS}. No action needed.`
  }

  const fields = [
    { name: 'Rolls of headroom', value: `~${snapshot.rollsRemaining} (${HEADROOM_FRAMES_PER_ROLL}-frame rolls)` },
    { name: 'Balance', value: `~${snapshot.balanceSol} SOL` },
    { name: 'Balance (atomic)', value: snapshot.balanceAtomic },
    { name: 'Level', value: `${previousLevel} → ${snapshot.level}` },
    {
      name: 'Thresholds',
      value: `low < ${ALERT_THRESHOLD_LOW_ROLLS} rolls · critical < ${ALERT_THRESHOLD_CRITICAL_ROLLS} rolls`,
    },
    {
      name: 'Cost basis',
      value: `~${snapshot.perRollSol} SOL/roll (${snapshot.perFrameAtomic} atomic/frame × ${HEADROOM_FRAMES_PER_ROLL})`,
    },
  ]
  if (!snapshot.funding.sufficient) {
    // Past warning: the balance no longer covers even a single frame upload.
    fields.push({ name: 'Uploads', value: 'FAILING NOW — balance is short of one frame' })
  }

  return {
    severity: snapshot.level,
    title,
    description,
    // Only CRITICAL pings. Low and healthy post silently into the channel.
    mention: snapshot.level === 'critical',
    fields,
  }
}

/** Human-readable snapshot stored in ops_alert_state.last_value for context. */
function describeSnapshot(snapshot: FundingSnapshot): string {
  return `~${snapshot.rollsRemaining} rolls, ~${snapshot.balanceSol} SOL (${snapshot.balanceAtomic} atomic)`
}

/**
 * Atomic amounts arrive as strings from the Irys SDK's BigNumber. Integers in
 * practice; parsed defensively (truncating toward zero) so an unexpected
 * decimal or exponent form degrades to a conservative number instead of NaN.
 */
function parseAtomic(value: string, label: string): bigint {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed)
  const asNumber = Number(trimmed)
  if (!Number.isFinite(asNumber) || asNumber < 0) {
    throw new Error(`Irys returned an unparseable ${label}: "${value}"`)
  }
  return BigInt(Math.floor(asNumber))
}

/** Atomic (lamports) → SOL, truncated to 4 dp. Display only. */
function formatSol(atomic: bigint, decimals = 4): string {
  const whole = atomic / LAMPORTS_PER_SOL
  const fraction = (atomic % LAMPORTS_PER_SOL).toString().padStart(9, '0').slice(0, decimals)
  return `${whole}.${fraction}`
}

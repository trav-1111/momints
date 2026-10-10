// Operator dashboard data — three read-only, aggregate-only snapshots.
// Every exported function here returns COUNTS/SUMS/SPLITS, never a `wallet`
// field: that is the structural half of "aggregate only, no per-wallet
// profiling" (the other half is that no endpoint anywhere takes a wallet and
// answers "what has this wallet done" — see worker/README.md "Operator
// dashboard"). Composition only — every balance/fee read here reuses an
// existing, already-verified source (readFundingSnapshot, getWorkerPublicKey,
// deriveAta, fee_cache, ops_alert_state) rather than re-deriving any of them.
import { publicKey, type Umi } from '@metaplex-foundation/umi'
import type { OpsAlertStore, RollDb } from '../db'
import { ConfigError, type ValidatedEnv } from '../env'
import type { FeeCache } from '../fees/cache'
import type { FundingProvider } from '../providers/types'
import { deriveAta } from '../skr/ata'
import { SKR_MINT_ADDRESS } from '../skr/config'
import { getWorkerPublicKey } from '../solana/client'
import { getSolBalance, getTokenAccountBalance } from '../solana/confirm'
import { FUNDING_ALERT_KEY, readFundingSnapshot, type AlertLevel } from './monitor'
import type { JobHeartbeat, JobHeartbeatStore } from './heartbeat'

// Three narrow dependency shapes, one per function below — deliberately NOT
// one shared "DashboardDeps" bag: the three snapshots barely overlap in what
// they read (wallets needs RPC + Umi + funding; health and metrics need only
// D1/fee_cache/ops_alert_state), and a shared type would force callers to
// fill in fields a given handler never uses.

export interface WalletsDeps {
  env: ValidatedEnv
  rpcUrl: string
  treasuryAddress: string
  getUmi: () => Promise<Umi>
  getFunding: () => Promise<FundingProvider>
}

// ─── Wallets ────────────────────────────────────────────────────────────────

export interface WalletsSnapshot {
  generatedAt: string
  signer: {
    address: string
    solLamports: number
    turbo: { balanceAtomic: string; balanceCredits: string; rollsRemaining: number }
  }
  treasury: {
    address: string
    solLamports: number
    skr: { ata: string; atomic: string; uiAmount: number }
  }
}

export async function getWalletsSnapshot(deps: WalletsDeps): Promise<WalletsSnapshot> {
  const { env, rpcUrl, treasuryAddress, getUmi, getFunding } = deps
  const signerAddress = getWorkerPublicKey(env)

  const [signerSol, treasurySol, fundingSnapshot, umi] = await Promise.all([
    getSolBalance(rpcUrl, signerAddress),
    getSolBalance(rpcUrl, treasuryAddress),
    readFundingSnapshot(await getFunding()),
    getUmi(),
  ])

  // ATA derivation is pure local PDA math (skr/ata.ts, live-verified in the
  // $SKR round against the real treasury account) — sequential after the
  // parallel reads above only because it needs `umi`, not because it's slow.
  const treasurySkrAta = deriveAta(umi, publicKey(treasuryAddress), publicKey(SKR_MINT_ADDRESS)).toString()
  const skrBalance = await getTokenAccountBalance(rpcUrl, treasurySkrAta)

  return {
    generatedAt: new Date().toISOString(),
    signer: {
      address: signerAddress,
      solLamports: signerSol,
      turbo: {
        balanceAtomic: fundingSnapshot.balanceAtomic,
        balanceCredits: fundingSnapshot.balanceCredits,
        rollsRemaining: fundingSnapshot.rollsRemaining,
      },
    },
    treasury: {
      address: treasuryAddress,
      solLamports: treasurySol,
      skr: {
        ata: treasurySkrAta,
        atomic: skrBalance?.amount ?? '0',
        uiAmount: skrBalance ? Number(skrBalance.amount) / 10 ** skrBalance.decimals : 0,
      },
    },
  }
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface HealthSnapshot {
  generatedAt: string
  crons: {
    /** fee_cache's own attempt bookkeeping — see fees/cache.ts's recordSuccess/recordFailedAttempt doc comments. */
    feeRecompute: {
      lastAttemptAt: string | null
      lastAttemptOk: boolean
      lastAttemptNote: string | null
      computedAt: string
    }
    /** Real attempt timestamp; funding level is the last delivered alert state. */
    treasuryMonitorAndSweep: { lastRunAt: string | null; level: AlertLevel }
    jobs: JobHeartbeat[]
  }
  notifications: { discordWebhookConfigured: boolean; lastAlertStateAt: string | null }
  quickMints: { deferredPendingRecovery: number; dead: number }
  quickRecovery: { unknown: number; confirmed: number; rejected: number; review: number }
  rolls: { stuckHandoffs: number }
  fees: {
    quickFeeLamports: number
    rollFee12Lamports: number
    rollFee24Lamports: number
    computedAt: string
    lastGood: boolean
    rentLamportsPerByte: number | null
  }
}

export interface HealthDeps {
  db: RollDb
  feeCache: FeeCache
  opsAlerts: OpsAlertStore
  jobs: JobHeartbeatStore
  discordWebhookConfigured: boolean
}

export async function getHealthSnapshot(deps: HealthDeps): Promise<HealthSnapshot> {
  const { db, feeCache, opsAlerts } = deps

  const [feeRow, alertState, quickCounts, deferred, stuckHandoffs, jobs, quickRecovery] = await Promise.all([
    feeCache.get(),
    opsAlerts.get(FUNDING_ALERT_KEY),
    db.getQuickMintCounts(null),
    db.getDeferredQuickMintCount(),
    db.getStuckRollHandoffCount(),
    deps.jobs.list(),
    db.getQuickRecoveryCounts(),
  ])
  if (!feeRow) {
    throw new ConfigError('fee_cache has no row — re-run migrations (0007_fee_cache.sql seeds it).')
  }

  const dead = sumWhere(
    quickCounts,
    (c) => c.status === 'DEAD',
    (c) => c.count,
  )

  return {
    generatedAt: new Date().toISOString(),
    crons: {
      feeRecompute: {
        lastAttemptAt: feeRow.lastAttemptAt,
        lastAttemptOk: feeRow.lastAttemptOk,
        lastAttemptNote: feeRow.lastAttemptNote,
        computedAt: feeRow.computedAt,
      },
      treasuryMonitorAndSweep: {
        lastRunAt: jobs.find((job) => job.job === 'treasury-monitor')?.last_attempt_at ?? null,
        level: alertState?.last_level ?? 'healthy',
      },
      jobs,
    },
    notifications: {
      discordWebhookConfigured: deps.discordWebhookConfigured,
      lastAlertStateAt: alertState?.updated_at ?? null,
    },
    quickMints: { deferredPendingRecovery: deferred, dead },
    quickRecovery,
    rolls: { stuckHandoffs },
    fees: {
      quickFeeLamports: feeRow.quickFeeLamports,
      rollFee12Lamports: feeRow.rollFee12Lamports,
      rollFee24Lamports: feeRow.rollFee24Lamports,
      computedAt: feeRow.computedAt,
      lastGood: feeRow.lastGood,
      rentLamportsPerByte: feeRow.rentLamportsPerByte,
    },
  }
}

// ─── Metrics (aggregate only) ───────────────────────────────────────────────

export type MetricsWindow = 'all' | '7d' | '30d'

export interface MetricsSnapshot {
  generatedAt: string
  window: MetricsWindow
  mints: { total: number; quick: number; roll: number }
  rolls: { created: number; avgFramesPerRoll: number }
  /** Never summed together — SOL and $SKR are different units at different values. */
  fees: { sol: { totalLamports: number; count: number }; skr: { totalAtomic: number; count: number } }
  paymentSplit: { solCount: number; skrCount: number; solPct: number; skrPct: number }
  /** A single number. Not a list, not drill-downable — see this module's top doc comment. */
  uniqueWallets: number
  mintsOverTime: { day: string; quick: number; roll: number; total: number }[]
}

const WINDOW_DAYS: Record<'7d' | '30d', number> = { '7d': 7, '30d': 30 }
/** The mints-over-time chart always covers this many days regardless of the `window` selector — a shorter, fixed lookback keeps the chart readable even when `window=all`. */
const MINTS_OVER_TIME_DAYS = 30

function sinceIsoFor(window: MetricsWindow): string | null {
  if (window === 'all') return null
  return new Date(Date.now() - WINDOW_DAYS[window] * 24 * 60 * 60 * 1000).toISOString()
}

function sumWhere<T>(rows: T[], pred: (row: T) => boolean, pick: (row: T) => number): number {
  return rows.filter(pred).reduce((sum, row) => sum + pick(row), 0)
}

export interface MetricsDeps {
  db: RollDb
}

export async function getMetricsSnapshot(deps: MetricsDeps, window: MetricsWindow): Promise<MetricsSnapshot> {
  const { db } = deps
  const sinceIso = sinceIsoFor(window)
  const mintsOverTimeSince = new Date(Date.now() - MINTS_OVER_TIME_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [quickCounts, rollCounts, solFees, skrFees, uniqueWallets, quickPerDay, rollPerDay] = await Promise.all([
    db.getQuickMintCounts(sinceIso),
    db.getRollCounts(sinceIso),
    db.getTreasuryFeeTotals(sinceIso),
    db.getSkrFeeTotals(sinceIso),
    db.getUniqueWalletCount(sinceIso),
    db.getQuickMintsPerDay(mintsOverTimeSince),
    db.getRollFramesPerDay(mintsOverTimeSince),
  ])

  const quickTotal = sumWhere(
    quickCounts,
    (c) => c.status === 'FINALIZED',
    (c) => c.count,
  )
  const quickSolCount = sumWhere(
    quickCounts,
    (c) => c.status === 'FINALIZED' && c.feeCurrency === 'SOL',
    (c) => c.count,
  )
  const quickSkrCount = sumWhere(
    quickCounts,
    (c) => c.status === 'FINALIZED' && c.feeCurrency === 'SKR',
    (c) => c.count,
  )

  const rollsCreated = sumWhere(
    rollCounts,
    () => true,
    (c) => c.count,
  )
  const rollFramesTotal = sumWhere(
    rollCounts,
    () => true,
    (c) => c.framesMinted,
  )
  const rollSolCount = sumWhere(
    rollCounts,
    (c) => c.feeCurrency === 'SOL',
    (c) => c.count,
  )
  const rollSkrCount = sumWhere(
    rollCounts,
    (c) => c.feeCurrency === 'SKR',
    (c) => c.count,
  )

  const solLamportsTotal = sumWhere(
    solFees,
    () => true,
    (f) => f.totalLamports,
  )
  const solCountTotal = sumWhere(
    solFees,
    () => true,
    (f) => f.count,
  )
  const skrAtomicTotal = skrFees.quickTotalAtomic + skrFees.rollTotalAtomic
  const skrCountTotal = skrFees.quickCount + skrFees.rollCount

  // Payment-method split is over PAYMENT EVENTS (a quick mint or a roll
  // creation each pay their fee exactly once), not over roll FRAMES — a
  // 24-frame $SKR roll must count as one $SKR payment, not 24.
  const solCount = quickSolCount + rollSolCount
  const skrCount = quickSkrCount + rollSkrCount
  const paymentTotal = solCount + skrCount

  const dayMap = new Map<string, { quick: number; roll: number }>()
  for (const { day, count } of quickPerDay) {
    const entry = dayMap.get(day) ?? { quick: 0, roll: 0 }
    entry.quick += count
    dayMap.set(day, entry)
  }
  for (const { day, count } of rollPerDay) {
    const entry = dayMap.get(day) ?? { quick: 0, roll: 0 }
    entry.roll += count
    dayMap.set(day, entry)
  }
  const mintsOverTime = [...dayMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, { quick, roll }]) => ({ day, quick, roll, total: quick + roll }))

  return {
    generatedAt: new Date().toISOString(),
    window,
    mints: { total: quickTotal + rollFramesTotal, quick: quickTotal, roll: rollFramesTotal },
    rolls: { created: rollsCreated, avgFramesPerRoll: rollsCreated > 0 ? rollFramesTotal / rollsCreated : 0 },
    fees: {
      sol: { totalLamports: solLamportsTotal, count: solCountTotal },
      skr: { totalAtomic: skrAtomicTotal, count: skrCountTotal },
    },
    paymentSplit: {
      solCount,
      skrCount,
      solPct: paymentTotal > 0 ? Math.round((solCount / paymentTotal) * 1000) / 10 : 0,
      skrPct: paymentTotal > 0 ? Math.round((skrCount / paymentTotal) * 1000) / 10 : 0,
    },
    uniqueWallets,
    mintsOverTime,
  }
}

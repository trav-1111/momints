-- Ops alerting state for the scheduled treasury monitor (src/ops/monitor.ts).
--
-- One row per alert stream. Each cron run computes a severity level and
-- compares it against last_level: Discord is posted ONLY when the level
-- CHANGES. Without this table every run at a low balance would re-post the
-- same warning, and an operator who learns to ignore the channel is worse off
-- than one with no channel at all.
--
-- READ-AND-NOTIFY ONLY. Nothing keyed here moves, signs for, or funds anything.
CREATE TABLE IF NOT EXISTS ops_alert_state (
  -- Alert stream key, e.g. 'funding_balance'. Future checks (treasury pending,
  -- health) add a ROW here, not a table.
  alert_key  TEXT PRIMARY KEY,
  last_level TEXT NOT NULL CHECK (last_level IN ('healthy', 'low', 'critical')),
  -- Human-readable snapshot of the reading behind this level, so the table is
  -- worth eyeballing directly (e.g. '~37 rolls, ~0.4821 SOL').
  last_value TEXT,
  -- Bumped on every run, changed level or not: a stale updated_at means the
  -- cron itself stopped running.
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

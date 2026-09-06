-- $SKR fee payment: pay the mint fee in $SKR at a 15% discount off the
-- cost-plus SOL fee, via a Worker-issued-and-stored Jupiter quote. Rent stays
-- SOL always — only the FEE can move in $SKR. See fees/config.ts's
-- SKR_DISCOUNT and skr/quote.ts for the computation, quick/verify.ts and
-- rolls/verify.ts for the on-chain check.
--
-- fee_currency defaults 'SOL' for every existing row and every new SOL
-- payment — only two TS call sites ever write 'SKR', so validation lives in
-- code rather than a CHECK constraint here (SQLite's ALTER TABLE ADD COLUMN
-- CHECK support is narrower than CREATE TABLE's).

ALTER TABLE quick_mints ADD COLUMN fee_currency TEXT NOT NULL DEFAULT 'SOL';
-- Set together at quote time (skr/quote.ts) — the exact amount finalize
-- verifies against, and the deadline past which that quote is refused.
ALTER TABLE quick_mints ADD COLUMN skr_quote_atomic INTEGER;
ALTER TABLE quick_mints ADD COLUMN skr_quote_expires_at TEXT;

ALTER TABLE rolls ADD COLUMN fee_currency TEXT NOT NULL DEFAULT 'SOL';
-- The atomic $SKR amount actually verified for this roll — audit trail only
-- (rolls, unlike quick_mints, has no separate treasury ledger entry for a
-- $SKR fee; see providers/treasury/manual.ts's doc comment on why).
ALTER TABLE rolls ADD COLUMN skr_fee_atomic INTEGER;

-- A roll doesn't exist yet at quote time, so its quote can't live on a roll
-- row the way a quick mint's lives on its staged row. One slot per wallet —
-- same shape as the single-open-roll invariant (0001_init.sql) — because a
-- wallet can only be about to pay for one roll at a time. Consumed (deleted)
-- by rolls/create.ts on successful verification, so a quote can never be
-- replayed against a second roll.
CREATE TABLE IF NOT EXISTS skr_quotes (
  wallet            TEXT PRIMARY KEY,
  size              INTEGER NOT NULL,
  skr_amount_atomic INTEGER NOT NULL,
  sol_fee_lamports  INTEGER NOT NULL,
  treasury_ata      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

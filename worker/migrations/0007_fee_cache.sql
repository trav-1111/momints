-- Cost-plus fee cache (worker/src/fees/*). Fees are computed from LIVE rent +
-- storage cost every 3h (a cron separate from the treasury monitor's 6h one —
-- see [triggers] in wrangler.toml) and cached here so the mint flow reads a
-- fast D1 row instead of computing live on every request.
--
-- Singleton row (id is always 1): quick/roll12/roll24 are computed together
-- from the SAME rent + storage reading each cycle, so they are cached
-- together. A failed or rejected recompute (see fees/compute.ts Guards 2/3)
-- must NEVER overwrite the served fee columns — it only updates the
-- last_attempt_* columns, so a bad or unreachable read can never zero a fee
-- or block minting. That is what last_good records: whether the currently
-- SERVED values came from a real validated computation.
CREATE TABLE IF NOT EXISTS fee_cache (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),

  -- ---- Served fees — what the mint flow actually reads ----
  quick_fee_lamports         INTEGER NOT NULL,
  roll_fee_12_lamports       INTEGER NOT NULL,
  roll_fee_24_lamports       INTEGER NOT NULL,

  -- ---- Inputs the served fees above were derived from ----
  -- NULL on the seed row below: those fees came from the old flat constants,
  -- not a live computation, so there are no real inputs to record yet.
  rent_lamports_per_byte     INTEGER,
  -- Rent for one roll-frame Core asset, at rent_lamports_per_byte. Feeds
  -- roll_fee_12/24 directly (see fees/compute.ts).
  rent_frame_lamports        INTEGER,
  -- Reference only, per the feature spec ("for reference") — NOT used in any
  -- fee formula. A quick mint's asset rent is paid by the user's own wallet,
  -- never the operator.
  rent_quick_asset_lamports  INTEGER,
  -- Turbo's live quote (converted winc -> lamports) for one ESTIMATED_FRAME_BYTES
  -- ceiling image. Feeds both roll_fee_* (per frame) and quick_fee (alone).
  storage_cost_lamports      INTEGER,
  -- SOL/USD used to convert the USD-intent floor/ceiling guard bounds to
  -- lamports this cycle (Guard 1) and to derive the $SKR discount target
  -- exposed by GET /fees. Not used in the fee formula itself.
  sol_usd_price               REAL,

  -- Whether the served columns above came from a real validated computation
  -- (vs. the bootstrap seed row inserted below). Always 1 once the first
  -- recompute succeeds — this table never stores an unvalidated fee.
  last_good                   INTEGER NOT NULL DEFAULT 1 CHECK (last_good IN (0, 1)),
  computed_at                  TEXT NOT NULL,

  -- ---- Most recent recompute ATTEMPT, success or failure ----
  -- Distinct from computed_at: a failed attempt updates these three columns
  -- only, leaving the served fees above untouched (Guard 3). A stale
  -- last_attempt_at vs. now is the same "the cron stopped running" signal
  -- ops_alert_state.updated_at gives the treasury monitor.
  last_attempt_at              TEXT,
  last_attempt_ok              INTEGER NOT NULL DEFAULT 1 CHECK (last_attempt_ok IN (0, 1)),
  last_attempt_note            TEXT
);

-- Bootstrap seed: guarantees a row exists before the first cron tick, at the
-- SAME prices already live (rolls/config.ts, quick/config.ts) — so deploying
-- this migration causes no price jump, and Guard 3's "minting always has a
-- valid cached fee to read" holds from the moment the migration applies.
INSERT OR IGNORE INTO fee_cache
  (id, quick_fee_lamports, roll_fee_12_lamports, roll_fee_24_lamports, last_good, computed_at, last_attempt_note)
VALUES
  (1, 6500000, 85000000, 165000000, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   'seeded from the static pre-cost-plus constants at migration time — not a live computation');

-- Quick-mint fee quoted and persisted at STAGE time. Finalize/verify checks
-- payment against THIS value, never a live re-read of fee_cache — the fee can
-- move (recompute every 3h) between staging an image and the user's wallet
-- landing the payment, and a legitimate payment must never be rejected for a
-- price that moved out from under it after it was quoted. Nullable: rows
-- staged before this migration have no value; finalize falls back to a
-- hardcoded legacy default for those (see quick/finalize.ts's
-- LEGACY_QUICK_FEE_LAMPORTS_FALLBACK).
ALTER TABLE quick_mints ADD COLUMN fee_lamports_required INTEGER;

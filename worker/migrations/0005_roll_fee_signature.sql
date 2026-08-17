-- Roll fee verification checkpoint.
--
-- Rolls previously trusted `feeSignature` as bookkeeping-only text — nothing
-- verified it on-chain before the Worker spent its own funds on a cover
-- upload, a metadata upload, and a collection creation. rolls/create.ts now
-- verifies the payment against the landed transaction (rolls/verify.ts)
-- before any of that spend happens, mirroring the quick-mint flow.
--
-- The UNIQUE index is what makes that hold under replay: one payment buys
-- exactly one roll. Existing rows have no fee_signature (NULL), and SQLite's
-- UNIQUE index treats multiple NULLs as non-conflicting, so backfill is not
-- required.
ALTER TABLE rolls ADD COLUMN fee_signature TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rolls_fee_signature ON rolls (fee_signature);

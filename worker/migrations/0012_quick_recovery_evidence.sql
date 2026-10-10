ALTER TABLE quick_mints ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE quick_mints ADD COLUMN recovery_reason TEXT;
ALTER TABLE quick_mints ADD COLUMN verify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quick_mints ADD COLUMN last_verify_at TEXT;
UPDATE quick_mints SET payment_state = 'CONFIRMED' WHERE status IN ('FINALIZING','FINALIZED');
-- Existing DEAD/unsigned rows remain UNKNOWN: age or an asset signature alone
-- must not retroactively be presented as proof of a paid/failed transaction.

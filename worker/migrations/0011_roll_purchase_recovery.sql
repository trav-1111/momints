-- New quotes pin the server's price before payment; they are immutable and
-- remain available to verify a timely payment after a client/network outage.
CREATE TABLE roll_purchase_quotes (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, size INTEGER NOT NULL,
  currency TEXT NOT NULL, amount INTEGER NOT NULL, treasury_ata TEXT,
  auth_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);

-- One verified receipt and one in-progress creation per wallet. Checkpoints
-- contain public signed transactions, never a collection or funding secret.
CREATE TABLE roll_creations (
  fee_signature TEXT PRIMARY KEY, wallet TEXT NOT NULL,
  data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  lease_owner TEXT, lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_roll_creations_wallet_pending ON roll_creations(wallet) WHERE status = 'PENDING';
ALTER TABLE rolls ADD COLUMN film_stock_id TEXT;
ALTER TABLE rolls ADD COLUMN film_mode TEXT;
ALTER TABLE rolls ADD COLUMN aspect TEXT;
ALTER TABLE rolls ADD COLUMN fee_lamports INTEGER;
ALTER TABLE rolls ADD COLUMN close_reason TEXT;
ALTER TABLE rolls ADD COLUMN closed_at TEXT;
ALTER TABLE rolls ADD COLUMN closed_by TEXT;

-- Roll receipt bookkeeping can be retried after a lost response without
-- duplicating revenue. Older entries keep their existing audit trail.
ALTER TABLE treasury_entries ADD COLUMN receipt_key TEXT;
UPDATE treasury_entries SET receipt_key = 'roll:' || json_extract(context, '$.feeSignature')
WHERE json_extract(context, '$.kind') = 'roll_fee'
  AND json_extract(context, '$.feeSignature') IS NOT NULL
  AND id IN (SELECT MIN(id) FROM treasury_entries WHERE json_extract(context, '$.kind') = 'roll_fee' GROUP BY json_extract(context, '$.feeSignature'));
CREATE UNIQUE INDEX idx_treasury_receipt_key ON treasury_entries(receipt_key) WHERE receipt_key IS NOT NULL;

CREATE TABLE job_heartbeats (
  job TEXT PRIMARY KEY, last_attempt_at TEXT NOT NULL,
  last_success_at TEXT, last_attempt_ok INTEGER,
  failure_code TEXT
);

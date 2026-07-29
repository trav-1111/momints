-- Momints roll backend — initial D1 schema.
-- Rolls, per-frame mint checkpoints, and treasury bookkeeping.

CREATE TABLE IF NOT EXISTS rolls (
  -- Metaplex Core collection address (base58). Known before send (signer is
  -- generated client-side of the RPC), persisted only after confirmation.
  collection_address TEXT PRIMARY KEY,
  wallet             TEXT NOT NULL,
  -- `yyyy-mm-dd.NN` — NN is the 2-digit same-day roll index for this wallet.
  name               TEXT NOT NULL,
  size               INTEGER NOT NULL CHECK (size IN (12, 24)),
  -- Vanity display name (user-editable at creation, sanitized).
  artist             TEXT NOT NULL,
  -- Verified SKR handle or wallet address. Immutable — provenance/truth.
  skr_identity       TEXT NOT NULL,
  cover_uri          TEXT NOT NULL,
  metadata_uri       TEXT NOT NULL,
  minted_count       INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETE')),
  create_signature   TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- HARD RULE: at most one OPEN roll per wallet. The create path checks first
-- for a friendly error; this index makes the rule hold under races too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rolls_one_open_per_wallet
  ON rolls (wallet) WHERE status = 'OPEN';

-- Same-day roll numbering must never collide per wallet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rolls_wallet_name ON rolls (wallet, name);

-- Per-frame mint checkpoint. A frame walks IMAGE_UPLOADED -> METADATA_UPLOADED
-- -> MINT_PENDING -> MINTED; an interrupted roll resumes from the last
-- completed step without re-uploading or re-minting (the resume path is
-- load-bearing — see README).
CREATE TABLE IF NOT EXISTS frames (
  collection_address TEXT NOT NULL REFERENCES rolls (collection_address),
  frame_index        INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (
    status IN ('IMAGE_UPLOADED', 'METADATA_UPLOADED', 'MINT_PENDING', 'MINTED')
  ),
  image_uri          TEXT,
  metadata_uri       TEXT,
  -- Set at MINT_PENDING (before send) so a confirm timeout can be resolved on
  -- resume by checking the chain instead of blindly re-minting.
  asset_address      TEXT,
  mint_signature     TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (collection_address, frame_index)
);

-- Treasury bookkeeping (ManualSink). Accrued roll fees recorded as
-- "conversion pending"; the operator runs the SOL -> $SKR conversion by hand
-- and marks rows CONVERTED (see README runbook). No auto-swap in this build.
CREATE TABLE IF NOT EXISTS treasury_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_lamports INTEGER NOT NULL,
  -- JSON context: { kind, collection, wallet, size, feeSignature? }
  context         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'CONVERSION_PENDING'
                  CHECK (status IN ('CONVERSION_PENDING', 'CONVERTED')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  converted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_treasury_status ON treasury_entries (status);

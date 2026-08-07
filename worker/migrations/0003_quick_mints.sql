-- Quick-mint fee flow: placeholder URI -> verified fee -> Arweave -> real URI.
--
-- A quick shot is ONE user signature that both mints a Core asset against the
-- static placeholder metadata and transfers the fee to the treasury. This table
-- is the checkpoint ledger for everything that happens after: it is written at
-- stage time (before any money moves), advanced only once the Worker has
-- VERIFIED the fee-paying transaction on-chain, and drained by the finalize
-- queue consumer.
--
-- TREASURY-SAFETY INVARIANT: no Arweave spend without a confirmed, fee-paying
-- mint already on-chain. The two UNIQUE constraints below are what make that
-- hold under replay — see the column comments.

CREATE TABLE IF NOT EXISTS quick_mints (
  -- uuid, minted at stage time and handed to the client as `stagingKey`.
  id             TEXT PRIMARY KEY,
  wallet         TEXT NOT NULL,
  -- Client-supplied NFT metadata, sanitized at stage. Held here (it is a few
  -- KB) rather than in R2 so the consumer needs exactly one blob read.
  -- Its `image` field is injected by the consumer after the image uploads.
  metadata_json  TEXT NOT NULL,
  -- R2 key for the staged image bytes. Cleared once the object is deleted.
  staging_key    TEXT,
  -- Image MIME, kept here rather than read back off the R2 object: a resumed
  -- job whose image already uploaded never touches R2 again, but still has to
  -- write the type into the metadata's properties.files entry.
  mime           TEXT NOT NULL,

  -- Set at finalize, from the VERIFIED transaction — never from client claims.
  -- UNIQUE on both: one payment buys exactly one upload. Without these, the
  -- same landed fee transfer could be replayed against a second staged image.
  asset_address  TEXT UNIQUE,
  signature      TEXT UNIQUE,

  -- Resume checkpoints. Set but not FINALIZED means the permanent bytes are
  -- already paid for and only the on-chain URI swap needs re-running; the
  -- consumer must never re-upload past these.
  image_uri      TEXT,
  arweave_uri    TEXT,

  --   STAGED     image in R2, nothing paid, nothing minted. Reaped after 24h.
  --   FINALIZING fee verified on-chain, asset minted on the placeholder,
  --              finalize job enqueued. The only state that may spend Arweave.
  --   FINALIZED  real URI live on-chain, update authority handed to the owner.
  --   DEAD       dead-lettered; a PAID mint stuck on the placeholder. Always
  --              recoverable (the fee was collected) — operator re-drives it.
  status         TEXT NOT NULL CHECK (status IN ('STAGED', 'FINALIZING', 'FINALIZED', 'DEAD')),

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finalized_at   TEXT
);

-- Drives the per-wallet daily stage cap (the only brake on an endpoint that is
-- deliberately unauthenticated, because staging cannot cost Arweave).
CREATE INDEX IF NOT EXISTS idx_quick_mints_wallet_created ON quick_mints (wallet, created_at);

-- Orphan sweep (STAGED older than a day) and operator triage of DEAD rows.
CREATE INDEX IF NOT EXISTS idx_quick_mints_status ON quick_mints (status);

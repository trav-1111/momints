-- Per-frame mint lock.
--
-- mintFrame() is designed so a *sequential* re-POST of a frame is safe (it
-- checkpoints in D1 and checks the chain before ever re-sending), but nothing
-- stopped two *concurrent* requests for the same frame from both reading the
-- same pre-mint checkpoint and each building/sending their own create() Core
-- transaction into the collection. That happened in practice: a client
-- navigation left an original frame request running in the background, and a
-- later retry raced it, producing two competing on-chain transactions and an
-- mpl-core "Error deserializing account" failure.
--
-- Kept as its own table rather than a column on `frames` so a lock can be
-- claimed before a frame's very first checkpoint row exists (frames rows are
-- only created once the image upload finishes), without touching that
-- table's status CHECK constraint.
CREATE TABLE IF NOT EXISTS frame_locks (
  collection_address TEXT NOT NULL,
  frame_index         INTEGER NOT NULL,
  locked_at           TEXT NOT NULL,
  PRIMARY KEY (collection_address, frame_index)
);

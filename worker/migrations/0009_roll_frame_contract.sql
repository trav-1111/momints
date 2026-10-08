-- Roll mutation bearer capabilities and Worker-derived frame artifact data.
-- Existing rows remain protocol v1 so rollout code can distinguish them;
-- every newly created roll is explicitly inserted as protocol v2.

ALTER TABLE rolls ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rolls ADD COLUMN auth_hash TEXT;

ALTER TABLE frames ADD COLUMN mime TEXT;
ALTER TABLE frames ADD COLUMN byte_length INTEGER;
ALTER TABLE frames ADD COLUMN width INTEGER;
ALTER TABLE frames ADD COLUMN height INTEGER;
ALTER TABLE frames ADD COLUMN image_hash TEXT;

-- Worker-derived receipt for the staged quick image. Nullable for stages
-- created by builds predating the permanent-image artifact contract.

ALTER TABLE quick_mints ADD COLUMN byte_length INTEGER;
ALTER TABLE quick_mints ADD COLUMN width INTEGER;
ALTER TABLE quick_mints ADD COLUMN height INTEGER;
ALTER TABLE quick_mints ADD COLUMN image_hash TEXT;

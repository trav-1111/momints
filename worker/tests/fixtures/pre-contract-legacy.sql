INSERT INTO rolls (
  collection_address, wallet, name, size, artist, skr_identity,
  cover_uri, metadata_uri, minted_count, status, create_signature,
  handoff_signature, fee_signature, fee_currency, skr_fee_atomic
) VALUES (
  '22222222222222222222222222222222',
  '33333333333333333333333333333333',
  '2026-09-30.01', 12, 'Legacy Artist', 'legacy-identity',
  'https://arweave.net/legacy-cover',
  'https://arweave.net/legacy-metadata',
  1, 'OPEN', 'legacy-create-signature', NULL, NULL, 'SOL', NULL
);

INSERT INTO frames (
  collection_address, frame_index, status, image_uri, metadata_uri,
  asset_address, mint_signature
) VALUES (
  '22222222222222222222222222222222', 1, 'MINTED',
  'https://arweave.net/legacy-image',
  'https://arweave.net/legacy-frame-metadata',
  '44444444444444444444444444444444', 'legacy-frame-signature'
);

INSERT INTO quick_mints (
  id, wallet, metadata_json, staging_key, mime, asset_address, signature,
  image_uri, arweave_uri, status, fee_lamports_required, fee_currency,
  skr_quote_atomic, skr_quote_expires_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '55555555555555555555555555555555',
  '{"name":"Legacy quick"}', 'quick-staging/legacy.jpg', 'image/jpeg',
  NULL, NULL, NULL, NULL, 'STAGED', 6500000, 'SOL', NULL, NULL
);

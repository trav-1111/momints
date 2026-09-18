# Filmstocks

This is the implementation contract for the versioned filmstock system. It supersedes the purchase/D1 entitlement proposal in `LOMO_FILMSTOCK_PLAN.md`.

## Identity and access

- A visual recipe has one immutable, versioned `filmStockId`, such as `momints-bw-v1`.
- A downloaded recipe is never proof of access.
- House films are always eligible.
- A rotating stock is eligible for a new roll only while a catalogue fetched in the last 24 hours says it is stocked, or when it is unlocked.
- Quick Shoot permits only house and unlocked stocks.
- An active roll remains pinned to its `filmStockId`, including after rotation and while offline.

The app caches catalogue and unlock results for offline UX. They are reconstructible caches, not authoritative entitlements.

## Developed-roll proof

Roll collection metadata contains immutable `creatorAddress`, `filmStockId`, and `exposures` attributes. The collection URI is backed by Arweave and protected with Core's `ImmutableMetadata` plugin.

`COMPLETE` in the existing Worker database is not sufficient proof because it also represents an explicitly abandoned partial roll. When and only when `minted_count === size`, the Worker adds its own `verified: true` signature to the collection's Core `VerifiedCreators` plugin. Only that signing identity can unverify the signature. It then revokes its scoped Update Delegate. If marker creation fails, delegate revocation does not run and the existing sweep retries the operation.

`POST /v1/filmstocks/unlocked` queries DAS for collections carrying that verified Momints signature, reads their immutable Arweave metadata, matches `creatorAddress`, rejects unknown IDs, and returns distinct IDs. It does not write a wallet-to-film record. Frame ownership is not considered, so transferring a photograph does not remove the original creator's unlock.

Legacy completed rolls created before this marker cannot prove a non-house film unlock automatically. Do not weaken the scan to accept arbitrary metadata; migrate legacy collections with an explicit owner-authorized flow if that becomes necessary.

## Catalogue and recipes

The version-controlled catalogue is `worker/src/filmstocks/catalogue.ts`. Recipe assets live under `worker/filmstock-assets/` before upload to the `momints-filmstocks` R2 bucket. Public delivery is through the Worker's immutable asset route:

```text
GET  /v1/filmstocks
GET  /v1/filmstocks/assets/<immutable-key>
POST /v1/filmstocks/unlocked
```

The initial engine accepts declarative schema version 1 recipes with an exact 4x5 colour matrix. It executes no downloaded code. Adding grain, LUT, halation, bloom, tone-curve, or texture operations requires a new processing-engine version and compatibility tests before a catalogue item can require that version.

Publish an asset with Wrangler, preserving the versioned object key:

```powershell
cd worker
npx wrangler r2 bucket create momints-filmstocks
npx wrangler r2 object put momints-filmstocks/recipes/momints-color-v1.json --file filmstock-assets/recipes/momints-color-v1.json --content-type application/json --remote
```

Never overwrite an existing recipe or texture with visually different bytes. Publish the changed look under a new ID, add new immutable asset keys, validate on supported devices, then add the catalogue entry and deploy the Worker.

`npm run validate:filmstocks` checks every staged asset against `filmstock-assets/immutable-lock.json`; `npm run deploy` runs that guard before Wrangler. Adding a genuinely new ID requires adding its initial hash to the lock in the same reviewed change.

## Privacy

R2 contains recipes, textures, and promotional previews only. Filmstock endpoints store no profiles, wallets, entitlements, active rolls, photographs, thumbnails, or processing results. Unlock requests are rate-limited and responses are `private, no-store`; wallet addresses remain in the POST body rather than the URL. All photograph processing stays on-device.

The app's encrypted active-roll vault is a separate recovery feature. It retains the one active roll until independent permanent-image and developed-marker verification succeeds, then deletes it under the existing vault policy.

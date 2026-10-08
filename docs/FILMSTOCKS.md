# Filmstocks

This is the implementation and publishing contract for Momints' versioned filmstock system. It supersedes the purchase/D1 entitlement proposal in `LOMO_FILMSTOCK_PLAN.md`.

## Identity and access

- A visual recipe has one immutable, versioned `filmStockId`, such as `amber-200-v1`.
- A materially changed look receives a new ID. Display copy and rotation windows may change without changing the ID.
- A downloaded package is never proof of access.
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

On an existing installation, earned unlocks are persisted per wallet. Refreshes merge reconstructed unlocks into that wallet's saved set rather than replacing it: temporary DAS indexing or Arweave metadata gaps must not remove an earned film. This also preserves unlocks earned while a refresh is pending. Changing wallets or disconnecting does not grant access to another wallet's saved films. A fresh installation still depends on backend reconstruction.

For Core collections, the DAS developed marker is `plugins.verified_creators.data.signatures`. The top-level `creators` array describes royalty creators and must not substitute for the Worker's verified developed signature. Read-only production checks on 2 October 2026 found both completed test rolls correctly indexed with the marker in the plugin; the earlier scan checked the wrong field and returned no unlocks.

The deployed Worker can receive HTTP 403 from the public Arweave gateway even when the same JSON is available elsewhere. When the collection has both the verified Momints marker and `ImmutableMetadata`, the scan uses the permanent JSON attributes already indexed by DAS. It still checks the Arweave URI, original shooter and known film. Without immutable indexed attributes it reads the gateway; transport/HTTP/JSON failures return a retryable 502 rather than a successful empty cabinet.

## Colour and processing contract

Version 2 accepts only 33-point 3D `.cube` LUTs with `DOMAIN_MIN 0 0 0`, `DOMAIN_MAX 1 1 1`, and SDR sRGB input/output. Out-of-range, malformed, incomplete, 1D, and differently sized LUTs are rejected during publishing.

The camera explicitly disables HDR capture. Before either a legacy matrix or version 2 recipe is applied, the decoded image is drawn into Skia's colour-managed sRGB RGBA8888 CPU surface. That converts embedded ICC/Display-P3 inputs and clamps extended range to SDR. The normalized image then enters the GPU pass in this fixed order:

```text
sRGB normalization -> exposure -> 3D LUT -> halation -> bloom
-> grain -> sharpness/softness -> vignette -> sRGB JPEG
```

The runtime LUT is an RGBA8 atlas with R changing fastest, then G, then B. The shader uses bilinear sampling within an R/G plane and linear interpolation between B planes, which is trilinear interpolation. Grain is deterministic and procedural in engine version 2; spatial effects are recipe parameters, not baked into the LUT. Downloaded packages contain declarative data only and never executable code.

The normalization raster and final GPU surface are the two necessary full-resolution working images. Rendering uses tiled draw commands and creates no per-tile JavaScript pixel buffers. Representative low-memory devices still require golden-image and peak-memory release testing before launch.

## Catalogue and immutable assets

The version-controlled catalogue is `worker/filmstock-catalogue.json`; its contract is `worker/filmstock-catalogue.schema.json`. Source recipes use `worker/filmstock-recipe.schema.json`. Staged, compiled packages live under `worker/filmstock-assets/` before upload to the `momints-filmstocks` R2 bucket.

```text
GET  /v1/filmstocks
GET  /v1/filmstocks/assets/<immutable-key>
POST /v1/filmstocks/unlocked
```

`worker/src/filmstocks/catalogue.ts` imports the JSON catalogue and uses Worker time when rendering availability. Schedule changes therefore need a Worker deployment but no app release. Package bytes are addressed by versioned paths and protected by `filmstock-assets/immutable-lock.json`.

The app stores downloaded recipes, LUTs, previews, compatibility data, and last-accessed state in its document sandbox. Package presence does not grant access. Package downloads are same-origin HTTPS, engine-version checked, SHA-256 verified, and removed if incomplete. An active roll's package is never removed.

## Authoring package

Copy `worker/filmstock-package-template` to a directory whose name is the final ID, then add the source LUT and previews:

```text
amber-200-v1/
|-- source/amber-200-v1.cube
|-- previews/preview-01.jpg
|-- recipe.json
|-- attribution.txt
`-- authoring-notes.md
```

The source `.cube`, unmodified recipe, attribution, and authoring notes are copied to the version-controlled internal archive at `worker/filmstock-sources/<id>/`; deployment never uploads that directory. The publisher creates `runtime/amber-200-v1.lut`, injects its URI and SHA-256 into the public recipe, copies previews and attribution, updates the immutable lock, and adds the stock to the catalogue. Validation recompiles the archived CUBE and proves that it still produces the locked runtime bytes.

Every film must be evaluated against the same untouched sRGB test corpus: diverse skin tones, direct and overcast daylight, golden hour, tungsten and mixed light, foliage, skies, neutral interiors, deep shadows, specular highlights, saturated objects, neutral greys/whites, a colour chart, and smooth colour/greyscale gradients. Keep this licensed corpus private if redistribution is not permitted; it is test input, not a deployed asset.

`attribution.txt` is mandatory even for first-party work. It must name the creator and source, record the licence, and explicitly state whether commercial use and redistribution are permitted. A repository licence is not evidence that a third-party LUT can be redistributed.

## Publishing and rotation

From `worker/`:

```powershell
npm run publish:filmstock -- --package ..\path\to\amber-200-v1 `
  --test-images D:\secure\momints-canonical-test-set `
  --available-from 2026-10-01T00:00:00Z `
  --available-until 2026-11-15T00:00:00Z

npm run test:filmstocks
npm run validate:filmstocks
npm run typecheck
```

Publishing validates both JSON schemas, the ID, attribution, previews, `.cube` structure/domain/dimensions, effect bounds, engine compatibility, and immutable paths. It requires the private canonical test set, normalizes those images to sRGB, applies the LUT, writes ignored side-by-side comparisons under `worker/filmstock-validation/<id>/`, and reports clipping/banding warnings. It refuses an existing catalogue ID, lock key, or generated asset directory.

The canonical directory requires `manifest.json` with `{ "images": [{ "file": "...", "tags": ["..."] }] }`. Required tags are `direct-sunlight`, `overcast-daylight`, `golden-hour`, `tungsten`, `mixed-lighting`, `foliage`, `blue-sky`, `neutral-interior`, `deep-shadows`, `specular-highlights`, `saturated-objects`, `neutrals`, `colour-chart`, and `gradients`, plus at least three images tagged `skin-tone`. One image may carry several tags. Pass the directory with `--test-images` or `FILMSTOCK_CANONICAL_TEST_DIR`; neither source photographs nor generated comparisons are deployed to R2.

To rotate a previously published non-house film without changing its bytes:

```powershell
npm run schedule:filmstock -- --id amber-200-v1 `
  --from 2027-03-01T00:00:00Z `
  --until 2027-03-31T00:00:00Z
```

Deployment requires `FILMSTOCK_SMOKE_BASE_URL` and runs through `npm run deploy`. It validates local hashes, refuses to replace a different remote object, uploads only missing immutable objects, deploys the Worker, and smoke-tests the production catalogue, recipes, LUT checksums, and previews. `npm run deploy:worker` is the lower-level Worker-only command and must not be used to publish new film assets.

Never overwrite a recipe, LUT, texture, or preview with visually different bytes. Publish a changed look under a new ID. Assets required by unlocked users must remain downloadable after the shelf window ends.

## Verification gates

Automated checks cover strict CUBE parsing, runtime compilation/header validation, identity trilinear interpolation, recipe bounds, licensing fields, catalogue/recipe schemas, immutable hashes, and Worker typechecking. Release validation must additionally compare canonical golden images on supported iOS and Android hardware, inspect skin/neutral/gradient behavior, record peak memory for full-resolution images, and verify preview/final parity. Those device/art-direction gates require approved LUTs and the canonical licensed test corpus; they cannot be inferred from synthetic unit tests.

## Privacy

R2 contains recipes, LUTs, textures, attribution, and promotional previews only. Filmstock endpoints store no profiles, wallets, entitlements, active rolls, photographs, thumbnails, contact sheets, or processing results. Unlock requests are rate-limited and responses are `private, no-store`; wallet addresses remain in the POST body rather than the URL. All photograph processing stays on-device.

The app's encrypted active-roll vault is a separate recovery feature. It retains the one active roll until independent permanent-image and developed-marker verification succeeds, then deletes it under the existing vault policy.

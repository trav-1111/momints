# Native filmstock hybrid — implementation and test gates

Working branch: `feat/filmstock-native-hybrid`, based on `hackathon` at
`66d41db`. The isolated EGL lifecycle is adapted from `perf/seeker-native-film-gl`
at `f318da1`. Neither source branch is modified. The partner's other camera
features and hardcoded 32³ PNG catalogue are not imported.

## Runtime contract

The production Worker, timed Film Shelf, Film Cabinet/unlocks, offline access,
immutable `filmStockId`, active-roll pinning, and encrypted roll recovery remain
the existing implementation. No Worker, mint transaction, fee, or treasury code
changes are needed. This integration does not build a graded live viewfinder.

Android consumes the normal version-2 `MOMLUT01` 33³ RGBA8 atlas directly,
not a converted PNG. The native renderer validates the serialized recipe hash,
film identity, schema/engine, colour contract, LUT hash/header/length, and bounded
effect settings before returning a successful result. It supports the existing
house-film version-1 matrices too. LUT and recipe hashes are internal processing
receipts, not added NFT metadata.

The bundled GLES shader follows the production order: SDR sRGB normalization →
exposure → LUT → halation → bloom → grain → sharpness/softness → vignette → JPEG.
Bitmap EXIF rotation/mirroring is baked into pixels during normalization. Output
does not copy location EXIF. Shader float precision differs from Skia's half
precision; grain noise is not assumed pixel-identical across renderers.

Each frame gets an isolated EGL context, framebuffer, textures, program, VAO and
VBO. Allocation, shader/link, framebuffer, upload, draw, readback, JPEG encoding,
and output bounds are checked. Before each full-resolution pass, eight synthetic
colour samples run through the actual loaded GPU LUT/program and are compared
with CPU trilinear/matrix reference values (tolerance: two 8-bit levels). Spatial
effects/exposure are disabled for the canary and the full recipe is restored
before processing the capture. A mismatch fails closed. `finally` releases GL/EGL resources and bitmaps;
an owned partial output is removed on failure. Native calls and the complete JS
processing/verification pipeline are serialized. This bounds concurrency, but
does not make full-resolution processing a low-memory operation: decoded,
normalized, GPU, readback and encoded buffers still need device measurement.

Android requires the rebuilt native module; there is no automatic Skia or
original-image fallback. Other platforms retain the existing Skia recipe engine,
with added output verification and disposal. Web support is not expanded.

## Capture gate and privacy

Camera cropping precedes rendering. A completed receipt binds the output URI,
JPEG dimensions and SHA-256 to the selected film, serialized recipe, LUT and
renderer. JS rechecks the encoded artifact without another full-resolution
decode. Quick-shot size fitting only receives a verified developed image; its
replacement JPEG is checked for valid dimensions/aspect and rebound to the same
processing provenance.

Only after these checks does the camera register a photo or mark a roll frame
for minting. The encrypted frame is still committed before the roll counter
advances. Rendering/verification failure adds no photo/exposure to the queue.
Native code never deletes the input. JS removes app-owned temporary captures
after verification; camera error cleanup and startup sweeping retain their
existing privacy guards. No new user-image persistence is introduced.

A hash/receipt proves artifact and package consistency, **not** that a shader is
visually correct. A valid JPEG alone also cannot establish the intended look.
Golden-image and device checks below are release gates, not replaced by receipts.

## Automated checks

- `npm run test:film-processing`: mocked native-boundary regression tests for
  receipt/package mismatches, output corruption, missing LUT, native failure,
  collision-safe cleanup, serialization/recovery and quick-shot compression.
  Camera registration ordering has a source-level regression guard, not a UI test.
- Existing privacy, encrypted-roll-vault and access-policy tests.
- Existing Worker filmstock package tests and catalogue validation. The previous
  33³ probe/validation suite is reused, not recreated.
- App/Worker typecheck, changed-file lint, and arm64 Android debug build.

## Pending Seeker release gates

Automated results on 2026-09-27: 18 processing regressions, 10 privacy tests,
4 roll-vault tests, 5 film-access policy tests, 6 wallet-domain tests and
9 existing Worker package tests passed (52 total). Catalogue validation passed
for 4 filmstocks / 11 immutable assets. App and Worker typechecks, changed-file
ESLint and changed-file Prettier checks passed. The native arm64 debug build
passed; these are host/build results, not Seeker execution results.

The Seeker was connected after the initial implementation and the test APK was
installed without clearing app data. Synthetic processing, LUT/reference,
package download, fail-safe and repeated-reveal checks are recorded in
[the device QA report](HYBRID-SEEKER-QA-2026-09-27.md). No personal photographs
were used and no mint transactions were initiated. Normal-navigation memory
tests passed; a separate manual-controls camera-readiness race was observed in
forced-remount stress. The readiness guard is now implemented separately in
`53f7f69`; the historical QA report predates that fix. Canonical/sensor/recovery
release gates remain pending.
The compiled APK is `android/app/build/outputs/apk/debug/app-debug.apk` (ignored).

Before promoting this branch:

1. Install the rebuilt debug APK without clearing app data. Verify normal package
   download/cache/integrity, rotating-roll access, and owned/house Quick Shoot.
2. Compare known synthetic colour/greyscale/orientation fixtures against a CPU
   reference and the existing production renderer. Use grain-disabled comparison
   separately from the complete recipe; inspect LUT interpolation, sRGB handling,
   clipping, gradients, effect radii and colour-channel/orientation parity.
3. Exercise capture → develop → reveal, including full-aspect portrait and
   cropped frames. Confirm queue/exposure/vault ordering and active-roll pinning.
4. Repeat 12/24 full-resolution frames and repeated reveal/disposal cycles. Record
   cold/warm processing and LUT load times, `dumpsys meminfo` peak/settled Graphics,
   Native Heap and total PSS after each run. Do not infer a solved leak from build
   success or from results measured on the partner branch.
5. Force missing/corrupt LUT, incompatible recipe, unavailable module and renderer
   failure. Confirm no original is registered or minted under the selected ID;
   no exposure is consumed, partial outputs are removed and retry remains usable.
6. Confirm temporary synthetic inputs/outputs are removed using app-owned paths;
   leave gallery photos and the encrypted active-roll vault untouched.

This app-side renderer does not require a Worker deployment or production
entitlement bypass. Visual and memory approval remain pending.

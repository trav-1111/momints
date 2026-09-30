# Roll-frame production checklist

Recorded: 2026-09-28

Branch: `fix/roll-frame-contract`

## Production contract

- [x] New permanent roll frames are SDR sRGB JPEGs no larger than 3,145,728 bytes.
- [x] The app targets 2,900,000 bytes, leaving transport and comparison margin.
- [x] The launch processing envelope is at most 12,000,000 decoded pixels and a 4,000-pixel long edge.
- [x] Twelve- and twenty-four-frame rolls remain supported.
- [x] Original/crop aspect is preserved; byte fitting never introduces a square crop.
- [x] Existing open rolls remain recoverable during rollout.

## Stage 1 — shared artifact contract and capture fail-safety

- [x] Define app and Worker constants for MIME, target bytes, hard bytes, pixels, and long edge.
- [x] Add `mime` and `byteLength` to the verified film-processing receipt.
- [x] Make crop failure fail closed instead of silently substituting the full frame.
- [x] Make size fitting fail closed when a verified artifact cannot meet the limit.
- [x] Apply fitting to both Quick Shots and roll frames before registration or exposure advancement.
- [x] Preserve width, height, byte length, hash, renderer and film identity in the in-memory photo record.

### Checkpoint A

- [x] Unit-test JPEG signature/dimensions and artifact-limit validation.
- [x] Unit-test crop and fitting failures do not add a photo or consume an exposure.
- [x] Typecheck and lint the app.
- [x] On Seeker: capture each aspect and confirm JPEG, sRGB, dimensions, byte limit and unchanged framing.
- [x] Record capture-to-ready latency and memory for under-limit and fitted images.

## Stage 2 — encode to budget without a second full decode

- [x] Move the byte-budget quality ladder into the native Android renderer while its result bitmap exists.
- [x] Add equivalent behavior to the Skia fallback.
- [x] Encode every quality attempt from the same rendered pixels and expose only a completed, verified destination.
- [x] Resize only as a final backstop and preserve aspect ratio.
- [x] Remove the redundant post-render decode/re-encode from the normal capture path.
- [x] Approve the quality floor against the private canonical corpus.

### Checkpoint B

- [x] Compare the current single-pass ladder with the quality-95-plus-fitter path on representative canonical scenes and controls.
- [x] Confirm 4000×3000 high-detail fixtures fit below 2,900,000 bytes.
- [x] On Seeker: compare output with the existing quality-95 plus fitter path.
- [x] Record render/encode p50 and p95, peak memory, output bytes and dimensions.
- [x] Run 24 repeated capture/develop/reveal cycles and confirm no accumulating graphics memory.

## Stage 3 — encrypted roll vault v2

- [x] Extend the manifest with verified artifact metadata and immutable film identity.
- [x] Delete plaintext roll frames after their encrypted commit.
- [x] Restore metadata at startup without decrypting every full-resolution frame.
- [x] Decrypt one frame just in time for preview/upload and remove it in `finally`.
- [x] Keep any roll reveal derivatives encrypted or memory-only.
- [x] Preserve all encrypted material until independent permanent-image and developed-marker verification.
- [x] Migrate v1 manifests without weakening hash verification.

### Checkpoint C

- [x] Crash after encrypted frame write but before manifest update; recover the previous generation.
- [x] Restart with 1, 12 and 24 stored frames; verify no plaintext full-resolution files remain.
- [x] Force upload, preview and render failures; verify just-in-time plaintext cleanup.
- [ ] Verify remote Arweave bytes against the vault artifact hash before deletion.
- [x] Confirm abandon/new-roll cleanup only touches the exact app-owned vault.

## Stage 4 — Worker validation and legacy rollout

- [x] Authenticate before reading multipart frame bodies or invoking storage/RPC/D1 mutations.
- [x] Enforce 3,145,728 bytes for newly created rolls.
- [x] Give pre-contract open rolls a bounded 8 MiB legacy allowance.
- [x] Sniff and validate complete JPEG bytes; do not trust multipart MIME.
- [x] Derive width and height and enforce the decoded-pixel/long-edge limits.
- [x] Persist MIME, byte length, dimensions and image hash with each frame.
- [x] Write Worker-derived artifact metadata into permanent NFT metadata.
- [x] Reject every invalid request before Turbo upload or mint work.
- [x] Add request/rate limits to roll and Quick staging surfaces.

### Checkpoint D

- [x] Missing, wrong-wallet, expired and wrong-roll authorization produces zero side effects.
- [x] Oversized, malformed, truncated, MIME-spoofed and excessive-dimension JPEGs are rejected.
- [x] Boundary files at 2,900,000 and 3,145,728 bytes behave as specified.
- [x] Legacy rolls can finish; new rolls cannot use the legacy allowance.
- [x] Idempotent frame retry and completion recovery still pass.
- [x] Worker tests, typecheck, catalogue validation and asset smoke tests pass.

## Stage 5 — durable metadata and read paths

- [x] Carry verified artifact metadata through queue and pending-finalize recovery.
- [x] Populate mint-history `imageHash`, `width` and `height` from verified data.
- [x] Keep history and contact sheets remote-only with non-persistent image caching.
- [x] Prefer stored dimensions for layout, but verify/fallback to permanent image headers.
- [x] Confirm contact sheets preserve each stored frame's aspect and header aspect reporting.
- [x] Confirm roll title/date/film metadata still comes from the intended authoritative source.

### Checkpoint E

- [x] Restart during Quick and roll finalization; recover metadata without retaining a local photo.
- [x] Build 12- and 24-frame contact sheets from Arweave and inspect aspect/layout.
- [x] Verify history/cache directories contain no persistent image bytes after browsing.
- [x] Verify contact-sheet inputs/intermediates/output are deleted on success, failure and cancellation.

## Stage 6 — production release gates

- [x] Pin or select a camera format no larger than the approved 12 MP envelope.
- [x] Test actual Seeker rear/front captures for every supported aspect.
- [x] Test SDR, HEIC/profile/orientation inputs supported by the capture pipeline.
- [ ] Complete a real prepaid 12-frame and 24-frame roll through permanent verification.
- [x] Test active-roll restart, offline reuse, film pinning and catalogue rotation.
- [x] Confirm Arweave propagation remains `confirming`, never a false failure.
- [ ] Confirm Worker frame/completion authorization and operational endpoints are production-safe.
- [x] Run app typecheck/lint/tests and Worker tests/typecheck.
- [ ] Resolve the repository-wide Prettier baseline: `npm run fmt:check` currently reports 131 pre-existing/unrelated files, including generated and private draft paths.
- [ ] Review privacy storage on device after capture, restart, history, contact sheet and completed-roll cleanup.

### Checkpoint F — release decision

- [x] No sustained memory growth over a complete 24-frame lifecycle.
- [ ] Peak memory stays inside the approved Seeker release envelope.
- [x] No unprocessed, wrong-film, wrong-aspect or oversized image can enter a mint queue.
- [x] No plaintext active-roll frame persists outside a bounded just-in-time operation.
- [x] No unauthenticated caller can spend a prepaid roll or complete it.
- [x] Product/visual approval is recorded for the final JPEG quality policy.

## Measured baseline

- Native quality-95 high-detail output: 5,688,078 bytes (5.42 MiB), 4000×3000.
- Bali high-detail output: 5,144,766 bytes (4.91 MiB).
- Martha high-detail output: 4,988,736 bytes (4.76 MiB).
- Existing Quick fitter: 5.688 MB to 1.821 MB without resizing.
- Existing fitting time: p50 502 ms; p95 529 ms.
- Processing plus fitting: p50 1,165 ms; p95 1,257 ms.
- Repeated 24-cycle high-detail test: settled Graphics 34.48 to 33.91 MiB; no accumulating trend.
- Sampled transient peaks: Graphics 228.3 MiB, Native Heap 387.0 MiB, total PSS 786.9 MiB.

## Checkpoint A/B measurements — 2026-09-28

- Real Seeker rear-camera Full/4:3 source: 3264×2448 (8 MP); 1:1: 2448×2448; 16:9: 3264×1836.
- All real captures were verified `image/jpeg`, SDR sRGB through `native-egl-v2`, and 2.11–2.35 MB.
- Capture-to-verified-store latency: 1:1 2,189 ms; 4:3 2,037 ms; 16:9 1,892 ms. This includes ADB input dispatch and crop processing.
- Real-capture sampled peak: Graphics 201.9 MiB, Native Heap 307.9 MiB, total PSS 695.5 MiB. Settled Graphics returned to 37.4 MiB after every capture.
- Twelve repeated 4000×3000 high-detail renders produced 2,322,334–2,379,302-byte JPEGs without resizing.
- High-detail render/encode: p50 1,175 ms, p95 1,228 ms, maximum 1,254 ms.
- Repeated-render sampled peak: Graphics 227.6 MiB, Native Heap 354.1 MiB, total PSS 764.7 MiB.
- Repeated-render settled Graphics: 34.5 MiB baseline to 32.4 MiB final; Native Heap 257.1 MiB to 255.4 MiB. No accumulating trend over 12 runs.
- The full 24-run gate completed at p50 1,074 ms / p95 1,227 ms. Settled Graphics was exactly 37.4 MiB at baseline and final; Native Heap fell from 260.4 to 251.2 MiB after the final settle.
- The 24-run sampled peaks were Graphics 186.6 MiB, Native Heap 417.5 MiB and total PSS 800.4 MiB. Native settled allocations rose in short groups and were reclaimed during the run; they did not form a terminal upward trend.
- The three real Quick captures and all synthetic device inputs were deleted after measurement; the photo store and dedicated capture directory were verified empty.

## Checkpoint C partial measurements — 2026-09-28

- An isolated Seeker fake roll committed a verified 1024×768 JPEG to AES-256-GCM vault v2, then immediately removed its plaintext source.
- Metadata-only restore returned the immutable film ID, complete artifact receipt and a non-filesystem `momints-roll-vault://` reference.
- A forced exception inside the just-in-time upload callback left no decrypted file behind.
- The bounded reveal path returned a JPEG data URI held in memory; its full-resolution input and intermediate JPEG were absent after the awaited operation.
- Device inspection found only the authenticated `.frame` envelope and encrypted manifest inside the fake vault. The fake vault, fixture and all QA temp files were removed afterward.
- At the end of the 2026-09-28 run, torn-manifest recovery, 12/24-frame restart tests, real upload failure, and independent Arweave verification were still pending; the first two were completed in the 2026-09-29 continuation below.

## Checkpoint C restart results — 2026-09-29

- A guarded fake vault committed two independently verified Seeker captures, producing manifest revisions 1 and 2 with no plaintext frame files.
- The newest encrypted manifest was deliberately torn and an orphan encrypted frame was left behind before force-stopping the app. On relaunch, the vault ignored both invalid/unreferenced files and restored the complete revision-1 frame and artifact receipt.
- Separate fake vaults containing 1, 12, and 24 encrypted frames survived a force-stop/relaunch and restored exactly 1, 12, and 24 metadata records using only `momints-roll-vault://` references.
- Each vault contained one encrypted `.frame` per exposure and at most two encrypted manifest generations; no JPEG, PNG, WebP, or other plaintext full-resolution frame was present.
- All seed captures were deleted as soon as their encrypted commits succeeded. The exact fake vaults, SecureStore test key, capture directory, and QA directories were removed after verification; no real active roll or real vault existed before the test.
- Forced upload/network callback failure and forced native preview-render failure both rejected as expected; in each case the just-in-time decrypted JPEG was gone before control returned and no `roll-jit-*` file remained.
- An exact-scope discard test removed `qa_discard_target` while preserving a sibling vault directory and marker byte-for-byte; the sentinel was then removed separately under its own guard.
- Still pending at this checkpoint: independent Arweave verification before a real completed-roll vault purge.

## Checkpoint D/E host results — 2026-09-29

- Worker roll-contract suite: 10/10 passing, including capability isolation, legacy authorization, strict and legacy byte boundaries, malformed/truncated/MIME-spoofed rejection, Worker-derived Quick receipts, byte-bound idempotent frame retry, and idempotent completion/handoff recovery.
- Worker typecheck, filmstock package suite (9/9), catalogue validation (4 stocks / 11 immutable assets), and bundle-size check pass.
- App typecheck and lint pass. Privacy (13), roll vault (8), wallet domain (6), filmstock policy (5), film processing (20), image artifact (5), and camera readiness (15) suites pass.
- Quick and roll queue entry now requires a verified local artifact receipt; server receipts are compared before paid/finalized state is accepted. History and pending-finalize recovery persist the verified hash and dimensions.
- End-to-end testing of the new Worker frame endpoints, real paid completion/restart recovery, and remote-only contact-sheet/cache inspection remain release checkpoints; no production Worker was deployed for these host tests.
- The read-only production filmstock smoke verified all 4 catalogue entries and 11 immutable assets. This validates the existing asset-serving path only; the new roll-frame Worker code remains intentionally undeployed.

## Checkpoint F capture-format measurements — 2026-09-29

- The format selector pinned the Seeker rear camera to 4000×3000 (12 MP) and the front camera to 3264×2448 (8 MP), the largest formats inside the 12 MP / 4000-pixel envelope.
- Rear results: 1:1 3000×3000 / 1,244,600 bytes / 2,213 ms; 4:3 4000×3000 / 1,675,521 bytes / 1,430 ms; 16:9 4000×2250 / 1,308,416 bytes / 1,601 ms; Full 4000×3000 / 1,728,943 bytes / 1,322 ms.
- Front results: 1:1 2448×2448 / 2,365,235 bytes / 1,798 ms; 4:3 3264×2448 / 2,221,650 bytes / 1,775 ms; 16:9 3264×1836 / 2,311,001 bytes / 1,735 ms; Full 3264×2448 / 2,218,962 bytes / 1,432 ms.
- Every capture was a verified `image/jpeg` produced by `native-egl-v2`, below the 2,900,000-byte target, with the requested aspect and a complete artifact hash/recipe receipt.
- Rear sampled peaks: Graphics 196.4 MiB, Native Heap 368.3 MiB, total PSS 839.2 MiB. Front sampled peaks: Graphics 170.4 MiB, Native Heap 333.3 MiB, total PSS 758.1 MiB.
- Settled Graphics returned to 38–39 MiB after each of the eight runs. This is a passing capture-only trend; the later complete 24-frame lifecycle test closed the accumulation gate, while the peak-memory envelope remains open for approval.
- Each capture was removed from the photo store and dedicated capture directory immediately after measurement. QA fixtures, the device screenshot and QA directories were also removed and the capture directory was verified empty.

## Checkpoint E contact-sheet results — 2026-09-29

- Two existing complete 12-frame rolls were loaded exclusively from their permanent `https://arweave.net/` image URIs. Older history records had no stored dimensions, so the renderer exercised its remote-header/decode fallback.
- A 12-frame roll rendered at 1600×1655 in 20.6 s (1,841,298-byte PNG) and a 24-frame combined matrix rendered at 1600×2960 in 39.2 s (2,741,626-byte PNG). Both used four columns, preserved/detected the source 1:1 aspect, decoded every frame successfully, and produced the expected frame count.
- The successful output PNGs were deleted immediately after verification. A forced failure after a real Arweave input had been downloaded also left the per-render input directory empty. Parent input and output directories were empty after all cases.
- The screen now owns its preview output explicitly: back/cancel, successful share, successful save, replacement, late completion after unmount, and unmount all delete the app-owned PNG. Save to Photos remains the only user-requested persistent copy.
- The first device run exposed a separate memory bug: the compositor used a GPU-backed Skia surface and retained 228–381 MiB of graphics allocation after rendering. It now uses a CPU raster surface and explicitly disposes image data, decoded images, snapshot, paints, fonts, and surface.
- On the clean CPU-backed rerun, Graphics measured 38.0 MiB before rendering and 38.5 MiB after the 12-frame, 24-frame, and forced-failure sequence. The contact-sheet export no longer leaves a material GPU allocation beside the camera/reveal renderer.
- The Seeker history screen loaded eight visible Arweave thumbnails with `cachePolicy="none"`; `expo-image` reported no disk-cache path before or after browsing. Contact-sheet input/output and display-preview directories remained empty, and the in-memory image cache was cleared when the QA screen closed.

## Input-format and legacy-cache results — 2026-09-29

- Bali 400 processed an actual colour-profiled HEIC through `native-egl-v2` at 2316×3088 in 802 ms, producing a 1,976,373-byte verified JPEG.
- An sRGB JPEG carrying EXIF orientation 6 was baked to the correct 480×640 display orientation in 105 ms. A profile-bearing 4000×3000 sRGB high-detail fixture remained 4000×3000, completed in 1,008 ms, and encoded to 2,322,334 bytes.
- All three format-test inputs and outputs were removed from the app cache and `/data/local/tmp` immediately after validation.
- Device inspection found roughly 99 MB of legacy root-cache `photo_<uuid>_film.jpg` outputs from the pre-dedicated-directory processing path. The startup migration now removes only exact historical app-output names directly under `Paths.cache`; UUID/film-ID and timestamped-fit patterns are tested, while gallery names, arbitrary names and traversal strings are rejected.
- The guarded sweep removed those legacy outputs on the Seeker while retaining fonts, bundled assets and unrelated cache entries. The cache root fell from roughly 100 MB to under 1 MB.

## Restart and route-authorization results — 2026-09-29

- A synthetic pending Quick finalize was written with its signature, asset address, title, artist, capture time, film, aspect, and verified image hash/dimensions. With Seeker connectivity disabled, a force-stop/relaunch rehydrated the record and attempted the normal background drain while keeping it pending.
- The persisted Quick record contained no `file://` URI, `content://` URI, thumbnail, or image bytes. The QA record was removed before connectivity was restored; the queue was verified empty afterward.
- A synthetic developed 12-frame roll was persisted through the production AES-GCM vault path, then the app process was force-stopped and relaunched. Startup restored all 12 frames as `momints-roll-vault://` references with the exact `momints-color-v1` identity, `4:3` aspect, artifact receipts, and developed state. No plaintext frame was restored.
- The synthetic roll, vault, photo-store entries, Quick-finalize record, app-cache fixture, and `/data/local/tmp` staging file were deleted after the check. The app finished with no active roll, no photos, no pending Quick finalizes, and no QA fixture/capture directory.
- The actual local Worker routes were exercised against a seeded protocol-v2 roll. An unauthenticated 5.7 MB multipart frame request returned `401` before image validation/body work; unauthenticated and malformed-capability completion requests also returned `401`. D1 remained `OPEN` with `minted_count = 0`, `handoff_signature = NULL`, and zero frames. The isolated seed rows were then removed.
- This closes the client restart-recovery and code-level unauthenticated-mutation gates. The production operational endpoint gate remains open until migrations and the new Worker are exercised on an isolated deployed environment; no Worker was deployed here.
- A separate offline continuity run created an isolated Bali 400 active-roll session, force-stopped the app with Wi-Fi and mobile data disabled, and restored the exact `bali-400-v1` / `16:9` selection. After removing Bali from the in-memory catalogue to simulate rotation, the app loaded the cached recipe and runtime LUT with integrity verification and zero network calls. The QA roll was then removed and the Seeker's original Wi-Fi/mobile-data state was restored.

## JPEG quality comparison — 2026-09-29

- Eight private canonical inputs were normalized to the supported envelope without touching their originals: six real scenes covering skin, mixed/halogen/tungsten light, neutrals, foliage, shadows, highlights and sky, plus the generated colour chart and controlled gradients.
- The Seeker compared four artifacts from the same supported input: source, Android quality 95, the previous quality-95-plus-fitter path, and the current single-pass native budget ladder. The identity Momints Color recipe isolated encoding behavior from a creative LUT.
- Six of eight quality-95 outputs were already below 2.9 MB. In all six, both the legacy and current paths preserved the exact quality-95 bytes; neither introduced an unnecessary recompression.
- The 4000×3000 high-detail foliage scene encoded from 6,129,582 bytes at quality 95 to 2,782,803 bytes through the legacy fitter and 2,785,127 bytes through the current single pass. Relative to quality 95, legacy measured MAE 3.690 / PSNR 34.30 dB and current measured MAE 3.687 / PSNR 34.31 dB: materially equivalent, with no resize.
- The 3000×4000 highlights/foliage scene encoded from 3,339,118 bytes at quality 95 to 1,834,275 bytes through the legacy fitter and 2,525,569 bytes through the current single pass. Current retained more of the byte budget and measured MAE 1.243 / PSNR 42.25 dB versus legacy MAE 1.456 / PSNR 41.09 dB, again without resize.
- The comparison set and 100% center crops are private, ignored artifacts under [`.expo/jpeg-quality-seeker-20260929/comparisons`](../.expo/jpeg-quality-seeker-20260929/comparisons); numerical results are in [`quality-report.json`](../.expo/jpeg-quality-seeker-20260929/quality-report.json). They must not be committed or deployed.
- All 32 device outputs, eight staged inputs, work files and `/data/local/tmp` transfer directories were deleted after verified transfer. Momints finished with no active roll, no photos and no pending Quick finalize.
- Engineering result: the single-pass ladder is no worse than the old path on the exercised corpus and is materially better on the near-threshold highlight scene. Product approval of the quality floor remains open because these cases selected quality 85 or higher; they did not visually exercise the quality-60 backstop.

## Quality-60 full-corpus review — 2026-09-30

- The complete private canonical manifest was exercised on Seeker: 27 ungraded digital photographs and two generated controls, each rendered with Momints Color and Bali 400. For every film/input combination, A used the current native production ladder and B forced quality 60 through the same `native-egl-v2` renderer, 2,900,000-byte target and resize fallback. Identical lossless SDR-sRGB input bytes and one deterministic grain seed were used within each A/B pair.
- The run accounted for all 58 pairs / 116 outputs with zero failures. Native receipt diagnostics proved that every B output selected quality 60. A selected quality 95 for 37 pairs, 90 for 12, 85 for seven, 80 for one and 75 for one. The temporary receipt-only diagnostic was removed after the run; production defaults and the shipping compression policy were not changed.
- All 116 native JPEGs passed receipt, file-signature, byte-count, SHA-256 and dimension checks on-device and again after host transfer. No A or B output used the renderer's resize fallback, so every pair is a pure encoding-quality comparison. Twenty-two source files were losslessly normalized/downscaled before both sides of the pair to enter the existing 12 MP / 4,000-pixel processing envelope; that shared preparation is recorded per input and is not an A/B difference.
- Across all pairs, A totalled 123,767,410 bytes and B totalled 43,132,764 bytes: B was 65.15% smaller. Median output size fell from 2,312,212 bytes to 647,736 bytes. Momints Color saved 63.25%; Bali 400 saved 67.15%.
- At normal review size, A and B were broadly alike. Matched 100% crops exposed a real quality cost at 60: fine foliage, moss, rock and water texture became softer and sometimes blocky; smooth synthetic gradients showed stronger quantization/banding; Bali's fine grain was less distinct in smooth areas. Skin colour, overall transform, highlight roll-off and clipping remained stable in the reviewed cases.
- Private review evidence is ignored and undeployed under [`.expo/jpeg-quality60-seeker-20260930`](../.expo/jpeg-quality60-seeker-20260930): [`review.html`](../.expo/jpeg-quality60-seeker-20260930/review.html) provides all normal-size A/B pairs and matched lossless 100% crop panels, while [`private-report.json`](../.expo/jpeg-quality60-seeker-20260930/private-report.json) records normalization, package hashes, seeds, selected quality, dimensions, bytes, hashes, resize status, timings and errors. The original native JPEGs are retained locally for full-resolution inspection.
- Device cleanup ran only after all 116 host hashes matched their receipts. The exact app-cache and `/data/local/tmp` QA directories were removed. Initial and final app state matched: 26 existing mint-history records and two cached film packages were preserved; active roll, photo store, mint queue, pending Quick finalizations and roll vaults all remained empty.
- Limitations: this is one Seeker/Android JPEG implementation and one private corpus. The generated colour chart and gradients are useful controls but do not replace a photographed chart or broader skin-tone/camera diversity. Error metrics support navigation only; the owner's visual judgment remains the release gate.
- **Decision status:** approved by the owner on 30 September 2026. Quality 60 is acceptable as the emergency floor under the existing native ladder, 2,900,000-byte target and resize fallback. The observed 100% degradation is accepted for that emergency case; this does not change the normal ladder, hard ceiling, pricing or other shipping compression policy.

## Complete 24-frame lifecycle memory — 2026-09-29

- An isolated synthetic 24-frame Bali 400 roll exercised the production native renderer, verified-artifact path, encrypted roll vault and bounded vault-preview path without contacting the Worker or spending a prepaid roll.
- All 24 high-detail 4000×3000 inputs processed and committed successfully. Capture/develop processing measured p50 1,039 ms, p95 1,112 ms and maximum 1,143 ms. Bounded reveal previews measured p50 216 ms, p95 252 ms and maximum 264 ms.
- The sampled peak was 505.2 MiB Native Heap, 227.9 MiB Graphics and 870.8 MiB total PSS. This peak remains within the proposed debug-build envelope below, but that envelope still requires explicit release approval.
- Graphics was 34.4 MiB at baseline, rose transiently during the reveal sequence, measured 83.7 MiB immediately after the final preview, and returned to the exact 34.4 MiB baseline after a five-second settle. Native Heap fell from 375.3 MiB at baseline to 277.0 MiB after settle; total PSS fell from 686.1 MiB to 501.3 MiB. There was no sustained accumulation across the complete lifecycle.
- Every source capture was deleted after its encrypted commit. The fake roll and vault were removed after the test, followed by the exact app-cache and `/data/local/tmp` fixtures. Final verification found no active roll, photo records, pending Quick finalizes, fixture directory or QA capture directory.
- Proposed Seeker debug-build release envelope, pending approval: sampled total PSS no more than 1 GiB; sampled Graphics no more than 256 MiB; settled Graphics within 10 MiB of baseline five seconds after the final reveal. This run passes all three proposed limits.

## ImageManipulator cache privacy follow-up — 2026-09-29

- The post-QA sandbox audit found eight orphaned JPEGs (about 19 MiB) in Expo ImageManipulator's app-owned cache despite there being no active roll, photo record or pending Quick finalize. Their sizes and timestamps matched the eight private JPEG-quality QA encodes; they were not gallery files.
- The cleanup attempt had run while the native `ImageRef` remained open. The roll-vault reveal path now releases native image/context references before deleting `saveAsync` output, and the startup privacy sweep removes the exact `cache/ImageManipulator` directory as a crash/failure backstop. The guard never targets gallery, `content://` or arbitrary external paths.
- On Seeker, restart removed all eight orphaned files. A new synthetic 4000×3000 Bali capture was then encrypted into the real roll vault and revealed through the bounded preview path; the ImageManipulator directory contained zero files immediately afterward. The fake roll, vault, input, output and staging fixture were deleted, and final state again showed no active roll, photo records, pending Quick finalizes or QA directories.
- This closes the newly discovered manipulator-cache retention path. The broader privacy release gate remains open only because a real paid completed roll still must prove permanent-byte hash verification, developed-marker verification and subsequent encrypted-vault deletion.

## Decisions

- Permanent upload limit: 3 MiB hard, 2.9 MB app target.
- Legacy open-roll allowance: 8 MiB, scoped by roll protocol version; never granted to new rolls.
- Roll counts remain 12 and 24.
- File-size fitting is a storage/network control. The decoded-pixel limit is the graphics-memory control.

## Decision review — 2026-09-30

### Agreed next quality check

- Execution brief: [Quality-60 visual review](QUALITY-60-VISUAL-REVIEW-BRIEF.md). Finish the comparison and obtain the owner's quality decision before starting staging Worker work.
- Run an A/B visual comparison across the private canonical corpus before deciding whether quality 60 is acceptable. Approval to run the comparison is not approval of its output or of a shipping quality floor.
- Compare the current native encoding policy (A) with a forced quality-60 native encode (B), using identical supported inputs, film recipe and deterministic grain seed. Include house Color to isolate compression and Bali to examine the interaction with film effects.
- Record byte sizes, hashes and dimensions. Flag any resizing separately so it is not mistaken for a quality-only difference. Verify the forced path actually starts at 60 rather than allowing the normal ladder to stop at 85 or 95.
- Provide normal viewing sizes and matching 100% crops for visual review. Keep all corpus inputs and comparison outputs private, ignored and undeployed. Do not register test images as exposures or mint them.
- The existing canonical manifest contains 27 photographs and two generated controls. The earlier comparison used eight selected inputs; the new comparison should cover the full manifest.
- Status: the full 58-pair / 116-output Seeker comparison is complete with zero failures and private review materials prepared. The owner approved quality 60 as the emergency floor on 30 September 2026. Staging remains a separate task and was not started by recording this decision.

### Worker rollout recommendation — not yet deployed

- Execution brief: [Build and verify the isolated staging Worker](ISOLATED-WORKER-STAGING-BRIEF.md). Quality-60 approval is recorded; proceed with staging when this brief is handed off. Brief preparation checked Cloudflare login only and did not create staging resources.
- Test the same Worker code in a separate staging deployment with its own database, writable storage and queues, explicitly scoped credentials and rate limits. Do not point a newly named staging Worker at production's mutable resources.
- The update changes roll authorization, image validation/receipts, retry/completion handling and Quick Shot validation. It adds two database migrations and two rate-limit bindings; this is more than an image-size constant change.
- Updated rollout direction from the domain discussion: validate the new deployment in staging, then establish the production API under the app's `momints.xyz` domain. Suggested hostnames are `staging-api.momints.xyz` and `api.momints.xyz`, leaving the apex for the website; hostnames and Cloudflare zone availability still need confirmation. The current endpoint is on `traviskeir.dev` according to the owner.
- Promote the tested code/configuration into the new production deployment, with existing production records and signing authority deliberately preserved. Do not promote disposable staging data as production data. Back up the database, apply the additive migrations before code that requires their columns, and coordinate the app update because old app builds do not send the new roll authorization fields.
- Moving the hostname does not itself migrate data, queues or secrets. Plan the old endpoint's compatibility period and a single authoritative queue/scheduled-job configuration during cutover. Retire the old service only after existing rolls and pending Quick finalizations have been accounted for.
- Preserve and test legacy-roll recovery and existing pending Quick finalizations. Keep paid-roll testing until fixes and rollout checks are ready, as requested.

### Formatting explanation and proposed handling

- Prettier checks source layout (spacing, wrapping and similar style rules); its failures do not by themselves indicate functional app failures. They still fail the repository's formatting check and therefore its full CI command.
- A fresh read-only check reported **130 files** on 30 September, compared with the earlier recorded 131. The output includes unrelated source/docs and local draft/configuration paths. This review did not establish that every current warning predates the feature.
- Recommended handling: format/check changed deliverable files, review exclusions for generated/private/local-only material, then handle the remaining tracked formatting backlog in a separate formatting-only change. Do not exclude application source merely to make the check pass.
- No formatting rewrite, production deployment, database migration, payment or mint was performed in this review. The Seeker memory-envelope decision remains open.

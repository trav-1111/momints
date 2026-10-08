# Codex brief — quality-60 visual review

Prepared: 30 September 2026.

## Objective and scope

Run an on-device A/B comparison across Momints' private canonical corpus so the owner can decide whether the JPEG quality-60 emergency floor is acceptable for photographs. Produce the review materials, report the evidence, and stop for that visual decision.

Keep the existing **3 MiB hard ceiling, 2,900,000-byte encoding target, pricing, and shipping compression policy unchanged**. This task is testing and evidence gathering. Do not build or deploy the staging Worker, apply migrations, mint, pay fees, commit, push, or merge. Staging work follows the owner's quality decision in a separate task. Do not undertake the unrelated repository-wide Prettier cleanup.

## Starting context

- Workspace: `D:/Claude/momints`. Read applicable repository instructions and inspect the working tree; substantial uncommitted hardening work already exists and must be preserved.
- Corpus: `D:/corpus/canonical-srgb-v1/manifest.json`, currently 27 photographs and two generated controls. Read the manifest and test every entry; do not silently reuse only the eight-image subset from the earlier comparison. Never alter corpus originals.
- Device: Seeker, previously connected as `SM02G406193022`. Rediscover and confirm the device. ADB was available at `C:/Users/travi/AppData/Local/Android/Sdk/platform-tools/adb.exe`.
- The development inspector was not running on ports 8081–8083 during the last check. Start the required local development server and reconnect the app as needed; confirm the installed native module matches the current source. Do not uninstall the app or clear its data.
- Prior private harnesses and evidence are under `.expo/`: `hybrid-cdp.cjs`, `jpeg-quality-device-run.js`, `jpeg-quality-prepare.cjs`, `jpeg-quality-pull.cjs`, `jpeg-quality-assemble.cjs`, and `jpeg-quality-seeker-20260929/`. Inspect and reuse useful parts, but do not overwrite earlier evidence. These scripts are reference implementations, not instructions to execute blindly.
- Relevant production code: `modules/film-gl/android/src/main/java/expo/modules/filmgl/FilmRenderer.kt`, `modules/film-gl/index.ts`, `src/services/filmProcessor.ts`, `src/services/filmOutput.ts`, and `src/config/imageArtifact.ts`.

## Experiment

1. Record initial app/device state without exposing personal images or credentials. Preserve any existing photos, active roll, pending finalizations, vaults and cached film packages. Use dedicated QA directories and no photo-store, mint-queue or exposure registration.
2. Prepare supported SDR sRGB inputs, preserving aspect and orientation, bounded to both **12,000,000 pixels** and a **4,000-pixel long edge**. Use identical input bytes for each pair. Prefer lossless normalized intermediates supported by the renderer so preparation does not add a JPEG generation. Record all normalization and existing source compression.
3. Test every input with **house Color (`momints-color-v1`)** and **Bali (`bali-400-v1`)**. House Color isolates encoding differences; Bali tests interactions with film effects. Use verified packages, matching recipe/LUT hashes and the same deterministic grain seed within each pair. Rendering diagnostic outputs must not grant entitlements or register mintable frames.
4. **A: current native production encoding policy**, including its normal quality ladder and byte target. Do not label A as quality 95 unless that is verified for the particular output.
5. **B: forced quality 60 through the same Android native renderer and byte target.** The current native encoder filters its quality ladder by `jpegQuality`; passing 60 should leave only 60 before any resize fallback. Verify this against the installed build. Do not create B by recompressing A's JPEG or by using a desktop encoder.
6. Verify both receipts, JPEG bytes, hashes and dimensions. Record the forced setting and any observed selected quality with its evidence; do not infer quality from file size. Temporary QA diagnostics are acceptable if needed, but do not leave a shipping test toggle or change production defaults.
7. Flag every resized output. A pair with different dimensions is a combined compression/resolution comparison, not a pure quality comparison. If B cannot fit at its original dimensions, retain that finding and identify the resize fallback in the review. Do not hide failures or discard difficult scenes.
8. Process sequentially and release image/native resources between cases. The expected full set is **58 pairs / 116 outputs** for the current manifest. Account for each case, including failures.

## Review deliverables

Store new inputs, outputs, reports and review materials beneath a new ignored directory such as `.expo/jpeg-quality60-seeker-20260930/`. Verify Git ignores it. Keep all images and private metrics local and undeployed.

- A local review page or indexed comparison set covering every pair, with normal viewing size and matched **100% crops**. Include scene-relevant detail, skin, shadows, highlights, fine foliage, film grain, skies and gradients; a centre crop alone may miss the important subject.
- Use lossless PNG for composed crop panels so another JPEG save cannot obscure the comparison. Preserve the original device JPEGs for full-resolution inspection. Do not upscale a crop and call it 100%.
- Present initial comparisons as A/B with an accessible reveal key. Make the review easy to navigate and show representative examples to the owner, not just a directory listing.
- A machine-readable private report containing input identity/tags, normalization, recipe identity, seed, renderer, requested/verified quality information, dimensions, bytes, hashes, resize status and per-case errors. Error metrics may support the review but must not stand in for visual approval.
- A concise summary: completed cases, size savings, resizing/failures, visible issues observed, and limits of the test. If the native-device comparison cannot be completed, report the exact blocker; do not substitute desktop JPEG results as equivalent evidence.

## Privacy cleanup and verification

Confirm host transfers by hash before deleting device outputs. Release native image/context references before deleting temporary files; the earlier run exposed orphaned ImageManipulator JPEGs when cleanup happened in the wrong order.

Remove only this run's exact QA inputs, outputs, transient plaintext and transfer files after checking their resolved app-owned paths. Preserve the private host review artifacts for the owner's decision. Compare final app/device state with the initial state and confirm no QA exposures, queue entries, vaults or plaintext intermediates remain. Do not delete unrelated user state to obtain an empty-device result.

If code or diagnostics changed, inspect the diff and run the relevant focused checks. Avoid repeating the entire release test programme for an isolated visual experiment.

## Final handoff and stop point

Update `docs/ROLL-FRAME-PRODUCTION-CHECKLIST.md` with the test method, outcome, limitations and private evidence location. Add a concise presentation-worthy finding to `docs/HACKATHON-PRESENTATION-NOTES.md` only if supported; never include private photographs or sensitive details in tracked documentation.

Ask the owner to decide whether quality 60 is acceptable as an emergency floor, or whether the floor should be raised with an explicit policy for images that cannot fit. **Do not mark the floor approved yourself, implement a new quality policy, or start staging work before that decision.** Memory-envelope acceptance remains a separate unresolved decision.

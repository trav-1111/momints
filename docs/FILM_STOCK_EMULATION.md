# Momints film emulation prototype

Status: post-capture prototype ready for Trav's scoped review, with unit and Android-emulator renderer evidence from 20 September 2026. This is not an unconditional merge/release approval; see the review gates below. It has not been validated on a physical Solana Seeker.

This document describes behavior observed in the current working tree. The broader product proposal remains in `docs/LOMO_FILMSTOCK_PLAN.md`.

## Scope

The current change adds post-capture film processing to the existing Quick and Roll capture flows. It does not add a live filtered viewfinder, paid film entitlements, recipe versioning, a capture recovery journal, or server-side film metadata.

The renderer runs locally and does not call the minting API. The existing mode-selection prototype also exposes a free local test-roll path; Trav should decide whether that control is appropriate for a release build.

## Files

| Path                                       | Responsibility                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/config/filmStocks.ts`                 | Stock catalog, asset mapping, effect parameters, and legacy ID aliases.           |
| `src/services/filmProcessor.ts`            | Skia post-capture renderer and failure fallback.                                  |
| `src/services/filmRenderMath.ts`           | Pure LUT, luminance, halation-radius, and grain-seed math shared with tests.      |
| `scripts/generate_film_luts.py`            | Offline LUT baker and dependency-free packing self-test.                          |
| `assets/luts/`                             | Baked 32-cube LUTs stored as 1024×32 RGB PNG strips.                              |
| `tests/film-emulation.test.cjs`            | Film catalog, packing, fixture-output, effect-math, and fallback tests.           |
| `tests/fixtures/film/fixture-vectors.json` | Owned numeric fixture set used by the LUT sampler tests.                          |
| `tests/fixtures/film/lut-manifest.json`    | SHA-256 baseline for each stock's intended LUT.                                   |
| `tests/helpers/film-processor-harness.cjs` | Native-boundary fault injection for the real processor/catalog.                   |
| `tests/helpers/film-native-cases.cjs`      | Native SkSL pixel checks and end-to-end file rendering on owned synthetic images. |
| `scripts/test-film-emulator.cjs`           | Runs native cases through the existing Metro/Hermes debugger and saves evidence.  |

## Current stock catalog

| Display name       | ID                   | Processing                                                        |
| ------------------ | -------------------- | ----------------------------------------------------------------- |
| Momints Aura 400   | `momints-aura-400`   | LUT and grain                                                     |
| Momints Neon 800T  | `momints-neon-800t`  | LUT, grain, and red highlight halation                            |
| Momints Vivid 50   | `momints-vivid-50`   | LUT and fine grain                                                |
| Momints Amber 200  | `momints-amber-200`  | LUT and grain                                                     |
| Momints Silver 400 | `momints-silver-400` | LUT, grayscale conversion, and grain                              |
| Standard Color     | `standard-color`     | No-op; the source URI is returned without reading or rewriting it |
| Standard B&W       | `standard-bw`        | Rec. 601 grayscale matrix without LUT, grain, or halation         |

Legacy persisted IDs are resolved to their Momints-named catalog entries by `getFilmStock`. The legacy PNG filenames currently remain as byte-identical duplicate assets; runtime catalog entries load the Momints filenames.

## Render contract

The camera selects `activeRoll.film` in Roll mode and `quickFilm` in Quick mode. After any aspect crop, `applyFilm` performs:

1. source decode;
2. 32³ LUT sampling when the selected stock requires one;
3. highlight-driven red halation for configured stocks;
4. grayscale conversion when the selected stock or session mode is B&W;
5. luminance-weighted procedural grain;
6. JPEG encoding at quality 95;
7. UUID-named destination reservation with overwrites forbidden, write and existence/byte-length verification, followed by source deletion only after verification succeeds.

The SkSL sampler expects this LUT packing:

```text
x = blueIndex * 32 + redIndex
y = greenIndex
```

Linear sampling interpolates red and green inside each blue slice. The shader explicitly blends the adjacent blue slices.

Halation thresholds each of eight neighbouring samples from luma 0.70 to 0.98, then averages those highlight weights. Thresholding the average colour suppressed isolated lights; the native fixture caught that defect. The corrected fixture produces a red halo of RGB `[14, 3, 1]` outside a white patch on black. This is an eight-tap approximation, not a physically accurate or smooth Gaussian scattering model. Its configured radius is defined at a 1080-pixel short edge and scaled with the captured image's short edge. Visual quality and cost still need physical-device measurement.

Grain receives a stable FNV-1a-derived seed from the processed source URI. Retrying the same source produces the same pattern, while independently named captures normally receive different patterns. This is deterministic behavior, not a claim of physically accurate film grain.

## Failure behavior

`applyFilm` keeps and returns its input URI if source decoding, LUT resolution or decoding, LUT dimension validation, shader compilation, surface allocation, JPEG encoding, or output writing fails. Required-LUT failure does not silently create a grain-only result. Failures emit a `[filmProcessor]` diagnostic.

An incomplete output is removed on a best-effort basis and the source is retained. Per-render data, images, surfaces, paints, filters, and shaders are disposed in `finally`, including exception paths. Decoded LUTs and the compiled effect are retained in bounded catalog caches. A failed source deletion after a verified write retains the successful result and leaves the source file intact.

Each output is created with `File.create({ overwrite: false })` before it becomes eligible for failure cleanup. The earlier timestamp-only names allowed two renders to replace the same output; the initial cleanup implementation could also remove a pre-existing output after a failed write. Fixed-time regression tests reproduced that problem. UUID names avoid ordinary collisions, and exclusive file creation protects existing files even if a generated name collides with another output or the source. Reservation failure returns the untouched input.

This fallback protects the file passed to `applyFilm`. It is not a durable capture journal: the preceding crop step and the existing photo-store update sequence have their own lifecycle. Full interruption recovery remains outside this prototype.

## LUT generation and provenance

Run the packing-only check without installing generator dependencies:

```bash
python3 scripts/generate_film_luts.py --self-test
```

Regenerate the LUTs with:

```bash
uv run --python 3.14.4 \
  --with git+https://github.com/JanLohse/spectral_film_lut@9d04d97ba8e20bfe00b72116e80ae19ab268dce3 \
  --with pillow==12.2.0 --with numpy==2.5.3 --with colour-science==0.4.7 \
  python3 scripts/generate_film_luts.py
```

The verified local generator environment used the revision and versions above (`spectral_film_lut` package version 0.17.1). Regenerating into a temporary directory produced byte-identical PNGs for all five Momints assets. The packing self-test checks all 32,768 pixels through the same packing function used for generation. Runtime LUT assets were not changed. These pins record the principal dependencies, not a complete transitive environment lock.

The generator imports Kodak- and Fuji-named spectral definitions from the MIT-licensed `spectral_film_lut` project and bakes the tables under Momints display names. See `assets/luts/README.md` for recipe mapping and source notice. Renaming a preset does not establish proprietary ownership or commercial/trademark clearance. Release legal review is unresolved; do not describe these recipes as commercially cleared.

## Verification

Run the film-specific suite:

```bash
npm run test:film
```

It verifies:

- every catalog entry and legacy-ID resolution;
- generator and sampler agreement on red/green/blue axis and blue-slice order;
- 1024×32 dimensions for every configured LUT;
- stable expected values for a neutral grid probe;
- distinct, repeatable LUT results over neutral, RGB, gradient, daylight-like, and night-highlight numeric fixtures;
- Rec. 601 math, highlight-only halation threshold, resolution-relative radius, and stable per-source grain seeds;
- Standard Color no-op behavior;
- Quick/Roll film settings surviving persistence independently, including legacy color/B&W objects;
- 23 injected failure cases across reads, decodes, dimensions, compilation, allocation, shader/draw/flush/snapshot/encode calls, output reservation, writes and truncated output;
- same-millisecond renders, existing destination collisions, and destinations equal to their input preserving the correct files;
- original bytes retained, partial output removed, and temporary resources disposed on failures;
- Standard B&W's matrix render path and verified-write-before-delete ordering.

The numeric LUT sampler mirrors the production packing math, and the failure tests execute `applyFilm` with native Skia/File/Asset boundaries mocked. These tests are separate from the native evidence below; neither establishes physical-device color management, memory use, latency, or camera sensor behavior.

Run repository checks separately:

```bash
npm run lint:check
npx tsc --noEmit
npm run test:privacy
npm run test:wallet-domain
npm run fmt:check
git diff --check
```

Repository-wide formatting currently includes pre-existing failures outside the film work. Do not mass-format unrelated files.

## Emulator workflow and limits

The configured AVD is `Solana_Seeker`, and this checkout uses Metro port 7666:

```bash
~/Library/Android/sdk/emulator/emulator -avd Solana_Seeker -no-boot-anim
adb reverse tcp:7666 tcp:7666
npm run dev
```

Use Quick mode to select a stock, load the camera, capture, and review the developed file. The HUD label confirms selection only; it is not a live film preview. The free local Roll control can exercise roll selection and post-capture processing without a payment.

An emulator can establish navigation, selection propagation, shader compilation, file output, fallback logging, and visible differences between rendered results. It cannot establish Seeker performance, thermal behavior, camera color science, physical camera orientation/mirroring, or production image quality.

With the dev app open on the emulator and Metro connected, run:

```bash
node scripts/test-film-emulator.cjs
```

The runner uses the installed `ws` and TypeScript packages. Hermes debugger evaluation needs downlevel async syntax, so the injected test function is transpiled. It checks that the loaded shader equals the source under test, runs native Skia directly, calls the app's loaded `applyFilm`, and creates only a uniquely named `film-review-*` directory in app cache. It does not change wallet, roll, or session state. Its printed host artifact directory contains `report.json`, input/output PNGs, and grain/halation samples. Test fixture files remain for inspection in that cache directory. Reload the app after a stale-bundle error or debugger timeout before retrying.

Observed on `emulator-5554`, AVD `Solana_Seeker`, model `sdk_gphone64_arm64`, Android 14/API 34:

- **13/13 native checks passed.** Native SkSL compilation; 66 LUT sampling probes (maximum channel error 0, allowed 2); 34 B&W probes (allowed error 1); deterministic grain with different-seed variation, neutral channels, and stronger midtone than shadow variation; isolated-highlight halation, disabled/dark cases and radius changes.
- All seven catalog entries traversed native file decode/render/output checks on a 320×192 owned synthetic chart. Standard Color preserved the exact source bytes and URI. The six processed outputs were decodable JPEGs at unchanged dimensions; both B&W stocks remained neutral within 1 byte/channel.
- Native corrupt-image decode returned the original URI and retained bytes `[1, 2, 3]`.
- Concurrent native B&W renders produced distinct UUID-named outputs. Native file creation refused attempts to reserve those existing outputs, with their bytes unchanged.
- A separate tap on the existing Quick/Aura shutter produced this Android log on 20 September at 14:19:05: `[filmProcessor] Developed frame with Momints Aura 400 (momints-aura-400) -> file:///data/user/0/com.momints.app/cache/momints-captures/photo_1789877945108_film.jpg`. The following compression log reported `384817B under ceiling — untouched`. Reading that exact file through `adb run-as` returned 384,817 bytes; it decoded to 960×1280 and was visually inspected. SHA-256: `073dc421a349b4ffd578cf3be20fe50fe9a0211477d1681e13ab5597f2bde908`.

The first native run passed 11/12 and exposed missing isolated-highlight halation; the corrected run passed 12/12. One initial injection failed on unsupported async syntax, and one suite rerun timed out at the debugger. A later read-only debugger probe after a UI capture also timed out and was stopped; the output file was verified through ADB instead. An earlier capture's intermediate URI was absent and the in-memory photo list empty when inspected later; persistence through app reload is not established by these tests. Those failures were not counted as passes. Small debug-emulator fixture timings are recorded in the report but are not Seeker performance measurements. The automated native suite tests the renderer directly; the separate UI capture covers only Quick/Aura, not every stock's UI navigation or a full roll.

## Review gates and handover

Trav can review the bounded post-capture renderer now. Before merging the entire dirty tree, review or separate the pre-existing camera-recovery changes, free-test-roll control, session defaults and Metro-port changes. This pass did not modify those integration files. In particular, `parseFilmSettings` currently assigns Aura when the whole film settings value is absent/invalid; a valid legacy `{ mode: 'color' }` remains Standard Color. A legacy migration/default decision is still needed if absent settings must preserve the old unfiltered behavior.

Verification on 20 September 2026: `npm run test:film` passed 38/38; native emulator checks passed 13/13; `npm run lint:check`, `npx tsc --noEmit`, `npm run test:privacy` (6/6), `npm run test:wallet-domain` (6/6), and `git diff --check` passed. `npm run fmt:check` failed on 40 pre-existing files, including this feature's historical plan. Files changed in this pass pass a targeted Prettier check. Unrelated files were not formatted.

Review checklist:

- Inspect stock-to-asset hashes, generator axes and native identity-LUT evidence.
- Inspect exclusive output reservation, failure cleanup and verified-write-before-delete behavior; retain the documented crop/store interruption limitation.
- Review the synthetic outputs and eight-tap halation approximation, then judge owned real photos on Seeker before release.
- Decide integration/migration scope and address or explicitly accept the baseline formatting gate.
- Review source provenance and product wording before publishing stock claims.
- Include the untracked film assets, math module, fixture files and test helpers in the reviewed change; a tracked-only diff does not contain the whole feature.

Files changed in this review pass: `src/services/filmProcessor.ts`, `src/config/filmStocks.ts`, `scripts/generate_film_luts.py`, `scripts/test-film-emulator.cjs`, `tests/film-emulation.test.cjs`, `tests/helpers/film-processor-harness.cjs`, `tests/helpers/film-native-cases.cjs`, `tests/fixtures/film/lut-manifest.json`, `tests/fixtures/film/README.md`, `assets/luts/README.md`, and this document. Existing LUT PNGs, `filmRenderMath.ts`, numeric vectors, PNG helper, and pre-existing integration changes were preserved.

## Known limitations before Trav review

- No live filtered preview.
- No physical-device results or performance measurements.
- No recipe version/hash stored with a roll or photo.
- No durable render-state journal or retry UI.
- Native automated fixtures are synthetic and small; no calibrated photographs, cross-GPU comparison, full-resolution performance or memory profile.
- No commercial/legal-clearance conclusion for the source spectral definitions or legacy trademark identifiers.
- LUTs are applied to display-referred captured images; clipped detail and scene-spectrum response cannot be recovered.

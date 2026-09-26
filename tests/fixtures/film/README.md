# Film fixture ownership and use

These fixtures are synthetic test material authored in this repository. No third-party photographs, faces, charts, or image datasets are used.

- `fixture-vectors.json`: 34 explicit RGB triplets for neutral ramps, saturated swatches, gradients, daylight-like colors and night highlights. The labels describe numeric probes, not measured scenes or a calibrated color chart.
- `lut-manifest.json`: SHA-256 hashes of the five existing Momints LUT PNGs, frozen for review on 20 September 2026. Update only when intentionally reviewing new LUT assets. The LUTs have separate provenance in `assets/luts/README.md`.
- `../../helpers/film-native-cases.cjs`: owned procedural identity LUT, flat neutral/shadow fields, isolated white highlight, and 320×192 chart. Fixed uniforms test grain determinism; `applyFilm` uses the fixture source URI as its seed, so separate run directories intentionally yield different grain.

Native samples come from the production SkSL with no mocked Skia implementation. The direct renderer checks compare explicit pixel relationships/tolerances, rather than claiming reference photographs or physical film accuracy. The file-path cases exercise the loaded production `applyFilm` against real Expo files and bundled assets. Fault-injection tests separately mock only native boundaries and assert source bytes, output lifecycle, selected assets, uniforms and disposal.

Run `npm run test:film` for Node tests and `node scripts/test-film-emulator.cjs` for the emulator cases. Generated images and JSON reports are written to a fresh temporary host directory printed by the runner, with source fixtures retained in a uniquely named emulator cache directory for inspection.

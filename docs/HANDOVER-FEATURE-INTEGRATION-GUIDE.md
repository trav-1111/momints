# Handover: Advanced Camera & LomoKino Feature Integration Guide

**Date:** 2026-10-02  
**Target:** Momints Release / Submission Candidate  
**Baseline Commit Built:** `bc3a914` (Basic APK built and verified)  
**Feature Source Branch:** `origin/perf/seeker-native-film-gl` (HEAD: `ba71c28`)

---

## 1. Executive Summary & Build Status

The baseline standalone APK for `codex/submission-candidate` has been compiled and verified on macOS:

- **APK Location:** `.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-bc3a9145-arm64.apk`
- **File Size:** 71,810,870 bytes (~68.5 MB)
- **SHA-256:** `cfc4242b8deb834e0971156997e93925958f346923b064f4ae13c42f2bcf9de9`
- **Signing Fingerprint:** `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` (Hackathon Debug Keystore)
- **Static Checks:** Non-debuggable, package `com.momints.app`, `arm64-v8a`, embedded JS bundle.

The basic build path is complete and reproducible. If you choose to submit this baseline version, it is ready.

However, this baseline **lacks the advanced camera UI and LomoKino burst mode** developed by Zaac on `perf/seeker-native-film-gl`. Below are strict, prescriptive instructions for integrating these features cleanly.

---

## 2. Guardrails for AI Agents (Preventing Failure Loops)

> [!CAUTION]
> **Strict Agent Instructions:**
>
> 1. **Do not create negative/fault-injection test fixtures** that intentionally simulate crashed renderers or corrupt keystores. When agents are instructed to test failure boundaries, they get trapped in recursive mocking loops rather than shipping code.
> 2. **Do not touch the backend contract, D1 migrations, or Worker files.** The backend roll pipeline, Arweave Turbo permanent storage, and D1 database are already locked down.
> 3. **The camera features are purely client-side UI and state.** They feed the existing verified `capture` -> `filmOutput` -> `queuePhoto` pipeline.

---

## 3. Files to Port from `perf/seeker-native-film-gl`

The following files from `origin/perf/seeker-native-film-gl` contain the complete, tested feature implementations:

### A. New Files to Copy Directly:

1. `src/components/FocusReticle.tsx`
   - Implements tap-to-place separate AF & AE lock rings.
   - Edge-aware EV sun slider (prevents slider from clipping offscreen).
   - Hold-to-lock visual progress ring.
2. `src/store/kinoSettings.ts`
   - Zustand store for LomoKino burst mode:
     - `captureFps`: 3, 5, or 8 FPS (calibrated motor drive cadence).
     - `playbackFps`: 3, 5, 8, 12, 18, or 24 FPS.
     - `shutterGap`: Rotary blade blackout intervals (`off`, `subtle`, `classic`, `deep`).
3. `tests/kino-settings.test.cjs` & `tests/focus-lock-and-pro.test.cjs`
   - Automated unit tests for settings cycling, shutter stops, and reticle math.

### B. Modified Files to Integrate:

1. `src/components/ManualControls.tsx`
   - Adds the shutter dial with photographic notch snapping (1/8000s down to 16s).
   - Spring-snapping dial interaction.
2. `src/app/camera.tsx`
   - Mounts `<FocusReticle />` onto the viewfinder layer.
   - Connects VisionCamera UI orientation events to rotate HUD icons (landscape auto-rotation).
   - Wires LomoKino continuous capture interval into the shutter button.
3. `src/app/review.tsx`
   - Preloads captured burst frames into a texture stack.
   - Plays back bursts with a synchronized rotary shutter blade blackout effect.

---

## 4. Step-by-Step Integration Procedure

1. **Create an integration branch:**

   ```sh
   git checkout -b feat/advanced-camera-integration codex/submission-candidate
   ```

2. **Cherry-pick/checkout the self-contained assets from `origin/perf/seeker-native-film-gl`:**

   ```sh
   git checkout origin/perf/seeker-native-film-gl -- \
     src/components/FocusReticle.tsx \
     src/store/kinoSettings.ts \
     tests/kino-settings.test.cjs \
     tests/focus-lock-and-pro.test.cjs
   ```

3. **Reconcile `src/components/ManualControls.tsx`:**
   Take the dial snapping logic and shutter stops array from `origin/perf/seeker-native-film-gl:src/components/ManualControls.tsx` and preserve the camera-manual native bindings from `codex/submission-candidate`.

4. **Reconcile `src/app/camera.tsx` & `src/app/review.tsx`:**
   - Import `FocusReticle` and `useKinoSettingsStore`.
   - Add the HUD rotation transforms to top/bottom bar icon containers.
   - Wire the rotary blade playback in `review.tsx`.

5. **Verify and Rebuild:**

   ```sh
   # Run the unit tests
   node --test tests/submission-build.test.cjs
   node --test tests/kino-settings.test.cjs

   # Freeze & Build APK
   git add -A && git commit -m "feat: integrate LomoKino burst mode and Pro camera controls"
   node scripts/build-submission-apk.cjs \
     --hackathon-debug-signing \
     --expected-cert-sha256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c \
     --credentials credentials.json
   ```

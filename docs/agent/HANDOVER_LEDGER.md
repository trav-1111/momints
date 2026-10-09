# Momints Living Agent Handover Ledger

> **Rule for Agents:** When completing a task, append a new session entry to the top of this ledger following the standard schema. Never delete historical entries.

---

## Session 2026-10-09 (Part 2): V2 Camera Header Wallet Clearance

* **Agent / Author:** Hermes Momints Engineer
* **Branch:** `fix/v2-wallet-header-fit` (from `v2-staging`)
* **Scope:** Tightened first-row control gaps from 8 to 5 dp, kept 42 dp icon targets, and let the wallet pill and its single-line label shrink inside the 18 dp right inset rather than overflow for longer `.skr` handles. Added a 6 dp minimum separation from the left controls.
* **Verified Truth:** `npm run agent:check` passed 57/57. Physical Seeker `SM02G40619133790` reports 1200x2670 at 480 dpi. Installed baseline V1 wallet menu measured `[835,72][1200,175]` via UIAutomator (touches screen edge); updated V2 build has **not** been installed or visually verified on hardware.
* **Open:** Rebuild/install updated V2 QA APK on Seeker and inspect longest supported wallet label; `scripts/seeker-agent/run.sh` against the *installed baseline V1*, not this change, passed 5/6 flows (wallet flow UIAutomator exited 137). No Worker endpoints modified.

---

## Session 2026-10-09 (Part 1): V1/V2 Unification & Seeker Hardware V2 QA Deployment

* **Agent / Author:** Antigravity (Pair Programming with Zaac)
* **Active Branches:** `v2-staging` (commit `a1c85db`) & `qa/v2-seeker-side-by-side` (commit `9f23079`) on remote `zaacishere`
* **Upstream Baseline:** `origin/main`

### 1. Scope & Issues Addressed
1. **MWA Hardening Sync to V2:** Merged `fix/mwa-wallet-integration` into `v2-staging`. V2 now inherits Ed25519 signature slicing (`extractSignatureBytes`), SecureStore encrypted auth token caching, atomic migration write-before-delete, capability retry staging, and the full `docs/agent/` architecture system.
2. **Conflict Resolution:** Cleanly resolved 4 merge points (`AGENTS.md`, `src/store/photos.ts`, `src/components/ManualControls.tsx`, `src/app/camera.tsx`) to support both V2 Kino reel/burst metadata and MWA auth flows without regressions.
3. **TypeScript & Performance Optimization:** Added `".worktrees"` to `tsconfig.json` `exclude` array to prevent `tsc` from scanning parallel worktrees, dropping typecheck time from minutes to 4s. Fixed duplicated `rawNegativeUri`/`rawNegativeBytes` declarations in `Photo` interface.
4. **Unified Fast Test Suite:** Expanded `npm run agent:check` in `v2-staging` to run 57 automated tests across all MWA and V2 modules (0 type errors, 57/57 passing).
5. **Side-by-Side QA Integration:** Ported camera RAW orientation handling (`ExifInterface` sensor-rotation mapping) and Camera2 manual AF diopter range resolution (`focusRange.ts`) into `qa/v2-seeker-side-by-side` (62/62 unit tests passing).
6. **Hardware Build & Live Verification:** Compiled clean 193 MB release APK (`app-release.apk` with package `com.momints.v2qa`) and installed via ADB to physical Solana Seeker `SM02G40619133790`. Validated live streaming from rear 108MP sensor, MWA auto-restored session (`4v18...WuZM`), composition grid, PRO manual control strip, and Kino burst reel crank animation.

### 2. Verified Ground Truth
* **Root Typecheck & Unit Tests:**
  * `v2-staging`: `npm run agent:check` -> 57/57 passing (< 1s).
  * `qa/v2-seeker-side-by-side`: `npm run agent:check` -> 62/62 passing (< 1s).
* **Real Hardware Validation (Solana Seeker `SM02G40619133790`):**
  * Release APK installed via ADB (`Performing Streamed Install -> Success`).
  * `com.momints.v2qa` running active side-by-side with V1 `com.momints.app`.
  * Verified live viewfinder, MWA wallet auto-reconnect, PRO controls strip, and Kino burst animation via screencaps and logcat.

---

## Session 2026-10-08: MWA Hardening & Edge-Case Resolution

* **Agent / Author:** Antigravity (Pair Programming with Zaac)
* **Active Branch:** `fix/mwa-wallet-integration`
* **Head Commit:** [`0fbb1e0`](https://github.com/ZaacIsHere/momints/commit/0fbb1e0) on remote `zaacishere`
* **Upstream Baseline:** `origin/main` / `codex/submission-v1-baseline`

### 1. Scope & Issues Addressed
1. **Ed25519 Signature Slicing:** MWA returns message + 64-byte signature in single payload. Added [`extractSignatureBytes()`](file:///Users/zaac/momints/src/services/rollApi.ts#L269) to extract trailing 64 bytes (`signedPayload.subarray(-64)`).
2. **Hardware Keystore Auth Token Caching:** Replaced unencrypted `AsyncStorage` with `expo-secure-store` in [`walletAuthCache.ts`](file:///Users/zaac/momints/src/services/walletAuthCache.ts).
3. **Atomic Auth Token Migration (Codex catch):** Fixed migration order so legacy `AsyncStorage` token is preserved if `SecureStore.setItemAsync` fails, and only purged upon confirmed write.
4. **Recovery Capability Staging (Codex catch):** Staged recovery capability before dispatch in [`rollCapability.ts`](file:///Users/zaac/momints/src/services/rollCapability.ts). If an initial response packet drops after Worker commits to D1, retries reuse the identical capability, preventing HTTP 409 conflicts.
5. **No Silent Early-Exit on Pre-saved Tokens (Codex catch):** Removed premature early-return in [`ensureWorkerRollAuthorization`](file:///Users/zaac/momints/src/services/rollApi.ts#L282); pre-existing local tokens are now verified and claimed on Worker.
6. **Digital Asset Links DAL:** Provided canonical [`.well-known/assetlinks.json`](file:///Users/zaac/momints/.well-known/assetlinks.json) and clarified that production deployment belongs on `momints.xyz` web host.
7. **Worker TypeScript Verification:** Resolved missing dev dependencies in `worker/` (`npm --prefix worker ci --legacy-peer-deps`), ensuring `npm --prefix worker run typecheck` passes with 0 errors.

### 2. Verified Ground Truth
* **TypeScript Checks:**
  * Root app: `npx tsc --noEmit` -> 0 errors.
  * Worker: `npm --prefix worker run typecheck` -> 0 errors.
* **Automated Unit Tests:**
  * `npm run agent:check` -> 38/38 passing (< 1s).
  * Worker contract tests: `npm --prefix worker run test:roll-contract` -> 10/10 passing.
* **Real Hardware Validation (Solana Seeker `SM02G40619133790`):**
  * Release APK (`app-release.apk`, 72.2 MB) compiled and installed via ADB.
  * MWA connect sheet invoked via Seed Vault / Phantom -> wallet connected successfully.
  * Address resolved to reverse `.skr` domain (`🟢 zaaci....skr`).
  * Process force-kill (`adb shell am force-stop com.momints.app`) and cold relaunch -> session auto-restored without prompting user.

### 3. Open Edge Cases & Known Tech Debt
* **Digital Asset Links Production Deploy:** Needs to be uploaded to whichever web server hosts `https://momints.xyz` using Trav's production release signing key (not local debug cert).
* **PR Review Preparation:** All changes are isolated on `zaacishere/fix/mwa-wallet-integration`. A review brief must be prepared before merging to `origin/main`.

### 4. Verification Commands for Next Agent
```bash
# 1. Fast verification
npm run agent:check

# 2. Worker verification
npm --prefix worker run typecheck
npm --prefix worker run test:roll-contract

# 3. Check git status
git status
git log -n 3 --oneline
```

---

## Session 2026-10-07: Camera RAW DNG Baseline

* **Agent / Author:** Codex / Zaac
* **Active Branch:** `codex/submission-v1-baseline` (commit `303a9e1`)
* **Scope:**
  * Native Camera2 RAW DNG capture engine (`modules/camera-raw/`).
  * Hardware capabilities probing for Seeker 108MP sensor (`modules/camera-caps/`).
  * Preservation of raw negative before GL film simulation.

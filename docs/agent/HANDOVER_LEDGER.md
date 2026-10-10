# Momints Living Agent Handover Ledger

> **Rule for Agents:** When completing a task, append a new session entry to the top of this ledger following the standard schema. Never delete historical entries.

---

## Session 2026-10-11: Paid Roll Recovery Implementation and QA Update

* **Agent / Author:** Codex / Trav
* **Branch / Scope:** `codex/submission-v2-candidate`; owner approved applying the incident fix and updating the connected Seeker. Client journal, Worker receipt checkpoints, additive migrations, quick evidence/retention, closure audits and independent job/dashboard health implemented. Existing incident remedies remain separate; no production deployment or recovery spending yet.
* **Verified Truth:** New purchases persist original terms/capability and signed receipt before broadcast. Replay authenticates the same receipt, resumes one deterministic collection, and never silently reopens COMPLETE rolls. Empty OPEN rolls restore original settings; existing local frames survive and remote pending indices block unsafe frame reuse. Unknown quick attempts retain receipts and receive review state instead of age-only death; verified-paid image bytes copy outside staging expiry before queueing.
* **Verification:** App and Worker TypeScript pass. New recovery regressions 35/35; fast suite 99/106 and full app suite 170/177, with the same seven baseline camera/privacy failures. Existing Worker tests 39/39. Isolated Wrangler D1 upgrade through 0012 passes. Worker dry bundle 4902.31 KiB / gzip 1266.28 KiB. Changed-file lint has zero errors; two existing array-style warnings remain. No paid hardware test performed.
* **Rollout Preflight:** Read-only R2 check confirms object expiration is scoped to `quick-staging/`; `quick-recovery/` is excluded without changing lifecycle rules. Active Worker remains `95ac9894-4830-4c64-8e3d-d8f86ad17338`. Existing local filmstock validation fails for an Amber runtime LUT immutable-lock mismatch, but the unchanged bundled catalogue matches production and all 11 deployed immutable asset hashes match their lock. A code-only rollout can preserve those assets. Preserve live `DASHBOARD_ORIGIN=https://dash.momints.xyz` with `--keep-vars`; it is absent from checked-in configs. Apply migrations 0011–0012 before activation. Connected Seeker `SM02G406193022` currently has V2 QA versionCode 1.
* **Final Server Review:** A conditional SQL reservation also rejects a different receipt whose verification finishes after another roll commits, closing the gap between the open-roll precheck and reservation. Stale dates from a previously unpaid purchase fall back to the verified payment day instead of stranding a newly paid receipt. Both additional regressions pass. These Worker-only refinements do not change the client exported for APK source commit `73b0665`.
* **Build / Hardware:** Client source `73b06658116b53cae160686c4ed8bed7749365cf` built a signed non-debuggable standalone arm64 `com.momints.v2qa` APK, 73,022,242 bytes. SHA-256 `346aaa2cf3c0f3ad64dc6792fb7e3a282c43d7c67736d464173f86ea645a91b8`; existing certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. ADB in-place install succeeded at 08:47:44 Brisbane; device APK digest matches. Cold history launch took 632 ms. Screenshot visually verifies retained connected wallet and 92 on-chain moments, with `L`, Backspace and Test images present. No uninstall/data clear or paid hardware action. APK remains ignored at `.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-73b06658-arm64.apk`; private screenshot under incident evidence.
* **Open / Next:** QA device update is complete. Production rollout approval remains pending; Worker version, database, dashboard and incident records have not changed. Until the new Worker/quote endpoint is activated, this QA client safely stops new roll purchases before payment. See [implementation and concrete rollout](../ROLL-PAYMENT-RECOVERY-IMPLEMENTATION-2026-10-11.md). Tester’s already-revoked 0/12 roll still requires an explicitly authorized remedy; no database-only reopen. No push or paid transaction performed.

---

## Session 2026-10-11: Paid Roll Recovery Investigation and Fix Plan

- **Agent / Author:** Codex / Trav
- **Branch / Scope:** `codex/submission-v2-candidate` at `b4d501a`; investigation and planning only. Owner identifies the tester's build as this branch; exact APK provenance was not provided. No application/Worker implementation, production record, signing, spending, notification, deployment, commit, or push changes.
- **Verified Truth:** Tester paid 0.084038086 SOL at 00:03:54 Brisbane time; Martha collection `BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9` created at 00:04:00. D1 currently COMPLETE with 0/12 frames; delegate handoff landed at 00:06:00. Owner reports no shooting allowance/open-roll UI after payment. The closure initiator and original response failure remain unconfirmed; do not attribute closure to the tester. Current null open-roll response is consistent with COMPLETE, not proof of a SQL query defect.
- **Dashboard Correlation:** Three of six deferred quick attempts belong to tester; three plus the DEAD row belong to another wallet. All seven have null signature-history results on configured and independent public mainnet RPCs, no direct asset accounts, and no upload checkpoints. Not seven confirmed paid mints. Stuck July handoff belongs to treasury wallet; collection absent on current mainnet, provenance unresolved. Both cron schedules/production consumers are enabled. Missing Discord configuration plus a critical-to-low funding transition can leave alert-state timestamp stale; it is not a reliable cron heartbeat.
- **Feedback / Verification:** Ignored `.expo/roll-investigation-2026-10-11/repro-paid-roll.cjs` runs real code with mocked native/payment/network boundaries; five deliberately red tests reproduce receipt masking, second-payment/capability replacement on null-open retry, used-receipt 409, false heartbeat, and quick retry clearing unresolved attempts after three minutes on transient 503. Existing `agent:check` remains 64/71 with the same seven camera/privacy baseline failures. Read-only Cloudflare incident telemetry query returned HTTP 403/code 10000; no historical request trace obtained.
- **Plan / Next:** Read [the investigation and phased fix plan](../ROLL-PAYMENT-RECOVERY-INVESTIGATION-2026-10-11.md) before implementing roll recovery or triaging these dashboard records. Priorities: durable payment operation before broadcast; authenticated idempotent server replay/checkpoints; restore OPEN rolls to shooting; separate close from recovery; retain unresolved quick receipts; independent job/alert status. Tester's current revoked delegate means a database-only reopen is insufficient. Proposed refund/credit/delegate restoration and production recovery remain unexecuted. Raw private snapshots/Worker source stay ignored.

---

## Session 2026-10-10: Original V2 History Recovery

* **Agent / Author:** Codex / Trav
* **Branch / Scope:** `codex/submission-v2-history` starts at original V2 `2c5fe84`, with only the history repair applied. Original wallet hooks/cache remain; the experimental routing repair is retained separately on `codex/submission-v2-wallet-routing`. No Worker or roll API/vault modifications, app push, or agent signing/submission.
* **Owner Result:** After restarting the Seeker, original V2 successfully minted a quickshot titled `L`; owner could not find it in history and reported four roll rows with placeholder images.
* **Verified Diagnosis:** Owner explicitly approved public wallet NFT queries via the app's configured RPC and Arweave metadata reads after automatic review blocked the initial network lookup. Wallet has 120 owned assets; the old screen reads only the first 100. A replay of the live private snapshot through the real service returned 87 rows, including exactly four Core roll collections incorrectly shown as photographs. `L` is indexed with final metadata and JPEG (both HTTP 200). Its Captured trait is display text, not an ISO timestamp. Old sorting puts collection covers with fabricated current timestamps above photographs with unparseable capture labels.
* **Repair:** Exclude Core collections/burnt assets; accept both Momint symbols; fetch all pages in creation-descending order; preserve that order during history merges. Never use metadata JSON as an image. Enrich stale indexed image/date fields from verified local history without mutating cached records. Refresh on screen focus. Add portfolio regressions to the fast suite.
* **Feedback / Evidence:** Five added regressions failed before repair, all nine portfolio tests pass afterward. Private snapshot replay now reads two pages, returns 90 recognized photographs and zero collection covers. Approved live verification returns `L` first, followed by `Backspace` and `Test`, with its final JPEG available. Ignored evidence under `.expo/v2-qa-2c5fe84/`; private snapshots contain public wallet IDs and must not be published with raw wallet logs.
* **Verification:** On the original V2 base, TypeScript passes; fast suite 64/71 and all tests 135/142. The seven failures are the same six pre-existing readiness assertions and one privacy status-copy assertion. Changed-file ESLint and `git diff --check` pass. Committed difference from original V2 is limited to the history screen/service/tests, fast-suite command, and handover notes.
* **Build / Hardware Verification:** Source `4926c0bcf2411f06828acc7df16e5d156a44a8b7` built a signed standalone, non-debuggable arm64 `com.momints.v2qa` APK (73,007,182 bytes), SHA-256 `009368b54226c5f73d71055886896f7ef70fedb20bfffc25268c6c967bee4177`, signer `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Updated V2 in place on `SM02G406193022`; install succeeded and cold history launch took 506 ms. Device shows 90 MOMINTS, `L` first with its actual keyboard photo, followed by Backspace/Test. ALL and QUICK include L; ROLLS shows real frame badges and titles such as `2026-10-02.01.012`, not roll collection covers. Screenshot visually checked; private before/after captures saved in the ignored evidence directory. Wallet connection and local history survived the update.
* **Open / Next:** History repair is verified on hardware. New paid minting was not performed by the agent; owner previously verified minting on original V2 and this build retains that wallet code. Seven pre-existing camera-readiness/privacy-copy assertions remain unresolved. APK `.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-4926c0bc-arm64.apk`; original V2 and experimental routing APKs remain available separately.

---

## Session 2026-10-10: Wallet Identity Deployment and Session Routing Repair

* **Agent / Author:** Codex / Trav
* **Base:** Requested V2 QA commit `2c5fe84ca1692db4e3d4572acbff01b2310fc872`; local repair branch `codex/submission-v2-wallet-routing`.
* **Scope:** Diagnose failed connections/signing on connected Seeker, publish explicitly approved public website identity entry, and repair mobile wallet routing/cache/error handling. No Worker or roll API/vault changes.
* **Verified Identity Fix:** Live `momints.xyz/.well-known/assetlinks.json` omitted `com.momints.v2qa` although app source contained it. Published website commit `b3bce7e7ac03485b3e86dea3b34ed0f3b6e33ddc` in `trav-1111/momints-site`; verified HTTP 200 with original and QA entries and installed certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Both installed apps match this certificate. Post-deploy QA Phantom and Seed Vault authorization calls completed; user-visible callback success still requires confirmation.
* **Confirmed Client Defects:** Installed Wallet UI SDK 3.2.0 discards `wallet_uri_base` and invokes generic association for every operation, including cached tokens. Real SDK regression harness reproduced missing routing and forwarding an old token to an unknown chosen wallet. Local session adapter now persists wallet URI with encrypted authorization, routes subsequent signing to that wallet, freshly authorizes entries without a route, guards account mismatch and overlapping requests, and retries only explicit authorization expiry. All screens use the adapter.
* **Storage/Error Repairs:** Failed secure set/delete now reject instead of falsely succeeding; corrupt encrypted JSON is parsed before purging a recoverable legacy token. Regression tests reproduced both defects before repair. Generic native `CancellationException` no longer claims user cancellation; timeout/network diagnostics survive signing wrappers.
* **Hardware Evidence / Limits:** Seed Vault repeatedly reported `actionSignTransaction result empty` before signing-session termination in original and QA apps. Captured transactions decode, fit packet size, and have valid existing signatures. Owner-approved read-only simulation of the original app's latest unsigned transaction returned no program error (20,886 units); no agent signing/submission/spend occurred. User confirmed both wallets use the same account. These findings do not establish the remaining Seed Vault signing failure's root cause.
* **Verification:** TypeScript passes; 15/15 targeted wallet/cache/error tests pass. Fast suite 66/73 and all app tests 141/148; seven failures are unchanged baseline readiness/privacy assertions. Lint 0 errors / 10 existing warnings. Repair source commit `40c8a9e0666d8e6ae29f089811247ec3c715b4be` built and installed successfully; cold launch 710 ms. APK SHA-256 `a955dc19bcaf69f884592be3a83d59a4e8a1565cf1b677cf96d7a06eea2c9551`, same verified certificate; embedded routing code present and arm64-only.
* **Failed Hardware Retest:** Owner reports another connection prompt from the mint screen and getting stuck in Phantom. Sanitized native evidence shows both connection and mint sessions started with null routing config; authorization completed, then `sign_transactions` ended with `CancellationException`. The repair is incomplete on hardware. Determine whether Phantom omits its optional wallet URI or the client loses/rejects it; investigate signing termination separately. Never claim the mocked routing tests establish a working phone mint.
* **Older APK Differential Test:** Owner installed a previously working APK built from `codex/submission-candidate`: Phantom froze; Seed Vault connected but mint signing cancelled. Candidate ref `9944d77` does not contain encrypted-cache commit `3aae7a3`, has no `walletAuthCache.ts`/`walletSession.ts`, and its provider has no custom cache. Therefore the new encrypted-cache implementation is not necessary to reproduce this failure, and a baseline rollback cannot be presumed to fix it. Device now has only `com.momints.app`, installed at 21:34; recent 21:36 Seed Vault authorization completes, `sign_transactions` cancels, and the Seed Vault implementation reports an empty signing result before biometric cleanup. Phantom 26.32.0 updated Oct 10 at 10:30; Seed Vault Wallet 1.18.0 updated Oct 7 at 11:05 (device-local timestamps). Update timing is a lead, not proof of regression. Power saver is off. Prior app simulation success does not establish wallet signing compatibility. Next isolate phone/wallet state with a restart and an independent signing flow before more speculative app changes; do not clear app or wallet data.
* **Post-Restart Owner Result:** Owner reports the submission-candidate APK now works after restarting the Seeker. This supports a transient shared phone/wallet state contribution; the exact cause is still unproven. V2 was uninstalled before restart and remains untested after restart. Both original V2 `2c5fe84c` and repair `40c8a9e0` APKs remain locally available in `.expo/submission-candidate-apk-20261001`; their SHA-256 hashes were reverified against the build records. No rebuild is needed to retest either artifact. Retest original V2 first to distinguish reboot recovery from repair behavior.
* **Original V2 Reinstalled:** At the owner's request, reverified SHA-256 and installed original `2c5fe84c` APK on `SM02G406193022`; ADB install succeeded and cold launch returned Status ok (477 ms). Both `com.momints.v2qa` and working baseline `com.momints.app` remain installed. Original V2 wallet retest after the restart is pending; the repair APK was not installed in this step.
* **Hackathon Merge Comparison:** Refreshed `origin/hackathon` at `66d41db`; it is an ancestor of repair HEAD `40c8a9e`, 62 commits behind with no divergent commits. Local `hackathon` at `775bb77` is also an ancestor, 60 commits behind. Updating either branch to this HEAD would fast-forward without conflicts, but would carry every later wallet/storage change and the still-failing repair. This does not restore older wallet behavior. Committed delta from remote hackathon is 282 files, 22,997 insertions / 1,627 deletions. No merge, branch checkout, or push performed. Rechecked `agent:check`: TypeScript passes, fast suite 66/73 with the same seven baseline failures.
* **Evidence:** Ignored `.expo/v2-qa-2c5fe84/WALLET-DIAGNOSIS.md`; raw device logs contain private wallet payloads/tokens and must never be published. Original exact-commit APK retained separately.

---

## Session 2026-10-10: Trav V2 QA Commit Pull, Build and Seeker Install

* **Agent / Author:** Codex / Trav
* **Branch / Tested HEAD:** `codex/submission-v2-qa-2c5fe84` at `2c5fe84ca1692db4e3d4572acbff01b2310fc872`, fetched from Trav's `origin`. Previous `codex/submission-candidate` remains at `9944d77`; existing untracked research files preserved.
* **Scope:** Test the requested exact commit, build an isolated standalone `com.momints.v2qa` APK, and install it on Seeker `SM02G406193022` with the owner's explicit approval. No application/backend source changes, push, deployment, or paid actions.
* **Verified Truth:** App TypeScript passes; fast tests 55/62 and all app tests 130/137. Lint has 0 errors / 10 warnings. Worker TypeScript and all 39 Worker tests pass. Filmstock validation fails because ten new runtime LUTs are absent from the immutable lock. Formatting fails on 32 files after accounting for Windows line endings.
* **Failure Diagnosis:** Six readiness tests conflict with the automatic-mode acknowledgement bypass, changed retry policy, and changed shutter disabled expression. One privacy-suite failure asserts mint status copy replaced in `f96df05`. In-memory probes isolated the readiness causes without changing source or build input; probe script removed.
* **Hardware Verification:** Signed non-debuggable arm64 standalone APK built; static package/signature/bundle checks pass; ADB install succeeds alongside existing `com.momints.app`. Cold launch succeeds. Live preview, zoom slider, displayed 2.0× preset, and Pro/JPG/MX/BURST controls observed. Phone later on review with one frame; automated Burst capture not conclusively verified. No paid flow tested.
* **Artifact:** Ignored `.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-2c5fe84c-arm64.apk`, 73,006,450 bytes, SHA-256 `2e919793ae3021b33de3a11b7a115095447485fabc394bcee377a1902f56b964`. Existing debug signing identity used for QA; not a dApp Store release artifact.
* **Open / Next Actions:** Hands-on test Burst, RAW, MX, manual controls and mint flows separately. Resolve acknowledgement policy/test expectations and missing filmstock locks before treating automated verification as green. Full local results: `.expo/v2-qa-2c5fe84/TEST-REPORT.md`. Tested HEAD remains exact; only this handover note is a tracked documentation change.

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

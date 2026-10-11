# Burst repair APK delivery — 11 October 2026

The burst-numbering fix and guarded saved-roll repair are built and installed on Trav's Seeker. The app launches. Actual recovery/minting of the two affected photos remains an owner test.

## Artifact and provenance

- Build commit: `2710ee5f9b916f960bb8078ef33cf86c9d3cfbaf`, local branch `codex/submission-burst-repair-apk-20261011`.
- Base: `22b1b4daee479d2abbc9c2cb11c8f7e94fdbbe0f`. The 13-file partner patch was applied and committed in an isolated checkout; every exported file matched the verified patch source. The original workspace's uncommitted repair and unrelated research/deck work were preserved.
- APK: `.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-2710ee5f-arm64.apk`, **73,030,818 bytes**.
- SHA-256: `fb778bccbdcf3687bad4966d0788c231d1ca8e3a777847f9ab55dc62524089c9`.
- Application: `com.momints.v2qa`, versionName `1.0.0`, versionCode `1`, standalone non-debuggable arm64.
- Existing QA certificate: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. The installed old APK and new APK match this identity. This is the established QA/debug signing key, not a dApp Store release artifact.

The first native build under the longer managed-worktree path failed with CMake path-length warnings and Ninja regeneration errors. The identical clean commit was rebuilt through the unchanged build script using the isolated checkout's Git context and the established shorter `D:/Claude/momints/.expo/apk-src-2710ee5f` export path. The shorter build succeeded; no application source workaround or signing change was introduced.

## Verification and device update

- Exact frozen build source: TypeScript passes and all **19 burst/repair regression tests pass**.
- Required pre-build fast check: **118/125**, retaining the same seven known camera/privacy assertion failures.
- Static APK audit passes: verified signature, matching package/certificate, embedded repair messages absent from the old APK, maintained repair source hashes, existing production client configuration, native camera modules, arm64-only libraries, no fine-location permission, obsolete Kino badge absent, no private file names or known backend credential values found. Pattern/exact-value checks are not a formal proof of absence.
- Device: Seeker `SM02G406193022`. ADB in-place `install -r` succeeded at **16:15 Brisbane**. Pulled installed APK SHA-256 matches the artifact.
- Original first-install timestamp remains `2026-10-10 22:00:24`, app ID remains `10238`, and data directory remains `/data/user/0/com.momints.v2qa`. No uninstall or app-data clear was performed. Private vault contents were not directly inspected.
- Generic launcher intent did not resolve immediately after installation. Explicit `com.momints.v2qa/.MainActivity` launch succeeded cold in **266 ms**. Follow-up verification confirmed the process remained running. One automatic approval review timed out; its single retry succeeded.

Build and audit receipts are ignored local evidence: `.expo/submission-candidate-apk-20261001/build-2710ee5f.json`, `.expo/roll-investigation-2026-10-11/burst-repair-apk-audit.json`, and `.expo/roll-investigation-2026-10-11/burst-repair-device-install.json`. The source archive and successful build logs are retained beside the APK.

## Owner recovery test

Earlier live reads of collection `2xsh4xep7rDKpKJPbBizmicqt6LegGgKWQtF27DFDT2q` showed roll `2026-10-11.01` OPEN at 10/12 with Worker mint authority retained. The ten owned collection assets cover indices 1, 2, 4, 5 and 7–12; 3 and 6 are absent, matching the burst defect. Direct admin D1 access was unavailable, so pending reservations still require the app's authenticated detail check.

Keep the original wallet and installation. Reopen the saved roll and re-queue it, or tap Retry on its failed rows after processing stops, then Continue Minting. The repair independently checks authenticated server reservations against verified encrypted originals and commits the local numbering before uploading. Preserve successful slots; use unused slots only. If it refuses evidence, keep the vault and report the specific error.

Confirm the two images mint into their corrected slots, the roll reaches 12/12, and normal completion succeeds. No mint/retry, wallet approval, Worker deployment, production database mutation, remote push or Drive upload was performed during this APK delivery. Contact Sheet remains a separate pending implementation.

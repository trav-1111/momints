# Handover Brief: Momints Standalone APK Build

**Date:** 2026-10-02  
**Target Project:** Momints (Solana Seeker NFT Camera App)  
**Working Directory:** `/Users/zaac/momints`  
**Active Branch:** `codex/submission-candidate` (tracking `origin/codex/submission-candidate`)  
**Target Commit:** `6596e40` (`fix(build): parse native receipts before log redaction`)

---

## 1. Objective

Compile a standalone, non-debuggable Android APK targeting the Solana Seeker device (`arm64-v8a`) from the latest submission branch (`codex/submission-candidate`).

---

## 2. Environment & Verified Toolchain

All required compilers and SDKs are already present and verified in the local environment:

- **Node.js:** `v22.23.1` / **npm:** `10.9.8`
- **Java:** OpenJDK 17 (`/opt/homebrew/opt/openjdk@17`)
  - `JAVA_HOME=/opt/homebrew/opt/openjdk@17`
- **Android SDK:** `/Users/zaac/Library/Android/sdk`
  - Platform 36, Build Tools 36.0.0, NDK 27.1.12297006
  - `ANDROID_HOME=/Users/zaac/Library/Android/sdk`
  - ADB: `/Users/zaac/Library/Android/sdk/platform-tools/adb`
- **Git Status:** Working tree clean on `codex/submission-candidate`.

---

## 3. Build Architecture & Pipeline

The project uses an isolated, owner-operated build runner located at:

- **Script:** [`scripts/build-submission-apk.cjs`](file:///Users/zaac/momints/scripts/build-submission-apk.cjs)
- **Documentation:** [`docs/SUBMISSION-APK-BUILD.md`](file:///Users/zaac/momints/docs/SUBMISSION-APK-BUILD.md)
- **Gradle Init Script:** [`scripts/android-release.init.gradle`](file:///Users/zaac/momints/scripts/android-release.init.gradle)

### Key Characteristics:

1. **Isolated Export:** The script exports a clean copy of `HEAD` into `.expo/apk-src-<commit>/` so the working tree and active development files are not altered.
2. **Release Target:** Compiles `app:assembleRelease` targeting `arm64-v8a` with `debuggable=false` and embedded Metro JS bundles.
3. **Artifact Output:** Outputs, provenance reports, SHA-256 hashes, and sanitized logs are written to `.expo/submission-candidate-apk-20261001/`.

---

## 4. Signing Identities & Keystores

### Option A: Hackathon-Authorized Debug Signing (Matches existing Seeker test installs)

The repository contains an authorized debug keystore:

- **Keystore Path:** `android/app/debug.keystore`
- **Alias:** `androiddebugkey`
- **Keystore Password:** `android`
- **Key Password:** `android`
- **Verified Certificate SHA-256 Fingerprint:**
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`

To use this, create an ignored `credentials.json` (or `credentials.debug.json`):

```json
{
  "android": {
    "keystore": {
      "keystorePath": "android/app/debug.keystore",
      "keystorePassword": "android",
      "keyAlias": "androiddebugkey",
      "keyPassword": "android"
    }
  }
}
```

Build command:

```sh
node scripts/build-submission-apk.cjs \
  --hackathon-debug-signing \
  --expected-cert-sha256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c \
  --credentials credentials.json
```

### Option B: Official Release Signing (For Google Play / dApp Store)

Provide the production keystore in `credentials.json` with the production alias and passwords, then run:

```sh
node scripts/build-submission-apk.cjs --credentials credentials.json
```

---

## 5. Configuration Prerequisites (`.env`)

The build script validates the app environment before proceeding. The `.env` file (or `--app-env <path>`) must have:

1. `EXPO_PUBLIC_ROLL_API=https://api.momints.xyz` (Exact match required)
2. `EXPO_PUBLIC_ROLL_TREASURY=o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW` (Exact match required)
3. `EXPO_PUBLIC_SOLANA_RPC=<valid HTTPS mainnet RPC URL>`
   - Note: The current `.env` contains a placeholder or dev endpoint. Ensure a real, HTTPS mainnet RPC URL is set (e.g. Helius / Triton / QuickNode) without quotes or placeholders.

---

## 6. Execution Steps for the Agent

1. **Check Environment:**

   ```sh
   cd /Users/zaac/momints
   # Verify .env has matching API, Treasury, and valid HTTPS Mainnet RPC
   ```

2. **Run Preparation Step:**

   ```sh
   node scripts/build-submission-apk.cjs --prepare-only
   ```

   _This exports the clean commit to `.expo/apk-src-<commit>/` and runs prebuild/linter guards without signing._

3. **Execute the Build:**
   _For Hackathon Debug Signing:_

   ```sh
   node scripts/build-submission-apk.cjs \
     --hackathon-debug-signing \
     --expected-cert-sha256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c \
     --credentials credentials.json
   ```

4. **Verify Artifact:**
   Check `.expo/submission-candidate-apk-20261001/`:
   - Verify APK size, SHA-256 hash, non-debuggable flag, and `arm64-v8a` libraries.

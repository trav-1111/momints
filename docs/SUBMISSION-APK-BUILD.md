# Local submission APK build

Owner-operated build path, prepared 1 October 2026. This document describes reproducible configuration, **not evidence that an APK has been built**. Use the private provenance report for the actual build result. There is no cloud build, installation, paid test, Worker deploy or publication in this workflow.

## Source and toolchain

Freeze source on `codex/submission-candidate`. Use Node 22.17.1/npm 10.9.2, JDK 17, Android SDK 36/Build Tools 36.0.0 and NDK 27.1.12297006. The committed script exports **only HEAD** into ignored `.expo/apk-src-<commit>/`, installs locked dependencies, and runs the compatible local Expo prebuild there. It never cleans/regenerates the owner's existing Android project. It rejects changes to maintained source caused by prebuild; the generated Uniwind declaration is the sole explicit exception.

Read app configuration from the owner's ignored `.env` (or `--app-env <secure-path>`). Only the three app fields are forwarded: production API `https://api.momints.xyz`, matching public treasury, and the existing client-appropriate HTTPS mainnet RPC. RPC URLs are redacted in logs. Backend signing keys, operator tokens and webhooks are not copied or forwarded. An app RPC endpoint is still embedded in the final APK and must be client-appropriate.

## Existing release signing identity

The generated Expo Android template signs release with a **debug** keystore unless overridden. Do not use that as the submission identity. Supply an ignored EAS-style `credentials.json` securely with:

```json
{
  "android": {
    "keystore": {
      "keystorePath": "path/to/EXISTING-release.jks",
      "keystorePassword": "REPLACE_SECURELY_LOCAL_ONLY",
      "keyAlias": "EXISTING_RELEASE_ALIAS",
      "keyPassword": "REPLACE_SECURELY_LOCAL_ONLY"
    }
  }
}
```

Relative keystore paths resolve against the credentials file, not the exported workspace. Never commit this file or keystore, paste values into chat, generate a replacement or change the Android package. If held in EAS, retrieve **existing** credentials through the owner's authenticated credentials workflow; do not create new credentials. See [Expo's local release guidance](https://docs.expo.dev/guides/local-app-production/). The Android signing identity is unrelated to the Solana Worker signer.

`scripts/android-release.init.gradle` loads those private inputs directly and configures signing in Android's final DSL phase, after the generated template. It validates the key/certificate, rejects the Android debug identity, keeps `com.momints.app`, and disables release debugging. An optional `MOMINTS_ANDROID_EXPECTED_CERT_SHA256` environment value pins a known public established certificate fingerprint. Passwords are never passed as command-line arguments or written into source/Gradle properties.

## Commands

```sh
# Independent preparation when release credentials are not yet available:
node scripts/build-submission-apk.cjs --prepare-only

# With the existing secure local credentials available:
node scripts/build-submission-apk.cjs --credentials credentials.json

# If that exact commit was already prepared, verify and resume its export:
node scripts/build-submission-apk.cjs --resume --credentials credentials.json
```

The native build command is `gradlew.bat --no-daemon --init-script ../scripts/android-release.init.gradle app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2` in the isolated generated Android directory. This intentionally targets Seeker/arm64; other ABIs are not promised by this artifact. Package/version remain unchanged unless a separately reviewed build commit is needed; equal version code does not resolve a certificate mismatch.

Outputs, redacted logs, source archive and per-file/provenance hashes stay under ignored `.expo/submission-candidate-apk-20261001/`. Resume verifies commit/tree and unchanged exported source rather than overwriting an unrelated workspace. The helper checks APK signature against the loaded key, package, non-debuggable status, arm64 and embedded JS. Extended artifact inspection (permissions, modules, embedded API/treasury, credential leakage and installed-certificate comparison) is still required before calling it ready for Seeker testing.

No device install is automated. A debug-installed Seeker app usually has a different certificate from a production-key APK. Preserve its data and obtain an explicit owner decision for that conflict; never uninstall/clear data or substitute debug signing to hide it. Record full commit/tree, remote SHA, APK SHA-256/size, certificate, versions and external environment/signing inputs privately. These external inputs mean a commit alone does not guarantee a bit-identical APK.

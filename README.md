# Momints

Shoot. Mint. Yours.

Momints is a native Android NFT camera app built and tested on Solana Seeker. Quick Shots and prepaid 12/24-frame rolls become Metaplex Core assets, with photographs stored permanently on Arweave through Turbo. Film development happens on-device; filmstock availability and unlocks come from the Worker and authentic developed rolls.

This repository retains its hackathon development history. The verified origin is `https://github.com/trav-1111/momints`. The owner plans to keep the repository private for submission and grant judges access as needed; public viewing after submission remains an option. Actual reviewer access has not been independently verified.

## Features

- Camera framing and manual controls, capture → develop → reveal, and native on-device LUT/effect processing.
- House films and rotating Film Shelf stocks; developing an eligible roll unlocks that exact stock for future rolls and Quick Shoot.
- Quick Shots and prepaid 12/24-frame rolls, with retry/reconciliation and shooter-owned collections.
- Wallet dropdown access to mint history, mint progress and shareable, non-minted contact sheets.
- Mobile Wallet Adapter and `.skr` wallet-name resolution.
- Temporary Quick Shot captures; unfinished roll photographs retained in an encrypted app sandbox until independently verified completion. History uses permanent image URIs without persistent image caching. Explicit user exports are the user's own local copies.

Solana **mainnet only**. Minting, roll prepayment and permanent uploads use real funds/credits. There is no free/devnet mint mode. A reviewer can inspect code, run local checks and build the camera without minting.

## Reviewer setup

Use Node **22.17.1 / npm 10.9.2** (the verified cleanup environment), or a compatible Node 22 release. The locked React Native 0.81.5 requires Node at least 20.19.4; Worker tests additionally use Node's experimental TypeScript stripping. Install with the lockfiles, not `npm install`.

For Android development, install JDK 17, Android Studio, SDK Platform 36, Build Tools 36.0.0, platform-tools/ADB and NDK 27.1.12297006 (the locked React Native Gradle version catalogue). These match the current Expo 54/native dependency configuration, with Android min SDK 24. Configure `JAVA_HOME` and `ANDROID_HOME`, and add platform-tools to `PATH`. See [React Native environment setup](https://reactnative.dev/docs/0.81/set-up-your-environment) and [Expo development-build setup](https://docs.expo.dev/get-started/set-up-your-environment/).

A physical Android device with camera, USB debugging and a mainnet Mobile Wallet Adapter-compatible wallet is needed for the complete flow; Seeker is the tested device. There are custom native modules under `modules/`, so **Expo Go and a web browser cannot exercise the production renderer/camera**. iOS parity is not certified.

```sh
git clone https://github.com/trav-1111/momints.git
cd momints
npm ci
```

### Option A: existing public API

Copy `.env.example` to the ignored `.env` and supply **your own** mainnet RPC URL. The example API URL is `https://api.momints.xyz` and the public treasury matches that service. Do not request or copy the owner's private environment, signing key or operator token. API availability is an external prerequisite, not a guarantee of repository access or funded mint readiness.

All `EXPO_PUBLIC_*` values are bundled into the app in plaintext. Use a client-appropriate RPC plan with provider restrictions/quotas; never put backend credentials in those fields. See the sanitized environment examples for the three required app fields.

Connecting to this API does not make paid actions safe/free: minting or prepaying a roll uses **your wallet** and production infrastructure. Do not run automated paid tests against it.

### Option B: your own isolated backend

See [independent reviewer backend setup](docs/REVIEWER-SETUP.md). It uses this same Worker source, a separately configured D1/R2/Queue deployment, and your own signer, treasury, RPC and Turbo funding. Merely separating Cloudflare resources does not isolate mainnet or make uploads free.

**Do not run the checked-in production deploy/activation/retirement commands, remote migrations, secret helpers or deployed synthetic test suites against Momints resources.** The default `worker/wrangler.toml` binds Momints production data, even though it deploys in maintenance mode. It is not a reviewer sandbox template.

### Build a development client

```sh
adb devices
npm run android
```

`expo run:android` generates the ignored native Android project, compiles the custom modules and installs a development build. This needs Android build tooling and can download Gradle/Maven dependencies. Changes to native modules require rebuilding; JS-only changes can use `npm run dev`. If USB networking needs it, run `adb reverse tcp:8081 tcp:8081`.

This build depends on Metro. **It is not a standalone submission APK.** `eas.json` retains internal APK and production app-bundle profiles with local signing credentials; their standalone build/signing verification is a separate release task. `npm run android:build` is named historically: it performs **prebuild only**, not APK compilation.

## Non-spending checks

```sh
npx --no-install tsc --noEmit
npm run lint:check
node --test tests/*.test.cjs
npm run fmt:check
cd worker
npm ci --legacy-peer-deps
npm run typecheck
npm run test:filmstocks
npm run test:roll-contract
npm run test:maintenance
npm run test:production-tooling
npm run test:staging
npm run validate:filmstocks
npm run test:migration-upgrade
npm run bundle-size
```

The wildcard runs all nine maintained app suites, including wallet domains, privacy, vault, processing, artifact validation, readiness, reconciliation and registry counting. Worker migration-upgrade checks use an isolated **local** D1 instance. `bundle-size` uses Wrangler `--dry-run` and does not deploy. No credentials, funded wallet or private photographic corpus are needed for these checks. Tooling can still require platform/native dependency installation and network access during `npm ci`.

The Worker's existing TypeScript 7.0.2 pin conflicts with Solana Kit's optional TypeScript 5 peer declaration. Plain Worker `npm ci` currently fails with `ERESOLVE`; the explicit `--legacy-peer-deps` install preserves its existing lockfile and is the tested setup path, not a dependency upgrade or claim of upstream peer compatibility. Resolve that dependency compatibility separately. Root installation succeeds without the flag but reports existing peer/deprecation warnings.

| Script                    | What it actually does                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `android` / `dev`         | Compile/install a native development build / run Metro                                              |
| `lint:check` / `lint`     | Check lint / lint with auto-fix                                                                     |
| `fmt:check` / `fmt`       | Repository-wide Prettier check / formatting                                                         |
| `test:*`                  | Individual maintained app suites; see `package.json`                                                |
| `ci`                      | Typecheck, lint, eight app suites, format check, Android prebuild (wallet-domain suite is separate) |
| `build` / `android:build` | Typecheck + prebuild / prebuild only; neither produces a standalone APK                             |
| `doctor`                  | Downloads the latest Expo doctor; not part of the frozen setup validation                           |

## Source map and documentation

- `src/app/`: camera, review, Quick gallery, mint progress/history and contact-sheet routes.
- `src/services/`, `src/store/`, `src/hooks/`: image lifecycle, encrypted rolls, minting and reconciliation. `services/ipfs.ts` is the still-used metadata builder, not an active IPFS upload path.
- `modules/`: local Android camera-capability, manual-control and EGL film-renderer modules.
- `worker/`: production backend, additive migrations, tests and filmstock publishing contracts. [Worker README](worker/README.md), [filmstock contracts](docs/FILMSTOCKS.md).
- `worker/filmstock-sources/`: approved source LUTs/attribution; `worker/filmstock-assets/`: immutable production recipes/runtime assets/previews. Do not regenerate or reformat immutable packages.
- `tests/`: local app regression suites, including the idempotent roll-registry correction.
- `dashboard/`: separate operator UI; requires an operator token and is not needed for ordinary reviewers.
- `worker-turbo-spike/`, `docs/spikes/irys/`, `ARWEAVE_PATH_OPTIONS.md`: retained historical architecture evidence, not setup/deployment instructions. The camera spike routes are maintained device diagnostics.
- [Production checklist](docs/ROLL-FRAME-PRODUCTION-CHECKLIST.md), [cutover record](docs/NEW-BACKEND-CUTOVER-REPORT.md), [submission cleanup report](docs/SUBMISSION-REPOSITORY-CLEANUP-REPORT.md).

Private corpus/comparison evidence, local secrets, agent settings/worktrees and `worker/filmstock-drafts/` are intentionally excluded. They are not required for builds or ordinary local tests. Private-corpus visual validation remains owner-operated and is not reproducible from a public snapshot alone.

## License and attribution

The owner has chosen to retain rights to the original Momints software and documentation. See [the rights-reserved notice](LICENSE.md), which permits authorized hackathon judges and organizers to clone, build, run and test the submission for evaluation. General reuse, modification or redistribution requires written permission. The former README's bare “MIT” claim was removed during cleanup. Preserve the separate package attribution/license documents under `worker/filmstock-sources/`, `worker/filmstock-assets/` and the package template. Third-party dependencies and separately licensed components remain subject to their own terms.

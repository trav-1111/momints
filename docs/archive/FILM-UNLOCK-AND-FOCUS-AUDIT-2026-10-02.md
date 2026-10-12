# Film unlock and focus audit — 2 October 2026

The connected Seeker reproduced the missing earned-film cabinet state. The AF/MF controls and manual-focus slider were present and drove native lens requests successfully. No focus code was changed.

## Installed app and focus evidence

- Device: Seeker `SM02G406193022`; package `com.momints.app`, version 1.0.0/code 1, non-debuggable.
- The candidate APK provenance records source `6596e401b8d644e616673ea864cfd5d83b96ea5b`. The current camera, manual-controls component and manual-camera hook match its isolated source export after line-ending normalization.
- The initial camera screen had Pro closed. Opening Pro exposed the AF control; selecting AF opened the AF/MF chooser, and MF exposed the focus ruler.
- The active rear camera was ID 0. Its native characteristics reported a 2-diopter minimum-focus distance and AF modes including OFF.
- Settled Camera2 requests with manual focus selected had AF OFF. Slider drags changed lens focus distance from 0 to approximately 2.8033 and then 22 diopters. Selecting Auto restored CONTINUOUS_PICTURE.
- This confirms control visibility and native request application in this session. It does not establish photographic sharpness or rule out an intermittent visibility problem on another camera/session.
- Autofocus was restored, Pro was closed and the temporary device UI dump was removed. No capture, payment, mint, upload, installation or data clearing occurred.

## Two causes of the film regression

1. The app refresh replaced each wallet's saved unlock set with the backend response. A successful empty response therefore removed a film earned by verified roll completion, including when completion happened while a refresh was pending. The local fix merges results into the current saved wallet-specific set and persists it.
2. The Worker checked top-level DAS royalty `creators` for the Momints developed signature. Real Core collections store it at `plugins.verified_creators.data.signatures`. The local fix checks that plugin on collections, retaining the verified Momints signature, original-shooter metadata and known-film requirements. Royalty creators and child assets cannot substitute for the marker.

The live endpoint returned `[]` for the previously verified shooter. A read-only run of the corrected local scan against that wallet's actual indexed collections and Arweave metadata returned `bali-400-v1` and `martha-v1`. Private, credential-free evidence is ignored at `.expo/film-unlock-focus-audit-20261002/unlock-verification.json`.

## Validation and remaining delivery

- App film-policy/store and roll-reconciliation tests: 13 passed. Tests cover empty refresh, persisted cold restart, wallet switching/disconnection, pending-refresh completion, backend additions/deduplication and lookup failure.
- Worker film-package and unlock tests: 13 passed, including realistic Core plugin payloads and rejection of royalty-only, unsigned, foreign, child-asset, wrong-shooter and unknown-film records.
- App and Worker typechecks, focused lint, formatting and diff checks passed. The active-production Worker dry-run bundle passed; Wrangler logging was redirected into ignored workspace output to avoid the sandbox's restriction on its default home log directory.
- The initial audit did not deploy or rebuild. The owner subsequently authorized Worker deployment, APK rebuild and in-place Seeker installation; the completed results follow below.
- Do not merge experimental camera branches to recover the AF/MF controls: the tested controls are already in the candidate.

## Completed deployment and device verification

- Production deployment initially exposed a third issue: the public Arweave gateway returned HTTP 403 to the Worker while workstation reads succeeded. For a collection with the verified Momints marker and `ImmutableMetadata`, the scan now uses the permanent JSON attributes already indexed by DAS. It retains the Arweave URI, original-shooter and known-film checks. Without immutable indexed attributes, a gateway failure returns retryable 502 instead of an empty cabinet.
- Active Worker version: `95ac9894-4830-4c64-8e3d-d8f86ad17338`; deployment: `fd390fae-3f8f-4b3d-a9c8-0cbff83ebff9`. The live endpoint recovers both `bali-400-v1` and `martha-v1`.
- All 16 production bindings match the pre-deployment snapshot, including the dashboard origin and four secret binding names. Production signer and treasury identities, domain, schedules and queue topology remain unchanged; queues were empty. The retired Worker remains offline. No migrations or credential rotation occurred.
- Two fix commits were created separately from the existing dashboard/configuration work: `0f41ed6` and `69ae1c736a18f28c3289c7e34cc5e8d48ee88595`. At deployment completion, nothing had been pushed or merged.
- Standalone APK source: `69ae1c736a18f28c3289c7e34cc5e8d48ee88595`. SHA-256: `c843646100d99cab368b77c69fb04ba44594a6c5a7b15a54ef0384a0368a5bc1`; size: 71,782,926 bytes. This remains a hackathon-only APK signed with the existing debug certificate, not the eventual dApp Store release artifact. It runs in non-debuggable release mode with embedded JavaScript and assets.
- The extended static audit passed: signature/package/certificate, production configuration, native film/camera/Mobile Wallet Adapter modules, embedded bundle, preserved source hashes, no dev launcher, and private-file/known-secret checks. Such checks are evidence, not a formal proof of absence of every possible secret.
- Installed with an in-place update, without uninstalling or clearing data. The pulled installed APK is byte-identical to the audited artifact. The app data-directory inode remained `32815`; all previously visible history entries remained present.
- Both earned films appeared in **Your Film Cabinet**, remained available after background/foreground refresh and two cold restarts, and were selectable for Quick. No fresh relevant runtime errors were found in the final app process. Momints Color was restored as the selected Quick film; the temporary device UI dump was removed.
- Final host validation: 95 app tests, 39 Worker tests, app/Worker typechecks, focused lint/formatting, catalogue validation and the Worker bundle passed. Worker tests require the documented Node type-stripping option for the direct TypeScript maintenance test.
- The three pre-existing dashboard/configuration edits were temporarily stashed for the clean build and restored byte-for-byte after its source export. The temporary stash was removed. Private delivery evidence stays ignored under `.expo/film-unlock-release-20261002/` and the existing APK build-evidence directory.
- No photograph, payment, mint or permanent upload was initiated during this delivery. No new paid roll was required to recover the existing earned films.

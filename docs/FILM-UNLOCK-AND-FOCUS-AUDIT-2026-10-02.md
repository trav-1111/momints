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
- No deployment or APK rebuild has occurred. The installed APK and live Worker still contain the earlier behaviour. The local app fix cannot reconstruct an unlock already erased; the corrected backend lookup supplies that recovery after delivery.
- Next: deploy the source fix through the existing guarded active-production workflow, preserving the pending dashboard configuration changes; rebuild a candidate APK containing the persistence fix; then verify both earned films survive foregrounding and cold restarts on Seeker. No new paid roll is necessary to recover the verified existing unlocks.
- Commit these fixes separately from the pre-existing dashboard/configuration work. Do not merge experimental camera branches to recover the AF/MF controls: the tested controls are already in the candidate.

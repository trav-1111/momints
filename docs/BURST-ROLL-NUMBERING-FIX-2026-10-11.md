# Burst roll numbering fix — 11 October 2026

Current status: the repair APK was subsequently built and installed in place; see [APK delivery](BURST-REPAIR-APK-2026-10-11.md). The owner has authorized committing and pushing this repair to `origin/codex/submission-v2-candidate`. Runtime source matches build commit `2710ee5f9b916f960bb8078ef33cf86c9d3cfbaf`; saved-roll recovery on the device remains unverified.

Owner reported two failed frames on the latest V2 QA APK, both captured in bursts. The progress screen showed duplicate Frame 2 and Frame 5 labels, with `Frame retry bytes do not match the original verified artifact`.

## Confirmed cause

The asynchronous `handleStartCrank` callback held the render-time `activeRoll` object. Zustand replaces that object when an exposure commits, so reading `activeRoll.frameIds.length + 1` in each iteration reused the burst's first frame number. Both the photo record and encrypted manifest received that duplicate. The mint queue correctly retained the saved number. The first upload occupied the server frame slot; the next different image targeting that slot was correctly rejected by the Worker's byte-bound retry guard.

Before changing source, a local harness executing the actual callback and immutable session/photo stores reproduced `[2,2]` instead of `[2,3]`, `[5,5]` instead of `[5,6]`, and the exact Worker error. Native capture/rendering and filesystem boundaries were mocked; no paid transaction was executed.

## Implemented changes

- Burst registration reads current session state for every developed photo, using one number consistently for the photo and encrypted manifest before advancing the exposure counter.
- Burst capacity and completion use current state. An immediate in-flight guard blocks overlapping bursts and normal capture during a burst. Roll identity is checked before registration and after the awaited encrypted commit. A failed encrypted commit removes the uncommitted photo record without consuming an exposure; a committed frame remains encrypted if the active roll changes.
- Existing duplicate numbers can be repaired when re-queueing a roll or tapping Retry after minting has stopped. The repair authenticates the Worker detail read and uniquely matches each server-reserved slot, including pending uploads/mints, to the encrypted original's complete image receipt. It preserves reserved slots and fills unused slots only with unreserved local photos, within the purchased size.
- Repair refuses ambiguous or absent receipts, mismatched owners, closed rolls, inconsistent local membership, corrupted encrypted images, active uploads and changing server state. It does not clear authorization, delete server checkpoints, overwrite images or move already minted assets.
- Numbering is committed and verified in the encrypted manifest before photo/queue state changes. Manifest mutations are serialized so metadata updates cannot overwrite repaired numbers. The previous manifest generation survives a torn repair write, and an interrupted queue update resumes from the committed mapping, including offline.

No Worker code, D1 schema, production records or blockchain state changed.

## Verification

- Nineteen new maintained regression tests pass and are included in `npm run agent:check`; run them separately with `npm run test:burst-roll`.
- TypeScript passes. Fast suite: **118/125**. Full app suite: **189/196**. The same six camera-readiness assertions and one privacy-copy assertion remain baseline failures; no new suite failures.
- Tests cover actual callback execution, current-state capacity, completion, overlapping invocation, Quick bursts, failed commits, roll changes, reserved-slot matching, real AES-GCM encrypted vault round trips, unchanged encrypted image bytes, authenticated-owner guards, queue alignment, concurrent metadata updates, crash continuation and torn writes.
- The initial implementation did not build/install an APK or execute a production repair. The later delivery installed the repair APK without clearing app data. The publication check again passes TypeScript and retains the same seven baseline failures (118/125); owner-driven saved-roll Retry and fresh burst QA remain pending.

## Owner recovery after APK update

Update in place and retain app data. Reopen the original roll and mint it, or tap Retry on a failed roll frame once processing stops. The repair runs before that retry is made pending; then Continue Minting uploads the corrected queue entry. Successful existing frames retain their original server slots. If an evidence check fails, the app keeps the vault and explains the blocker. Do not delete frame checkpoints to bypass the byte guard.

## Separate contact-sheet finding

The owner also reported 102 History moments but zero minted rolls and one Quick Shot in Contact Sheet. Source inspection confirms History merges wallet on-chain portfolio assets with device-local mint history, whereas Contact Sheet reads local mint history only and filters roll groups to complete expected frame sets. The two screens therefore count different populations. Contact Sheet needs a shared wallet portfolio source and trustworthy complete-roll grouping; that separate change is not included here. No live device inventory was inspected for this count discrepancy.

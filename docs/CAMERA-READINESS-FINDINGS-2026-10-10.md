# Camera readiness: history and remaining test failures

Date: 10 October 2026 (Australia/Brisbane)

Reviewed branch: `codex/submission-v2-candidate`

Reviewed HEAD: `b4d501a96ac3a817052e34ac628189b9035add1a`

Original V2 under investigation: `2c5fe84ca1692db4e3d4572acbff01b2310fc872`

## Findings

The camera-readiness tests originated in the earlier camera-hardening work included in the first submission candidate. They were not introduced during the current V2 wallet/history investigation.

Six camera assertions now fail because V2 changed the readiness contract, retry policy, and shutter-button behavior. A seventh failure, in the privacy suite, concerns removed mint-status wording. These are seven failing tests, not seven independently confirmed device bugs.

The history repair did not change camera readiness or these tests. The failures were already present at the original V2 commit.

## Development history

| Date | Commit | Significance |
| --- | --- | --- |
| 28 September 2026 | `53f7f691e0d21451aa0a80c08b341812bb320629` | `fix(camera): gate capture on acknowledged session controls`. Added readiness hooks, native acknowledgment handling, 15 regression tests, and the original QA report. Work was documented on `feat/filmstock-native-hybrid`. |
| 1 October 2026 | Submission build/preparation commits | Packaging and submission preparation followed the readiness work. The readiness commit is an ancestor of the earlier `codex/submission-candidate` at `9944d77`. |
| 5 October 2026 | `76e2079` | Updated camera controls and tests for decoupled ISO/shutter behavior and long exposures. |
| 6 October 2026 | `767ebb7`, `518baab` | Further manual-exposure and 1/60-second baseline changes updated the tests. |
| 10 October 2026 | `abf9d426b0897eb3a0757ac64070f1da4a13278c` | Introduced the default-auto acknowledgment exception, expanded binding retries, and changed shutter-button behavior. The six camera expectations were not aligned with those changes. |

The original [September QA report](CAMERA-READINESS-QA-2026-09-28.md) is a historical record. Its references to uncommitted work and no push describe the state when it was written; Git subsequently records it in `53f7f69`.

## What camera readiness means

A React camera reference existing, the native camera being initialized, the camera streaming, and requested settings finishing application are separate events. Navigation, backgrounding, and lens changes can replace a camera session while an earlier settings operation is still completing.

The original contract required all of the following before capture:

1. A current, active, streaming camera session.
2. A native acknowledgment belonging to that same session and lens.
3. An acknowledgment for the latest complete desired settings and retry generation.

Stopping, detaching, backgrounding, or invalidating the camera immediately removed readiness. Old completions could not make a new session ready. Only the known `ERR_CAMERA_NOT_BOUND` binding race retried automatically, with three total attempts and 100/200 ms delays. Other errors remained visible and required explicit recovery.

V2 still checks that the camera session is current and streaming. However, when every control is at its default automatic setting, it now permits capture without waiting for the settings acknowledgment and suppresses settings errors. Nondefault/manual settings still require the matching acknowledgment.

## What the tests actually exercise

[tests/camera-readiness.test.cjs](../tests/camera-readiness.test.cjs) runs the actual React hooks through `react-test-renderer`, with native camera boundaries mocked. The harness can delay, resolve, reject, and reorder native settings promises to exercise timing races deterministically.

Coverage includes start/stop/rebind, lens changes with reused view handles, backgrounding, rapid settings changes, stale completions, retry exhaustion/recovery, cancellation on unmount, runtime errors, and the capture boundary. Some assertions inspect source text, including the shutter disabled expression and native timeout/identity guards.

These tests do not take photographs, measure physical sensor exposure, or fault-inject native timeouts on a device. An acknowledgment confirms completion of the native settings operation; it does not by itself prove the resulting still image used the intended exposure.

## The seven remaining failures

| # | Test and location | Expected behavior | Current behavior and interpretation |
| --- | --- | --- | --- |
| 1 | Camera: “a ref and initialized event are insufficient until the camera starts and settings acknowledge” (`tests/camera-readiness.test.cjs:67`) | Capture stays blocked after streaming starts until settings acknowledge. | Default-auto mode allows capture as soon as the current session streams. This is a readiness-policy mismatch with a possible early-capture consequence. |
| 2 | Camera: “a previous session completion cannot enable capture in a rebound session” (`:128`) | A restarted session waits for its own settings acknowledgment. | The new default-auto session is already capture-ready without acknowledgment. This failure does not demonstrate that the old callback incorrectly enabled capture; stale-session guards remain. |
| 3 | Camera: “only the known not-bound race retries, at most three attempts” (`:191`) | Three total attempts; retries after 100 and 200 ms. | Nine total attempts; first delay 150 ms, then 300/450 ms, capped at 600 ms for subsequent retries. The first failed assertion checks too early under the new timing. |
| 4 | Camera: “a binding-race retry can recover, but capture waits for its acknowledgement” (`:212`) | A retry occurs at 100 ms, and capture waits for its acknowledgment. | The first retry occurs at 150 ms. Default-auto capture also no longer waits for acknowledgment. Both timing and readiness expectations differ. |
| 5 | Camera: “unexpected failures are surfaced without retry; explicit retry requires a new acknowledgement” (`:258`) | Timeout, session-change, apply, and cancellation errors are visible and block capture until successful recovery. | In default-auto mode, `controlsError` is suppressed and capture remains permitted while the session is valid. This is the most consequential behavior mismatch because settings failures can be invisible. |
| 6 | Camera: “capture gate precedes sensor call and queue entry; native acknowledgement is bounded and identity checked” (`:414`) | Literal source contains `disabled={isCapturing || !controlsReady}`. | The button now stays tappable while settings are unready so its handler can request a retry. The capture guard still precedes sensor capture and queue entry. The failing assertion is outdated source text; later native assertions in this test are not reached after that failure. |
| 7 | Privacy: “roll Arweave propagation is pending rather than a failed mint” (`tests/privacy.test.cjs:147`) | Mint progress contains the exact phrase “Your mint is safely recorded.” | That phrase was removed in `f96df05`. Earlier assertions for pending permanent-image handling still pass. This failure does not establish a privacy leak, lost mint, or broken propagation handling. |

Line references describe the reviewed HEAD and may move after later edits.

## Verification evidence

The focused rerun used:

```powershell
node --test tests/camera-readiness.test.cjs tests/privacy.test.cjs
```

Result: **29 tests, 22 passed, 7 failed**, matching the previously recorded baseline.

Earlier full verification for the history repair recorded **135/142 passing**, with these same seven failures. App TypeScript and changed-file lint checks passed. These historical results are not a claim that the full suite was rerun for this Markdown export.

Earlier temporary in-memory diagnostic probes, without changing source files or APK inputs, isolated the camera causes:

- Requiring acknowledgment in default-auto mode reduced six camera failures to three.
- Also restoring the old retry policy reduced them to one.
- The remaining failure expected the old literal shutter disabled expression.

The temporary probe script was removed. Diagnostic logs remain in ignored local QA artifacts.

## Historical device verification and limits

The September report records Seeker verification at the time of the original readiness implementation:

- 12 camera → reviewer → camera remount cycles passed.
- Eight alternating front/back switches passed with matching camera identities.
- ISO 800, 1/1000-second shutter, and Daylight white balance were acknowledged and reapplied after a background/foreground transition.
- Invalid camera identities and nonexistent handles were rejected without invoking sensor capture.
- Twelve synthetic develop/review/remount cycles passed; these were generated-image processing checks, not sensor-exposure tests.

These are historical results for the earlier implementation, not fresh validation of V2's auto-mode exception. The report explicitly leaves long manual-exposure extremes, hardware timeout fault injection, and sensor capture with manual controls for targeted follow-up. An overlapping diagnostic/production camera-view transition also lost preview; simultaneous-camera-view support was not established.

## Relevance to the expanded camera feature set

The original suite remains useful, but it needs updating and expanding. It describes the earlier camera's readiness contract; passing every old assertion would not automatically prove the current camera works correctly across its newer features.

### Protections that remain relevant

These guarantees apply regardless of how many capture modes or controls are added:

- Switching lenses must invalidate the previous session.
- Old settings callbacks must not enable capture in a new session.
- Backgrounding, stopping, or detaching the camera must block capture.
- Rapid control changes must apply the latest requested settings.
- Scheduled retries must stop when their camera session ends.

Retain these protections and test them across the relevant capture paths. The default-auto exception means a test intended to isolate stale acknowledgments should use settings that actually require acknowledgment, so that it cannot fail merely because auto mode is already ready.

### Expectations that need a current design decision

Waiting for acknowledgment in default-auto mode, permitting exactly three retries, and disabling the shutter versus allowing a press to trigger recovery are implementation policies rather than universal camera requirements. Their tests should reflect the intended current behavior after that behavior is verified.

Relaxing an obsolete rule must not accidentally remove a useful guarantee. Allowing default-auto capture before acknowledgment may resolve a stuck shutter, but manual-to-auto transitions still need verification that previously applied manual settings are reset correctly. Suppressing all settings errors in default-auto mode deserves separate review.

The removed mint-status sentence is unrelated to the camera's expanded features. Its assertion should be assessed against the intended pending-mint user experience.

### Additional verification for newer capture paths

The following are recommended coverage areas, not a claim that all other feature tests are absent or that these checks have already passed:

| Feature or transition | Additional verification needed |
| --- | --- |
| Manual exposure and long shutter | Requested settings reach the sensor; readiness and timeouts accommodate the supported exposure duration. Native acknowledgment alone does not establish the resulting image's exposure. |
| Burst/Kino | Stop, navigation, backgrounding, and errors safely end the capture sequence; pending operations cannot continue against an invalid session. |
| RAW | Correct camera ownership, capture completion, and preservation of the intended file. |
| Mode transitions | Previous mode settings and pending operations cannot affect the next mode; manual-to-auto reset behaves correctly. |

The preferred approach is to retain lifecycle and stale-callback protections, revise policy-specific assertions, and add coverage around the newer capture paths. The seven failures alone are an incomplete measure of camera quality and do not justify restoring the old implementation wholesale.

## Recommended follow-up

First decide and verify whether default-auto capture may safely proceed before settings acknowledgment, especially when returning from manual controls to auto. Confirm what the user should see if that settings application fails. This should precede weakening the failing readiness assertions.

Then align retry timing/limits with the intended policy and replace brittle shutter/copy assertions with behavioral checks where practical. Target device QA should cover immediate capture after camera entry, lens changes, foreground recovery, manual-to-auto reset, and explicit error/retry recovery.

No camera implementation or test expectations were changed as part of this explanation/export.

## Source references

- [Original camera QA report](CAMERA-READINESS-QA-2026-09-28.md)
- [Camera-readiness tests](../tests/camera-readiness.test.cjs)
- [Privacy tests](../tests/privacy.test.cjs)
- [Session readiness hook](../src/hooks/useCameraReadiness.ts)
- [Manual camera state and capture readiness](../src/hooks/useManualCameraState.ts)
- [Camera screen and shutter handlers](../src/app/camera.tsx)
- [Mint progress screen](../src/app/mint/progress.tsx)
- [Current handover ledger](agent/HANDOVER_LEDGER.md)
- Local ignored QA evidence: `.expo/v2-qa-2c5fe84/TEST-REPORT.md` and `seven-failures-explanation.log`.

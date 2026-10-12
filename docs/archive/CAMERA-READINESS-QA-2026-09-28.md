# Camera readiness guard — 28 September 2026

Branch: `feat/filmstock-native-hybrid`. Uncommitted; no push, merge or deployment.
This change does not alter the Worker, film renderer, mint transactions, fees,
treasury, queue registration or encrypted roll-vault lifecycle.

## Implementation

- `src/hooks/useCameraReadiness.ts`: distinguishes a native view handle from an
  initialized, started session. Tracks lens identity and session generation;
  synchronously invalidates capture on stop, detach and error.
- `src/hooks/useManualCameraState.ts`: retains complete desired controls while
  inactive, reapplies them after initialization/restart, and accepts only the
  acknowledgement for the current session and current desired state. Retries
  only `ERR_CAMERA_NOT_BOUND` (three attempts total, 100/200 ms backoff); stale
  completions and scheduled retries are cancelled/ignored. Other current errors
  remain actionable. Reset works even when no camera is bound.
- `modules/camera-manual/index.ts` and
  `modules/camera-manual/android/src/main/java/expo/modules/cameramanual/CameraManualModule.kt`:
  asynchronous main-thread application, expected camera-ID check, and CameraX
  completion-future acknowledgement. Completion also checks that the bound
  camera object is unchanged. A 3–20 second deadline accommodates the requested
  shutter duration; this is a timeout, not an added processing delay.
- `src/app/camera.tsx`: lifecycle callbacks, inactive-app invalidation, disabled
  shutter until acknowledgement, capture rechecks after downloads and torch
  delay, and recoverable control errors rather than an uncaught React effect.
  Tap-to-focus is gated too. Existing verified-film-before-queue logic remains.
- `src/app/spike-manual-controls.tsx`: adapts the diagnostic screen to the same
  contract and observes focus/app activity instead of being always active.
- `tests/camera-readiness.test.cjs` and `package.json`: 15 readiness regression
  tests and a CI/test-script entry.

## Host verification

- 58 tests passed across camera readiness, film processing, filmstock policy,
  privacy, encrypted roll vault and wallet-domain suites.
- App typecheck, changed-file ESLint and Prettier checks passed.
- Android arm64 debug build passed and was installed in place, without clearing
  app data. Existing third-party Gradle/native deprecation warnings remain.

The new tests execute the actual React hooks with mocked native boundaries.
They cover early refs, start/stop/rebind, reused view tags across lenses, rapid
settings changes, stale success/failure, successful and exhausted retries,
unmount cancellation, unexpected errors, explicit recovery, unbound reset,
native-wrapper acknowledgement, runtime camera errors and the capture boundary.
Native timeout behaviour itself is source-checked, not fault-injected on-device.

## Seeker verification

Device: Seeker `SM02G406193022`, Android 16/API 36; rebuilt debug APK with Metro.
Readiness/settings were inspected through temporary developer-runtime tooling,
not an entitlement bypass or a shipping test switch.

- 12 camera → empty reviewer → camera replace/remount cycles passed. Every
  returned camera had an acknowledgement for its bound session and an enabled
  shutter; no photos or active-roll records were changed.
- 8 alternating front/back switches passed on one native view handle, with
  acknowledgements matching camera IDs `1`/`0` respectively.
- ISO 800, 1/1000 s, Daylight WB were acknowledged. An explicitly observed
  Home → foreground transition advanced the session generation from 23 to 24
  and reapplied those same settings before enabling the shutter.
- Wrong camera ID rejected with `ERR_CAMERA_SESSION_CHANGED`; nonexistent view
  handle rejected with `ERR_CAMERA_NOT_BOUND`. Neither invoked a sensor capture.
- Navigation through the app's `Slot` unmounts the camera even on push/back.
  Fresh mounts therefore keep existing auto-default behaviour; this change does
  not add persistence of manual settings across destroyed React components.

An initial debug-camera → production-camera transition lost the native preview
while both camera views overlapped. Readiness stayed false (no React crash).
That diagnostic screen was previously always active; it now observes focus and
app state. The passing production remount tests use a non-camera reviewer in
between. They do not prove simultaneous-camera-view support.

The initial background harness stalled while inspecting the inactive app.
Its interrupted five-cycle attempts are not counted as
passing tests. The separately recorded foreground verification above passed.

## Synthetic develop/reveal stress and cleanup

Inputs are the existing generated 4000 × 3000 high-detail sRGB texture, not
personal photographs. Processing uses the permitted house Color stock, then
the existing quick-shot size fitting and real reviewer. No mint or save action
is invoked. This is not sensor timing or production filmstock visual approval.

All **12** full-resolution develop → size-fit → real reviewer → forced camera
remount cycles passed. Every preview existed, each photo remained pending only,
and every returned camera had current settings acknowledged with its shutter
enabled. The prior forced-remount failure after six cycles did not recur.
Filtered current-process logs contained no uncaught binding/React errors.

- Native processing p50/p95: **650 / 739 ms**.
- Develop plus quick-shot fitting p50/p95: **1,215 / 1,477 ms**; excludes sensor
  capture and camera reinitialization. Debug-runtime synthetic measurements,
  not a release-build latency guarantee.
- Settled Graphics after first/final cycle: **30.87 / 30.87 MiB**; per-cycle
  range **30.54–31.12 MiB**. The pre-run baseline was 24.58 MiB, so there was
  initial warm-up allocation, not a zero-allocation claim.
- Sampled transient Graphics / Native Heap / total PSS peaks:
  **179.76 / 385.65 / 793.00 MiB**. Sampling can miss the exact peak; this fix
  does not reduce full-resolution processing's transient memory requirement.

Cleanup confirmed: zero session photos, no remaining capture or display-preview
files, and both dedicated QA directories removed after validating their exact
app-owned paths. The single `/data/local/tmp/momints-hybrid-textured.jpg` upload
was also removed; its generated source remains on the host. No personal photos,
gallery files or roll vaults were opened or deleted.

Long manual-shutter extremes, timeout fault injection on hardware and sensor
capture with manual controls still need targeted follow-up QA. Filmstock visual
approval remains a separate gate, unchanged by these synthetic checks.

Raw generated QA reports live in ignored `.expo/hybrid-seeker/`:
`camera-readiness-remounts.json`, `camera-readiness-settings.json`,
`camera-readiness-foreground.json`, and `camera-guard-reveal-memory.json`.
Cleanup evidence: `camera-readiness-cleanup.json`.

A final clean app restart with the final source passed: current session
acknowledged, shutter enabled, zero photos, no current-process camera/React
errors. Startup removed the now-empty temporary capture/preview directories.
Evidence: `camera-readiness-final-boot.json`. The Seeker is left running this
hybrid debug build; no mint, save, commit, push, merge or deployment was performed.

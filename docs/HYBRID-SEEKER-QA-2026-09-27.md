# Hybrid renderer — Seeker QA, 2026-09-27

Branch: `feat/filmstock-native-hybrid`. The arm64 debug APK was installed in
place without clearing app data. No commit, push, merge, deployment, mint,
payment, photo-library save, or active-roll mutation was initiated by these tests.

## Scope and method

Inputs were generated SDR sRGB JPEG colour patches, colour/greyscale gradients,
an EXIF-orientation fixture, and a deterministic higher-detail texture. No
personal photos or private canonical corpus images were used. Full-resolution
inputs were 4000×3000. The flat fixture was 417 KB; the textured fixture was
5.705 MB. These exercise image processing, not the camera sensor's capture time.

Tests called the actual production package loader, native renderer, receipt
verification, quick-shot compressor, preview service and reviewer component.
Normal UI navigation used the camera's existing `push('/review')` / back path.
No graded live-preview benchmark or entitlement bypass was introduced. Bali
was not Quick Shoot-eligible in the connected wallet state, so UI reveal tests
used house film. Bali and Martha were tested directly with synthetic inputs as
engine/package diagnostics, without registering them for minting.

`dumpsys meminfo` was sampled throughout processing and after each cycle,
approximately every 180 ms plus command overhead. Values are whole-app PSS,
not exclusive renderer allocations. Peaks are sampled lower bounds; short peaks
can be missed. Settled measurements followed a 750 ms pause, with a final
five-second pause. Driver/debugger state was not cleared between all phases.

## Results

| Test                                                                          | Completed cycles | Processing p50 / p95 | Settled Graphics, baseline → final | Sampled peak Graphics / Native Heap / total PSS |
| ----------------------------------------------------------------------------- | ---------------: | -------------------- | ---------------------------------- | ----------------------------------------------- |
| Flat 12 MP, processing only; Bali/Martha/house Color/B&W                      |               24 | 365 / 399 ms         | 32.44 → 32.44 MiB                  | 227.5 / 350.5 / 813.4 MiB                       |
| Flat 12 MP, real reviewer and repeated camera remount                         |               24 | 341 / 378 ms         | 34.12 → 34.09 MiB                  | 182.7 / 388.3 / 799.6 MiB                       |
| Textured 12 MP, normal camera → reviewer → back, including quick-shot fitting |               24 | 635 / 683 ms         | 34.48 → 33.91 MiB                  | 228.3 / 387.0 / 786.9 MiB                       |

All three completed phases had no rendering, checksum, pixel-canary or encoding
failures. The higher-detail normal-navigation phase had Native Heap PSS
251.4 → 248.9 MiB and total PSS 515.1 → 503.0 MiB. There was no accumulating
Graphics trend resembling the earlier repeated-reveal issue in this test window.
Transient allocation remains substantial: the change bounds/releases per-frame
resources; it does not eliminate their peak cost.

On the textured quick-shot input, compression/verification took p50 502 ms /
p95 529 ms. Processing plus fitting/verification took p50 **1165 ms**, p95
**1257 ms**, maximum 1268 ms. The 5.688 MB developed house-film JPEG became a
1.821 MB upload JPEG without changing 4000×3000 dimensions. These times exclude
sensor capture and actual first onscreen presentation. Separate Bali/Martha
textured renders took 632/639 ms; their reveal derivatives took 243/240 ms.

An additional 12 textured review-only cycles passed with camera initialization
isolated. A separate forced-remount phase stopped after six completed cycles;
its failure is retained below, not counted as a completed 12-cycle pass.

## Correctness, packages and fail-safes

- Bali and Martha GPU LUT-only outputs were compared with the existing CPU
  trilinear reference using the **same quantized deployed atlas**, separating
  LUT behaviour from grain/spatial effects. Raw-reference mean absolute channel
  error was 0.681/0.714 on the 0–255 scale; p95 was one level. Large maxima
  (121/128) occurred at abrupt colour boundaries against an uncompressed
  reference. Matching the native JPEG encoder's 4:2:0 subsampling reduced mean
  error to **0.052/0.060**, p95 to zero and maximum to five. This identifies
  JPEG edge/chroma loss and rounding, rather than a LUT/channel mismatch.
- Synthetic gradients, patches and orientation looked correct. The EXIF-6
  input became 480×640. Both exported full image and reveal derivative were
  sRGB JPEGs. Bali's 4000×3000 full-recipe output and 2688×2016 reveal derivative
  showed the same look; preview generation does not apply the LUT again.
- The actual synthetic reviewer image was inspected onscreen. Skin-coloured
  patches are not a replacement for real skin-tone/canonical visual approval.
- Bali downloaded through the normal live catalogue/package URLs in **810 ms**.
  Recipe identity and the 143,764-byte runtime hash matched the previously
  cached production package. Cached verified reload took **14.7 ms**; cached
  LUT package reads across runs were approximately 13–32 ms. GPU upload was not
  timed separately. The original device package cache was restored afterward.
- Cached Bali rendered successfully with fetch calls blocked by a temporary
  QA network-failure simulation (zero network calls). This is not a physical
  airplane-mode/restart test.
- Seven failure cases rejected correctly: missing LUT, checksum mismatch,
  unsupported engine, invalid effect settings after allocation, invalid source
  after output creation, wrong recipe hash, and a missing LUT through the normal
  production loader. Inputs remained intact until cleanup, partial outputs were
  absent, and photo count was unchanged. This complements the host camera
  registration-order regression; it is not an actual shutter/failure UI test.

## Separate camera readiness failure

At device time 22:45:54, the higher-detail **forced replace/remount** stress path
logged:

```text
CameraManual.applyCameraState rejected
ERR_CAMERA_NOT_BOUND
No bound CameraX session on view 8210 yet — try again once the preview is visible
```

The uncaught manual-controls effect caused a React component error. A later QA
navigation request then reported that the Root Layout was not mounted. The app
process remained alive; the corresponding LUT render/compression had succeeded.
The hook and native manual-controls module are unchanged from the base branch:
`useManualCameraState` applies overrides when a view tag appears, without a
session-readiness gate or catch/retry. This is evidence of a camera binding race,
not evidence of a failed LUT render. It did **not** recur in the 24-cycle normal
push/back test; forced-remount results cannot be substituted for normal navigation.

Recommended follow-up: gate control application on confirmed session readiness,
reapply the full desired state after rebinding, and use bounded, cancellable
retries only for `ERR_CAMERA_NOT_BOUND`. Do not silently swallow other failures.
No camera-controls fix was made as part of this QA turn.

## Cleanup and remaining gates

All generated device inputs, outputs, reveal derivatives, temporary download
backup, test-only package directory and shell staging files were removed. The
capture and display-preview directories were verified empty, and no test photos
remained in the photo store. App data, gallery content and encrypted roll storage
were not cleared. Pre-existing root-cache `_film.jpg` files were observed by name
only and left untouched; this report does not claim that older builds' entire
disk cache is photo-free. Test images retained on the PC are synthetic only.

Still pending: actual sensor capture, private canonical scene/skin approval,
HEIC/P3/HDR normalization, other EXIF mirror/orientation cases, genuine offline
restart, authenticated Film Shelf/Film Cabinet UI and an actual prepaid-roll
recovery/mint lifecycle. No production visual approval is granted by this test.

Local artifacts (ignored, not pushed):

- [Bali: original / CPU LUT-only / Seeker LUT-only](../.expo/hybrid-seeker/comparison-bali-400-v1.jpg)
- [Martha: original / CPU LUT-only / Seeker LUT-only](../.expo/hybrid-seeker/comparison-martha-v1.jpg)
- [Bali: original / full recipe / reveal derivative](../.expo/hybrid-seeker/preview-final-bali.jpg)
- [Actual synthetic reviewer screenshot](../.expo/hybrid-seeker/review-screen.png)
- Raw memory samples and per-cycle results: `.expo/hybrid-seeker/*-memory.json`.

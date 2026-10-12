# Solana Seeker Hardware Specification & Camera Reality Reference

**Device Target:** Solana Seeker (SM02 / DVT Hardware)  
**OS / Platform:** Android 16 (API 36) — arm64-v8a  
**Display Matrix:** 1200 × 2670 px (~20:9 native viewport)  
**Package:** `com.momints.app`  
**Purpose:** Single source of truth for engineering and autonomous agents (`antigravity`, `hermes`, `codex`). Corrects early assumptions and hardware probe discrepancies.

---

## 1. Executive Summary: What Trav Got Right vs. What Broke on Hardware

Early project documentation made several conceptual assumptions regarding Android Camera APIs and hardware behavior that do not match the physical Solana Seeker device:

| Area | Early Assumption (Trav / Spike) | Verified Hardware Reality (Zaac / On-Device) |
| :--- | :--- | :--- |
| **AE Priority Modes** | Assumed `CONTROL_AE_AVAILABLE_PRIORITY_MODES` (API 36 reflection) would allow semi-auto ISO-priority and Shutter-priority. | **Unsupported by HAL.** The vendor HAL does not support decoupled AE priority modes. Manual ISO and Shutter require explicit manual lock (`CONTROL_AE_MODE_OFF` or manual target locking via `Camera2CameraControl`). |
| **Still Photo Capture** | Assumed CameraX / VisionCamera `takePhoto()` would inherit repeating preview settings. | **Still requests reset parameters.** CameraX still captures re-evaluate exposure parameters unless explicitly bound to the capture request pipeline. |
| **Touch Metering & Reticle** | Assumed view-relative coordinates (0.0 to 1.0) could be passed straight to metering rectangles. | **Aspect ratio distortion.** Viewfinder is letterboxed (4:3 sensor in 20:9 display). Screen touch coordinates must be mapped to `SENSOR_INFO_ACTIVE_ARRAY_SIZE` with orientation & contain-fit scaling. EV slider calibrated to 20dp increments. |
| **RAW & Multi-Surface** | Assumed CameraX could easily multiplex simultaneous RAW DNG + Graded JPEG without frame drops. | **Requires dedicated Camera2 pipeline (`modules/camera-raw`).** Multi-surface capture session (`RAW_SENSOR` + `YUV_420_888` + Viewfinder Surface) must be coordinated at the Camera2 HAL layer using `DngCreator`. |

---

## 2. Sensor & Camera Architecture

### 2.1 Optical & Sensor Characteristics
- **Rear Main Camera (`id: 0`):**
  - Sensor Resolution: 12 MP (4000 × 3000 max still resolution).
  - Hardware Level: `FULL` / `LEVEL_3` capabilities.
  - Color Filter Arrangement: RGGB Bayer CFA.
  - Active Array Size: Queried dynamically via `CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE`.
  - Manual Range:
    - ISO Sensitivity: 100 to 3200+
    - Exposure Time: ~1/8000s up to long-exposure limits (7s+ supported via manual bulb/exposure sequences).
- **Front Camera (`id: 1`):**
  - Fixed or limited focus depending on build revision.
  - Front camera switches must respect session generation invalidation (`ERR_CAMERA_SESSION_CHANGED`).

### 2.2 Camera Manual Module (`modules/camera-manual`)
- Android implementation in `modules/camera-manual/android/src/main/java/expo/modules/cameramanual/CameraManualModule.kt`.
- Uses `Camera2CameraControl.from(camera.cameraControl).setCaptureRequestOptions(builder.build())`.
- Tracks lens identity and session generation synchronously invalidating state on detach, stop, or lens swap (`useCameraReadiness.ts`).
- Recovers from `ERR_CAMERA_NOT_BOUND` with exponential backoff (100ms / 200ms).

### 2.3 Camera RAW Module (`modules/camera-raw`)
- Custom Expo module targeting `android.graphics.ImageFormat#RAW_SENSOR`.
- Assemblies standard Adobe DNGs using `android.hardware.camera2.DngCreator`:
  - Injects `COLOR_TRANSFORM_1/2`, `FORWARD_MATRIX_1/2`.
  - Injects calibration illuminants (Standard Light A 2856K, D65 6504K).
  - Applies `SENSOR_INFO_WHITE_LEVEL` and `SENSOR_BLACK_LEVEL_PATTERN`.
  - Pairs raw `.dng` negative with developed JPEG artifact.

---

## 3. Viewport & Coordinate Geometry

Because the Solana Seeker display is **1200 × 2670** and the sensor stream is **4:3 (4000 × 3000)**:
1. The camera preview operates in `contain` mode, creating top/bottom UI clearance.
2. Touch points for Tap-to-Focus and Tap-to-Expose (AE/AF reticle):
   - Must subtract top header offset.
   - Must scale by active preview dimensions before mapping to sensor active array coordinates.
   - Must clamp bounding boxes within sensor boundaries: `[0, 0, activeArrayWidth, activeArrayHeight]`.

---

## 4. Autonomous Device QA Loop

Do not guess whether a camera or UI change works. The system has an active ADB testing suite targeting the physical device:

### Quick Verification Run
```bash
# Verify phone is connected
adb devices

# Execute full 6-flow autonomous QA audit
bash scripts/seeker-agent/run.sh
```

### Flow Coverage:
1. **Camera Preview & Viewfinder Readiness** (HUD mount, shutter button readiness)
2. **Wallet Connection Menu** (Chevron verification, modal state)
3. **Film Shelf & Mode Selection** (Momints Color, Momints B&W, Bali 400, Martha)
4. **Pro Controls & Reticle Interaction** (6-column manual strip, EV slider drag, AF/AE reticle)
5. **Capture & Processing Pipeline** (Shutter trigger, frame decrement, develop cycle)
6. **Darkroom & Review** (Review gallery, frame counters, save/mint gates)

Results and screenshots are automatically generated into:
- `.orchestrator/qa-artifacts/`
- `.orchestrator/seeker-audit-report.md`

---

## 5. Guidelines for AI Agents (`antigravity`, `hermes`, `codex`)

1. **Never assume CameraX handles manual exposure on capture.** If modifying still capture logic, verify that parameters are explicitly passed to the capture session.
2. **Never hardcode screen coordinates.** Always respect dynamic screen dimensions and sensor array bounds.
3. **Do not create files in the repo root.** Put screenshots in `artifacts/captures/` and test builds in `artifacts/builds/`.
4. **Run unit tests before touching native modules:**
   ```bash
   node --test tests/camera-readiness.test.cjs
   node --test tests/camera-raw.test.cjs
   ```
5. **Verify physical device execution:** Whenever native Kotlin (`modules/*`) or Camera UI (`src/app/camera.tsx`) is modified, run the Seeker QA agent.

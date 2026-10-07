# Momints Agent Guide & System Architecture

Welcome agent. This document is the single source of truth for developing, testing, and modifying Momints. Follow these conventions strictly to maintain system stability, zero context bloat, and fast iteration.

---

## 1. Fast Verification Command (Run After Every Edit)

Before declaring any task complete, run:
```bash
npm run agent:check
```
This executes:
1. TypeScript strict typecheck (`tsc --noEmit`).
2. Fast unit tests (<500ms) covering camera readiness, focus lock, Kino settings, and privacy.

---

## 2. Workspace & Branch Roles

- **Momints V1 (`/Users/zaac/momints`):**
  - **Role:** Safe harbor & stable hackathon baseline.
  - **Rules:** Do not add experimental features here. Only critical bugfixes.
- **Momints V2 (`/Users/zaac/momints-v2`):**
  - **Role:** Feature lab & modern camera engine.
  - **Features:** LomoKino burst mode, RAW DNG twin frames, Long Exposure, Pro Controls.

---

## 3. Architecture & Domain Boundaries

### 📁 Mobile Domain (Safe to Modify)
- `src/features/`: Modular camera features (Kino, Pro Controls, Long Exposure, RAW).
- `src/app/`: Expo Router screens (`camera.tsx`, `review.tsx`, `mode-select.tsx`).
- `modules/camera-manual/`: Kotlin/Camera2 manual controls engine.
- `modules/camera-raw/`: Kotlin/Camera2 RAW Bayer + DngCreator engine.
- `scripts/seeker-agent/`: Autonomous ADB testing suite for the physical Solana Seeker.

### 🛑 Backend Domain (Trav's Area — DO NOT TOUCH without explicit instruction)
- `worker/`: Cloudflare Workers, Arweave storage, Solana RPC pipelines.
- `src/services/rollApi.ts` & `src/services/rollVault.ts`: Upstream contract endpoints.

---

## 4. Hardware Realities (Solana Seeker `SM02`)

Read `docs/HARDWARE_SEEKER_SPEC.md` for complete technical details. Critical rules:
1. **No Decoupled AE Priority Modes:** The vendor HAL requires manual mode lock (`CONTROL_AE_MODE_OFF`).
2. **Coordinate Space:** Viewfinder is letterboxed (4:3 sensor in ~20:9 display). Screen touch coordinates must be mapped to `SENSOR_INFO_ACTIVE_ARRAY_SIZE` with orientation & contain-fit scaling.
3. **CameraX Still Capture Reset:** CameraX still captures re-evaluate exposure parameters unless explicitly bound to the capture request pipeline.

---

## 5. On-Device Verification (Connected Solana Seeker)

To run the automated ADB test suite against the physical phone:
```bash
bash scripts/seeker-agent/run.sh
```
Artifacts and screenshots will be written to `.orchestrator/qa-artifacts/`.

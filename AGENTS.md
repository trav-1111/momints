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
2. Fast unit tests (<500ms) covering camera readiness, focus lock, Kino settings, and privacy (48 tests).

---

## 2. Workspace & Build Structure (Area A)

- **Local Workspaces:**
  - **Momints V1 Baseline (`/Users/zaac/momints`):** Safe harbor & stable hackathon baseline (`fix/mwa-wallet-integration`).
  - **Momints V2 Feature Lab (`/Users/zaac/momints-v2`):** Modular feature lab (`v2-staging`).
  - **Discord Bot Dedicated Tree (`/Users/zaac/momints-bot`):** Isolated bot worktree (`bot/momints-agent`).
  - **IDE Multi-Root Workspace:** `/Users/zaac/momints.code-workspace` mounts V1 and V2 concurrently.
- **Build Scripts & Artifacts:**
  - **Release APK Build:** `node scripts/build-submission-apk.cjs`
  - **Build Outputs:** `artifacts/builds/` (e.g., `fakewallet-v1-release.apk`, release candidate APKs).
  - **Captures & Screen Records:** `artifacts/captures/`
  - **Zero-Bloat Worktrees:** `bash scripts/spawn-agent-worktree.sh <branch-name>`

---

## 3. Solana Seeker Hardware & Testing Suite (Area B)

- **Target Device:** Solana Seeker (`SM02G40619133790` / `SM02G406193022`), Android 16 (API 36).
- **HAL Realities (`docs/HARDWARE_SEEKER_SPEC.md`):**
  1. **No Decoupled AE Priority Modes:** The vendor HAL requires manual mode lock (`CONTROL_AE_MODE_OFF`).
  2. **Coordinate Space:** Viewfinder is letterboxed (4:3 sensor in ~20:9 display). Screen touch coordinates must be mapped to `SENSOR_INFO_ACTIVE_ARRAY_SIZE` with orientation & contain-fit scaling. EV slider calibrated to 20dp increments.
  3. **CameraX Still Capture Reset:** CameraX still captures re-evaluate exposure parameters unless explicitly bound to the capture request pipeline.
  4. **RAW DNG Engine:** Implemented via native Camera2 `RAW_SENSOR` + `DngCreator` in `modules/camera-raw`.
- **Autonomous Device QA Loop:**
  ```bash
  # Check connection
  adb devices
  # Execute full 6-flow autonomous QA audit
  bash scripts/seeker-agent/run.sh
  ```
  Artifacts and screenshots will be written to `.orchestrator/qa-artifacts/`.
- **Diagnostic Spikes (Deep Links):**
  - Kino rotary shutter & burst diagnostic: `momints://spike-kino`
  - Camera RAW DNG diagnostic: `momints://spike-camera-raw`

---

## 4. GitHub Remotes & Branch Roles (Area C & D)

- **Zaac's GitHub (Area C):**
  - Remote: `zaacishere` (`https://github.com/ZaacIsHere/momints`)
  - Primary Staging: `v2-staging`
  - Feature branches: `feature/kino-burst`, `feature/camera-raw`, `bot/momints-agent`
  - Commits: Atomic, descriptive, passing `npm run agent:check`
- **Trav's GitHub (Area D):**
  - Remote: `origin` (`https://github.com/trav-1111/momints`)
  - Upstream Production Baseline: `origin/main`

---

## 5. Domain Boundaries & Review Protocol for Trav (Area D)

### 📁 Mobile Client Domain (Zaac's Territory)
- `src/features/`: Modular camera features (`kino/`, `pro-controls/`, `long-exposure/`, `camera-raw/`).
- `src/app/`: Expo Router screens (`camera.tsx`, `review.tsx`, `mode-select.tsx`).
- `modules/camera-manual/`: Kotlin/Camera2 manual controls engine.
- `modules/camera-raw/`: Kotlin/Camera2 RAW Bayer + DngCreator engine.

### 🛑 Backend Domain (Trav's Territory — DO NOT TOUCH without explicit instruction)
- `worker/`: Cloudflare Workers, Arweave storage, D1 database, Solana RPC minting pipeline.
- `src/services/rollApi.ts` & `src/services/rollVault.ts`: Upstream contract endpoints.
- Any proposed backend modification MUST be explicitly flagged for Trav's sign-off.

### 📋 Trav PR & Review Standard
When preparing or reviewing contributions for Trav:
1. Generate brief with `!review` (showing `git log origin/main..HEAD` and diff stat).
2. Confirm verification: `npm run agent:check` (48/48 unit tests passing, 0 type errors).
3. Confirm hardware verification: Tested on Solana Seeker `SM02G40619133790`.
4. Upload capture screenshots or demo MP4 to Trav's Google Drive review folder:  
   `https://drive.google.com/drive/folders/1K0kwhF01PWVq61XPSnTUr5M3zzdKMI0j?usp=drive_link`

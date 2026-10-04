# Autonomous Seeker Phone QA Agent & Human-Like Auditor

## Overview
This directory contains the autonomous human-like testing agent designed to audit all user flows on the physical **Solana Seeker (`SM02G40619133790`)** via ADB.

## Architecture
- `device.py`: `SeekerDevice` class wrapping ADB (`uiautomator dump` XML parsing, human coordinate clicking, swipe, screencap, keyevents).
- `monitor.py`: `SystemAuditor` monitoring `dumpsys meminfo com.momints.app` (PSS, Native Heap, Graphics) and logcat error tracking.
- `flows.py`: `SeekerTestScenarios` implementing the 6 core end-to-end flows:
  1. Camera Launch & Viewfinder Readiness
  2. Wallet Connection Menu (`▼` chevron verification)
  3. Film Shelf & Mode Selection (B&W, Color, Bali 400, Martha)
  4. Pro Controls & Reticle Interaction (EV slider drag, Focus reticle tap)
  5. Shutter Capture & Processing (Frame counter decrement)
  6. Darkroom & Gallery Review
- `runner.py`: CLI test orchestrator that runs all flows, records screenshots into `.orchestrator/qa-artifacts/`, and generates reports.
- `run.sh`: One-line launcher.

## Usage
To execute the automated test suite when ready:
```bash
python3 scripts/seeker-agent/runner.py
# or
bash scripts/seeker-agent/run.sh
```

## Generated Artifacts
Screenshots and logs are stored at:
- `.orchestrator/qa-artifacts/` (e.g. `00_initial_state.png`, `wallet_modal.png`, `mode_select.png`, `camera_bw.png`, `pro_open.png`, `ev_panel.png`, `reticle_active.png`, `after_capture.png`)
- `.orchestrator/seeker-audit-report.md`

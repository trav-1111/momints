# Momints V3 Creative Features: Technical Roadmap & Architecture Specification

**Target Hardware:** Solana Seeker (`SM02` / `SM02G40619133790`), Android 16 (API 36), MediaTek SoC (`MtkCam` HAL)  
**Status:** Approved for Implementation

---

## Executive Summary

Momints V3 expands the analog film emulation engine into a complete **computational optical darkroom** designed for analog film enthusiasts. V3 introduces two major architectural capabilities:
1. **Emulated Aperture & Depth of Field (DoF):** Computational bokeh rendering (f/1.4 to f/16), polygonal diaphragm blade simulation (5, 7, and 9 blades, plus circular), optical vignetting ("cat's eye" corner bokeh), longitudinal chromatic aberration (LoCA) fringing, and seamless integration with Camera2 focus distance diopters (`LENS_FOCUS_DISTANCE`).
2. **Darkroom Creative Developing Techniques:** Physical emulation of push/pull development (+2 EV push to -1 EV pull), cross-processing (E-6 slide film in C-41 chemistry), bleach bypass (silver retention / ENR), solarization (the Sabattier effect with Mackie line edge halos), split toning / duotone, and authentic physical film defects (procedural light leaks, film burns, and 35mm KS-1870 sprocket rebate borders).

---

## 1. Hardware Grounding & Seeker Feasibility

* **Sensor & Focus Subsystem:** 108MP Bayer sensor on Camera 0. MediaTek `MtkCam` HAL supports `CONTROL_AF_MODE_OFF` and manual `LENS_FOCUS_DISTANCE` from `0.0` to `22.0` diopters (~4.5 cm macro).
* **Depth Stream Reality:** The HAL does **not** expose hardware `DEPTH16` streams to third-party apps.
* **Solution:** Computational focal plane architecture:
  * Physical focus anchor $D_0$ read from Camera2 `CaptureResult.LENS_FOCUS_DISTANCE`.
  * Scene depth diopters $D(\mathbf{xy})$ combined with Circle of Confusion formula:
    $$R_{\text{CoC}} = \text{clamp}\left(\frac{f^2}{N} \cdot |D(\mathbf{xy}) - D_0| \cdot \text{scaleFactor}, \ 0.0, \ R_{\text{max}}\right)$$
  * Poisson-16 kernel bokeh gather pass with polygonal blade weighting and optical cat's eye vignetting.

---

## 2. Creative Darkroom Developing Techniques

### A. Push/Pull Processing (-1.0 to +2.0 EV)
* Modulates tone curve gamma $\gamma = 1.0 + 0.32 \cdot P$.
* Dynamically scales procedural silver grain:
  $$\text{grainAmount}_{\text{eff}} = \text{grainAmount} \cdot (1.0 + 0.60 \cdot \max(0, P) - 0.30 \cdot \max(0, -P))$$

### B. Cross-Processing (X-Pro: E-6 in C-41)
* Non-linear channel cross-talk: boosts greens/cyans, crushes shadows, creates intense saturation.

### C. Bleach Bypass (Silver Retention)
* Retains metallic silver density over color dyes via high-acutance Overlay blend mode on scene luminance.

### D. Solarization (Sabattier Effect & Mackie Lines)
* Partial tone reversal of highlights/midtones above pivot $p \approx 0.5$.
* Laplacian spatial filter creates unreversed Mackie halo lines along edge boundaries.

### E. Split Toning
* Bi-color grading: independently tints shadows ($\mathbf{K}_{\text{shadow}}$) and highlights ($\mathbf{K}_{\text{highlight}}$) around a variable luminance pivot.

### F. Procedural Light Leaks & Sprocket Rebate Borders
* Deterministic light leak synthesis (seeded from photo hash) simulating foam seal failure.
* 35mm KS-1870 sprocket perforation borders and edge rebate frame numbers.

---

## 3. Implementation Phasing

1. **Phase 1: Core Chemistry:** Shader routines for Push/Pull, Bleach Bypass, Cross-Processing in GLSL/SkSL.
2. **Phase 2: Aperture & Bokeh:** Poisson gather blur, diaphragm blade geometry, rotary aperture ring in `ManualControls.tsx`.
3. **Phase 3: Physical Artifacts:** Seeded light leaks, KS-1870 sprocket borders.
4. **Phase 4: Hardware QA:** 6-flow audit on Solana Seeker.

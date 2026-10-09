# Momints Collectible Filmstocks & LUT Catalogue Specification
**Document Path:** `/Users/zaac/momints-v2/docs/COLLECTIBLE_FILMSTOCKS_CATALOGUE.md`  
**Engine Target:** Momints Filmstock Engine V2 (`schemaVersion: 2`, 33-point 3D LUT Atlas, sRGB SDR)  
**Hardware & Platform:** Solana Seeker (Android 16 / SDK 36), Native OpenGL ES (`modules/film-gl`) & Skia (`@shopify/react-native-skia`)  
**On-Chain Verification:** Metaplex Core `VerifiedCreators` & DAS Indexing (`plugins.verified_creators.data.signatures`)

---

## 1. Executive Summary & Architecture Grounding

Analog film photography is defined by distinct emulsion chemistry: photochemical tone curves, dye clouds, tabular versus cubic silver halide grain, and optical scattering phenomena such as halation and bloom. In Momints V2, film simulation is achieved through a fixed, high-performance GPU pipeline:

```text
sRGB Normalization (Skia CPU RGBA8888 surface / ICC clamp)
  → Exposure Bias (exp2(exposureEv))
  → 3D LUT (33x33x33 Atlas, Trilinear Interpolation)
  → Halation (Red-Orange Scatter, Highlight-Masked)
  → Bloom (Luminance Scatter Blur)
  → Procedural Grain (Multi-scale Seeded Noise)
  → Acutance / Softness (High-Pass / Unsharp Mask)
  → Vignette (Smoothstep Radial Attenuation)
  → Compressed sRGB JPEG Export (Target ≤ 1.5 MB)
```

This catalogue specifies **13 iconic film stocks** divided into 4 core categories:
1. **Classic Color Negative (C-41):** Kodak Portra 400, Kodak Portra 160, Fujifilm Pro 400H, Kodak Ektar 100.
2. **Color Reversal / Slide Film (E-6 & K-14):** Kodak Kodachrome 64, Fujifilm Velvia 50, Fujifilm Provia 100F.
3. **Classic Black & White (Silver Halide):** Kodak Tri-X 400, Ilford HP5 Plus, Kodak T-Max 100.
4. **Cine & Specialty Stocks:** CineStill 800T, LomoChrome Purple XR, LomoChrome Metropolis XR.

---

## 2. Momints Film Processing Engine Parameters Reference

Every recipe strictly implements the parameter bounds defined in `worker/filmstock-recipe.schema.json` and executed in `src/services/filmProcessor.ts`:

| Parameter | Type / Range | Engine Effect & Implementation |
| :--- | :--- | :--- |
| `lut.size` | Const `33` | 33-cube 3D LUT atlas (1089 × 33 RGBA8 pixels). Trilinear interpolation. |
| `lut.intensity`| `0.0` to `1.0` | Global blend between original normalized image and graded LUT output. |
| `exposure.ev` | `-2.0` to `+2.0` | Pre-LUT exposure scaling: `clamp(source * exp2(ev), 0.0, 1.0)`. |
| `grain.amount` | `0.0` to `1.0` | Peak noise amplitude. Modulates multiscale procedural noise (`* 0.16`). |
| `grain.size` | `0.0` to `1.0` | Noise spatial frequency: scales cell size from `0.55` to `2.8` pixels. |
| `grain.roughness`| `0.0` to `1.0` | Interpolation between fine micro-noise and coarse clumped clusters. |
| `halation.amount`| `0.0` to `1.0` | Warm red-orange glow (`half3(1.0, 0.24, 0.08)`) on specular highlights (`luminance > 0.55`). |
| `halation.radius`| `0.0` to `1.0` | Halation blur kernel radius: `1.0 + max(halationRadius, bloomRadius) * 14.0`. |
| `bloom.amount` | `0.0` to `1.0` | Neutral highlight radiance blur: `blurred * highlight * (bloomAmount * 0.35)`. |
| `bloom.radius` | `0.0` to `1.0` | Bloom blur kernel radius. |
| `sharpness.amount`| `-1.0` to `+1.0`| Negative = optical lens softness; Positive = high-acutance edge crispness (`(color - blurred) * sharpness * 0.65`). |
| `vignette.amount` | `0.0` to `1.0` | Peripheral radial darkening: `smoothstep(0.28, 1.35, dist^2) * vignette * 0.72`. |

---

## 3. The 13 Iconic Film Stocks Catalogue

### Category 1: Classic Color Negative (C-41)

#### 1. Kodak Portra 400 (`kodak-portra-400-v1`)
* **Characteristics:** Soft contrast, warm natural skin tones, pastel highlights, fine T-GRAIN.
* **Recipe:**
```json
{
  "schemaVersion": 2,
  "filmStockId": "kodak-portra-400-v1",
  "displayName": "Kodak Portra 400",
  "shortDescription": "The benchmark portrait stock: soft contrast, warm natural skin tones, and subtle pastel grain.",
  "characteristics": ["warm skin tones", "pastel highlights", "wide latitude", "fine t-grain"],
  "inputColorSpace": "sRGB",
  "outputColorSpace": "sRGB",
  "baseMode": "color",
  "lut": { "format": "momints-lut", "size": 33, "intensity": 1.0, "uri": "runtime/kodak-portra-400-v1.lut" },
  "exposure": { "ev": 0.15 },
  "grain": { "amount": 0.16, "size": 0.35, "roughness": 0.32 },
  "halation": { "amount": 0.04, "radius": 0.18 },
  "bloom": { "amount": 0.03, "radius": 0.20 },
  "sharpness": { "amount": -0.04 },
  "vignette": { "amount": 0.03 },
  "minimumEngineVersion": 2
}
```
* **Drop:** `Season 1, Batch 1: Masters of C-41` | Tier: `Core (Common)`

#### 2. Kodak Portra 160 (`kodak-portra-160-v1`)
* **Characteristics:** Ultra-fine grain, neutral skin tones, studio smooth tonality.
* **Drop:** `Season 1, Batch 1: Masters of C-41` | Tier: `Rare`

#### 3. Fujifilm Pro 400H (`fuji-pro-400h-v1`)
* **Characteristics:** Discontinued Japanese legend with luminous mint greens, cool cyan shadows, and ethereal peachy highlights.
* **Drop:** `Season 1, Batch 1: Masters of C-41` | Tier: `Iconic (Epic)`

#### 4. Kodak Ektar 100 (`kodak-ektar-100-v1`)
* **Characteristics:** Ultra-vibrant landscape stock boasting razor-sharp microcontrast, vivid cobalt blues, and saturated reds.
* **Drop:** `Season 1, Batch 1: Masters of C-41` | Tier: `Rare`

### Category 2: Color Reversal / Slide Film (E-6 & K-14)

#### 5. Kodak Kodachrome 64 (`kodak-kodachrome-64-v1`)
* **Characteristics:** The definitive National Geographic slide stock: rich documentary warmth, vibrant primary reds, and dense shadows.
* **Drop:** `Season 1, Batch 2: The Golden Age of Slide` | Tier: `Legendary (Mythic)`

#### 6. Fujifilm Velvia 50 (`fuji-velvia-50-v1`)
* **Characteristics:** The ultimate landscape slide film: electric emerald greens, hyper-saturated sunsets, and uncompromising contrast.
* **Drop:** `Season 1, Batch 2: The Golden Age of Slide` | Tier: `Iconic (Epic)`

#### 7. Fujifilm Provia 100F (`fuji-provia-100f-v1`)
* **Characteristics:** Pristine professional slide film offering true-to-life neutral color fidelity, crisp whites, and microfine grain.
* **Drop:** `Season 1, Batch 2: The Golden Age of Slide` | Tier: `Rare`

### Category 3: Classic Black & White (Silver Halide)

#### 8. Kodak Tri-X 400 (`kodak-tri-x-400-v1`)
* **Characteristics:** The soul of street photography: gritty cubic grain, punchy midtone contrast, and deep inky blacks.
* **Drop:** `Season 1, Batch 3: Monochrome Legends` | Tier: `Rare`

#### 9. Ilford HP5 Plus (`ilford-hp5-plus-v1`)
* **Characteristics:** British monochrome classic with expansive dynamic range, rich silvery midtones, and smooth highlight gradation.
* **Drop:** `Season 1, Batch 3: Monochrome Legends` | Tier: `Core (Common)`

#### 10. Kodak T-Max 100 (`kodak-tmax-100-v1`)
* **Characteristics:** Surgical tabular-grain monochrome delivering virtually grain-free resolving power and modern tonal clarity.
* **Drop:** `Season 1, Batch 3: Monochrome Legends` | Tier: `Iconic (Epic)`

### Category 4: Cine & Specialty Stocks

#### 11. CineStill 800T (`cinestill-800t-v1`)
* **Characteristics:** Tungsten-balanced cinema stock famous for fiery red halation around neon lights and moody teal-shadow tones.
* **Recipe:**
```json
{
  "schemaVersion": 2,
  "filmStockId": "cinestill-800t-v1",
  "displayName": "CineStill 800T",
  "shortDescription": "Tungsten-balanced cinema stock famous for fiery red halation around neon lights and moody teal-shadow tones.",
  "characteristics": ["red neon halation", "tungsten balanced", "cinematic bloom", "night street atmosphere"],
  "inputColorSpace": "sRGB",
  "outputColorSpace": "sRGB",
  "baseMode": "color",
  "lut": { "format": "momints-lut", "size": 33, "intensity": 1.0, "uri": "runtime/cinestill-800t-v1.lut" },
  "exposure": { "ev": 0.10 },
  "grain": { "amount": 0.24, "size": 0.46, "roughness": 0.42 },
  "halation": { "amount": 0.38, "radius": 0.45 },
  "bloom": { "amount": 0.16, "radius": 0.40 },
  "sharpness": { "amount": -0.05 },
  "vignette": { "amount": 0.08 },
  "minimumEngineVersion": 2
}
```
* **Drop:** `Season 1, Batch 4: Nocturne & Experimental` | Tier: `Legendary (Mythic)`

#### 12. LomoChrome Purple XR 100-400 (`lomochrome-purple-v1`)
* **Characteristics:** Psychedelic experimental stock turning greens into vibrant purples and skies into amber while protecting skin tones.
* **Drop:** `Season 1, Batch 4: Nocturne & Experimental` | Tier: `Iconic (Epic)`

#### 13. LomoChrome Metropolis XR 100-400 (`lomochrome-metropolis-v1`)
* **Characteristics:** Bleach-bypass urban street stock featuring desaturated tones, harsh industrial contrast, and gritty grain.
* **Drop:** `Season 1, Batch 4: Nocturne & Experimental` | Tier: `Rare`

---

## 4. Open-Source Ingestion & Binary LUT Format

Open-source HaldCLUTs / 3D `.cube` profiles are converted to Momints binary runtime LUTs (`.lut`):
* **Header (16 bytes):** ASCII `MOMLUT01`, grid size `33`, channels `4`, byte length `143748`.
* **Atlas Texture (143,748 bytes):** 1089 × 33 RGBA8 texture sampled with trilinear interpolation.
* **Publishing Tool:** Run via `npm run publish:filmstock` in `worker/`.

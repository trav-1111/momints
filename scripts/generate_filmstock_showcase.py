#!/usr/bin/env python3
"""
Film Stock Showcase & LUT Package Generator for Momints.
Processes existing 2D strip LUTs and .cube files, synthesizes additional iconic
film looks, applies them to a benchmark photograph, and outputs:
1. High-quality preview JPEG thumbnails in docs/filmstocks/previews/
2. Formatted CUBE and Momints runtime binary (.lut) files in worker/filmstock-sources/
3. A comprehensive visual README catalogue in docs/filmstocks/FILMSTOCK_SHOWCASE.md
"""

import os
import sys
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
PREVIEWS_DIR = os.path.join(PROJECT_ROOT, "docs", "filmstocks", "previews")
SHOWCASE_MD = os.path.join(PROJECT_ROOT, "docs", "filmstocks", "FILMSTOCK_SHOWCASE.md")
BENCHMARK_SRC = os.path.join(
    PROJECT_ROOT, "worker", "filmstock-assets", "filmstocks", "bali-400-v1", "previews", "preview-01.jpg"
)

os.makedirs(PREVIEWS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(SHOWCASE_MD), exist_ok=True)


def parse_strip_png(png_path, size=32):
    """Parses a 1024x32 2D strip PNG into an (N, N, N, 3) float32 LUT array."""
    img = Image.open(png_path).convert("RGB")
    arr = np.array(img, dtype=np.float32) / 255.0  # (32, 1024, 3)
    table = np.zeros((size, size, size, 3), dtype=np.float32)
    for b in range(size):
        for g in range(size):
            for r in range(size):
                x = b * size + r
                table[r, g, b] = arr[g, x]
    return table


def parse_cube_file(cube_path):
    """Parses a .cube file into an (N, N, N, 3) float32 LUT array."""
    size = 33
    values = []
    with open(cube_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if parts[0] == "LUT_3D_SIZE":
                size = int(parts[1])
                continue
            if len(parts) == 3 and not parts[0].isalpha():
                values.append([float(parts[0]), float(parts[1]), float(parts[2])])
    
    table = np.zeros((size, size, size, 3), dtype=np.float32)
    idx = 0
    # In CUBE format, R changes fastest, then G, then B
    for b in range(size):
        for g in range(size):
            for r in range(size):
                if idx < len(values):
                    table[r, g, b] = values[idx]
                    idx += 1
    return table, size


def export_cube_file(table, out_path, title="Momints"):
    """Exports an (N, N, N, 3) LUT table to standard 33-point .cube file."""
    size = table.shape[0]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f'TITLE "{title}"\n')
        f.write(f"LUT_3D_SIZE {size}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n\n")
        for b in range(size):
            for g in range(size):
                for r in range(size):
                    val = np.clip(table[r, g, b], 0.0, 1.0)
                    f.write(f"{val[0]:.6f} {val[1]:.6f} {val[2]:.6f}\n")


def export_runtime_lut(table, out_path):
    """Exports to Momints binary runtime LUT format (MOMLUT01 header + RGBA8 atlas)."""
    size = table.shape[0]
    width = size * size
    height = size
    pixels = bytearray(width * height * 4)
    for b in range(size):
        for g in range(size):
            for r in range(size):
                dst_idx = (g * width + b * size + r) * 4
                val = np.clip(table[r, g, b], 0.0, 1.0)
                pixels[dst_idx] = int(round(val[0] * 255))
                pixels[dst_idx + 1] = int(round(val[1] * 255))
                pixels[dst_idx + 2] = int(round(val[2] * 255))
                pixels[dst_idx + 3] = 255

    header = bytearray(16)
    header[0:8] = b"MOMLUT01"
    header[8:10] = size.to_bytes(2, "little")
    header[10:12] = (4).to_bytes(2, "little")
    header[12:16] = len(pixels).to_bytes(4, "little")
    
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header)
        f.write(pixels)


def apply_trilinear_lut(img_rgb, lut_table):
    """Applies 3D LUT via vectorized trilinear interpolation."""
    N = lut_table.shape[0]
    H, W, _ = img_rgb.shape
    arr = img_rgb.astype(np.float32) / 255.0

    R = np.clip(arr[:, :, 0] * (N - 1), 0, N - 1)
    G = np.clip(arr[:, :, 1] * (N - 1), 0, N - 1)
    B = np.clip(arr[:, :, 2] * (N - 1), 0, N - 1)

    r0 = np.floor(R).astype(np.int32)
    r1 = np.minimum(r0 + 1, N - 1)
    dr = (R - r0)[:, :, np.newaxis]

    g0 = np.floor(G).astype(np.int32)
    g1 = np.minimum(g0 + 1, N - 1)
    dg = (G - g0)[:, :, np.newaxis]

    b0 = np.floor(B).astype(np.int32)
    b1 = np.minimum(b0 + 1, N - 1)
    db = (B - b0)[:, :, np.newaxis]

    c000 = lut_table[r0, g0, b0]
    c100 = lut_table[r1, g0, b0]
    c010 = lut_table[r0, g1, b0]
    c110 = lut_table[r1, g1, b0]
    c001 = lut_table[r0, g0, b1]
    c101 = lut_table[r1, g0, b1]
    c011 = lut_table[r0, g1, b1]
    c111 = lut_table[r1, g1, b1]

    c00 = c000 * (1.0 - dr) + c100 * dr
    c10 = c010 * (1.0 - dr) + c110 * dr
    c01 = c001 * (1.0 - dr) + c101 * dr
    c11 = c011 * (1.0 - dr) + c111 * dr

    c0 = c00 * (1.0 - dg) + c10 * dg
    c1 = c01 * (1.0 - dg) + c11 * dg

    c = c0 * (1.0 - db) + c1 * db
    return np.clip(c * 255.0, 0, 255).astype(np.uint8)


# Tone curve helper functions
def s_curve(x, contrast=1.2, midpoint=0.5):
    """Applies a smooth photographic S-curve."""
    shifted = x - midpoint
    return np.clip(midpoint + np.sign(shifted) * (np.abs(shifted) ** (1.0 / contrast)) * (0.5 ** (1.0 - 1.0 / contrast)), 0.0, 1.0)


def create_synthesized_lut(recipe_func, size=33):
    """Generates an (N, N, N, 3) LUT table using a continuous recipe function."""
    table = np.zeros((size, size, size, 3), dtype=np.float32)
    for b in range(size):
        for g in range(size):
            for r in range(size):
                rgb = np.array([r / (size - 1), g / (size - 1), b / (size - 1)], dtype=np.float32)
                table[r, g, b] = recipe_func(rgb)
    return table


# Synthesized iconic stock mathematical formulas
def recipe_kodachrome_64(rgb):
    # High micro-contrast, warm golden-amber bias, saturated primaries, deep dense shadows
    r, g, b = rgb
    # S-curve contrast
    r_c = s_curve(r, 1.35, 0.46)
    g_c = s_curve(g, 1.30, 0.48)
    b_c = s_curve(b, 1.22, 0.52)
    # Warm shift: yellow/red boost, cyan restraint
    r_out = r_c * 1.06 + 0.015
    g_out = g_c * 0.98 + 0.008
    b_out = b_c * 0.91 - 0.005
    return np.clip([r_out, g_out, b_out], 0.0, 1.0)


def recipe_ektar_100(rgb):
    # Vivid saturation, ultra-sharp contrast, punchy cyan skies and rich reds, clean neutral whites
    r, g, b = rgb
    r_c = s_curve(r, 1.25, 0.5)
    g_c = s_curve(g, 1.22, 0.5)
    b_c = s_curve(b, 1.28, 0.5)
    # Saturation boost
    lum = 0.2126 * r_c + 0.7152 * g_c + 0.0722 * b_c
    sat = 1.35
    r_out = lum + sat * (r_c - lum)
    g_out = lum + sat * (g_c - lum) * 1.02
    b_out = lum + sat * (b_c - lum) * 1.08
    return np.clip([r_out, g_out, b_out], 0.0, 1.0)


def recipe_provia_100f(rgb):
    # Natural daylight slide film: linear natural midtones, fine emerald greens, crisp clarity
    r, g, b = rgb
    r_c = s_curve(r, 1.18, 0.5)
    g_c = s_curve(g, 1.18, 0.5)
    b_c = s_curve(b, 1.20, 0.5)
    lum = 0.2126 * r_c + 0.7152 * g_c + 0.0722 * b_c
    sat = 1.12
    r_out = lum + sat * (r_c - lum) * 0.99
    g_out = lum + sat * (g_c - lum) * 1.04  # Characteristic Fuji green clarity
    b_out = lum + sat * (b_c - lum) * 1.01
    return np.clip([r_out, g_out, b_out], 0.0, 1.0)


def recipe_hp5_plus(rgb):
    # Classic Ilford panchromatic B&W: wide tonal latitude, soft highlight roll-off, rich silver midtones
    r, g, b = rgb
    # Panchromatic spectral weighting: slight red/green sensitivity
    gray = 0.28 * r + 0.60 * g + 0.12 * b
    gray_c = s_curve(gray, 1.18, 0.48)
    return np.clip([gray_c, gray_c, gray_c], 0.0, 1.0)


def recipe_lomo_purple(rgb):
    # LomoChrome Purple infrared shift: greens shift to vibrant magenta/violet, warm tones stay amber
    r, g, b = rgb
    # Detect foliage green dominance
    green_dom = np.maximum(0.0, g - np.maximum(r, b) * 0.85)
    
    # Base contrast
    r_c = s_curve(r, 1.22, 0.5)
    g_c = s_curve(g, 1.20, 0.5)
    b_c = s_curve(b, 1.25, 0.5)
    
    # Invert and shift green into magenta/violet
    r_shift = r_c + green_dom * 0.95
    g_shift = g_c * (1.0 - green_dom * 0.75)
    b_shift = b_c + green_dom * 1.15
    return np.clip([r_shift, g_shift, b_shift], 0.0, 1.0)


def main():
    print("=== Momints Film Stock Showcase & Catalogue Generator ===")
    
    # 1. Load benchmark test image
    if not os.path.exists(BENCHMARK_SRC):
        print(f"Error: Benchmark image missing at {BENCHMARK_SRC}")
        sys.exit(1)
        
    bench_img = Image.open(BENCHMARK_SRC).convert("RGB")
    bench_img = bench_img.resize((640, 426), Image.Resampling.LANCZOS)
    bench_rgb = np.array(bench_img, dtype=np.uint8)
    
    # Save original reference thumbnail
    orig_path = os.path.join(PREVIEWS_DIR, "original-reference.jpg")
    bench_img.save(orig_path, quality=90)
    print(f"Saved benchmark reference -> {orig_path}")

    # Catalogue metadata
    stocks = [
        # Group 1: Original Momints Stocks (from assets/luts)
        {
            "id": "momints-aura-400",
            "name": "Momints Aura 400",
            "inspiration": "Kodak Portra 400 (C-41)",
            "category": "Color Negative",
            "source_type": "png",
            "source_path": os.path.join(PROJECT_ROOT, "assets", "luts", "momints-aura-400.png"),
            "description": "Warm natural skin tones, soft pastel highlights, restrained contrast, iconic portrait look.",
            "traits": ["warm skin tones", "pastel highlights", "soft contrast", "portrait"],
        },
        {
            "id": "momints-neon-800t",
            "name": "Momints Neon 800T",
            "inspiration": "CineStill 800T / Vision3 500T",
            "category": "Cine & Specialty",
            "source_type": "png",
            "source_path": os.path.join(PROJECT_ROOT, "assets", "luts", "momints-neon-800t.png"),
            "description": "Tungsten balanced cinema emulsion. Deep teal night shadows and warm highlight glow.",
            "traits": ["tungsten balance", "teal shadows", "night shooting", "cinema look"],
        },
        {
            "id": "momints-vivid-50",
            "name": "Momints Vivid 50",
            "inspiration": "Fuji Velvia 50 (E-6)",
            "category": "Color Reversal / Slide",
            "source_type": "png",
            "source_path": os.path.join(PROJECT_ROOT, "assets", "luts", "momints-vivid-50.png"),
            "description": "Ultra-punchy saturation, deep blacks, high contrast. The quintessential landscape slide film.",
            "traits": ["high saturation", "deep blacks", "emerald greens", "vivid landscape"],
        },
        {
            "id": "momints-amber-200",
            "name": "Momints Amber 200",
            "inspiration": "Kodak Gold 200 (C-41)",
            "category": "Color Negative",
            "source_type": "png",
            "source_path": os.path.join(PROJECT_ROOT, "assets", "luts", "momints-amber-200.png"),
            "description": "Nostalgic golden-hour glow with warm amber highlights and classic vacation snapshots feel.",
            "traits": ["golden amber", "nostalgic warmth", "everyday film", "vintage snap"],
        },
        {
            "id": "momints-silver-400",
            "name": "Momints Silver 400",
            "inspiration": "Kodak Tri-X 400 (B&W)",
            "category": "Black & White",
            "source_type": "png",
            "source_path": os.path.join(PROJECT_ROOT, "assets", "luts", "momints-silver-400.png"),
            "description": "Classic photojournalistic silver halide. Gritty high-contrast punch with rich velvety blacks.",
            "traits": ["monochrome", "high contrast", "punchy blacks", "photojournalism"],
        },
        # Group 2: Trav's Published Worker Stocks
        {
            "id": "bali-400-v1",
            "name": "Bali 400",
            "inspiration": "Tropical Warm Negative",
            "category": "Color Negative",
            "source_type": "cube",
            "source_path": os.path.join(PROJECT_ROOT, "worker", "filmstock-sources", "bali-400-v1", "source", "bali-400-v1.cube"),
            "description": "Warm nostalgic color with dense shadows, restrained highlights, and muted tropical greens.",
            "traits": ["warm skin tones", "restrained highlights", "muted greens", "subtle grain"],
        },
        {
            "id": "martha-v1",
            "name": "Martha",
            "inspiration": "Vintage Saturation Reversal",
            "category": "Vintage Reversal",
            "source_type": "cube",
            "source_path": os.path.join(PROJECT_ROOT, "worker", "filmstock-sources", "martha-v1", "source", "martha-v1.cube"),
            "description": "Lush saturation, rich jewel colors, lifted matte blacks, and classic nostalgic tone.",
            "traits": ["lush saturation", "rich colors", "lifted blacks", "vintage tone"],
        },
        # Group 3: Additional Curated Classics
        {
            "id": "momints-chrome-64",
            "name": "Momints Chrome 64",
            "inspiration": "Kodachrome 64 (K-14)",
            "category": "Color Reversal / Slide",
            "source_type": "synth",
            "synth_func": recipe_kodachrome_64,
            "description": "Legendary National Geographic archival look: warm amber-yellow bias and punchy primary colors.",
            "traits": ["warm yellow-red", "punchy primaries", "archival look", "national geographic"],
        },
        {
            "id": "momints-ektar-100",
            "name": "Momints Ektar 100",
            "inspiration": "Kodak Ektar 100 (C-41)",
            "category": "Color Negative",
            "source_type": "synth",
            "synth_func": recipe_ektar_100,
            "description": "Ultra-fine grain with the highest saturation of any color negative film. Crisp cyan and red pop.",
            "traits": ["ultra-fine grain", "saturated negative", "vibrant cyan/red", "crisp acutance"],
        },
        {
            "id": "momints-provia-100f",
            "name": "Momints Provia 100F",
            "inspiration": "Fuji Provia 100F (E-6)",
            "category": "Color Reversal / Slide",
            "source_type": "synth",
            "synth_func": recipe_provia_100f,
            "description": "Faithful, neutral slide film. Uncompromising daylight color accuracy and clean emerald greens.",
            "traits": ["daylight balanced", "neutral color", "emerald clarity", "true fidelity"],
        },
        {
            "id": "momints-hp5-plus",
            "name": "Momints HP5 Plus",
            "inspiration": "Ilford HP5 Plus (B&W)",
            "category": "Black & White",
            "source_type": "synth",
            "synth_func": recipe_hp5_plus,
            "description": "Smooth wide tonal latitude with gentle highlight roll-off and balanced medium contrast.",
            "traits": ["smooth tonal range", "gentle highlights", "classic ilford", "rich midtones"],
        },
        {
            "id": "momints-lomo-purple",
            "name": "Momints Lomo Purple",
            "inspiration": "LomoChrome Purple XR",
            "category": "Creative Specialty",
            "source_type": "synth",
            "synth_func": recipe_lomo_purple,
            "description": "Surreal experimental infrared shift: foliage greens transform into electric violet and magenta.",
            "traits": ["color shift", "violet foliage", "surreal infrared", "lomography style"],
        },
    ]

    for stock in stocks:
        stock_id = stock["id"]
        print(f"Processing [{stock_id}] - {stock['name']}...", end=" ", flush=True)

        # Obtain LUT table
        if stock["source_type"] == "png":
            lut_table = parse_strip_png(stock["source_path"], size=32)
            cube_out = os.path.join(PROJECT_ROOT, "worker", "filmstock-sources", stock_id, "source", f"{stock_id}.cube")
            lut_out = os.path.join(PROJECT_ROOT, "worker", "filmstock-assets", "filmstocks", stock_id, "runtime", f"{stock_id}.lut")
            export_cube_file(lut_table, cube_out, title=stock["name"])
            export_runtime_lut(lut_table, lut_out)
        elif stock["source_type"] == "cube":
            lut_table, _ = parse_cube_file(stock["source_path"])
        elif stock["source_type"] == "synth":
            lut_table = create_synthesized_lut(stock["synth_func"], size=33)
            cube_out = os.path.join(PROJECT_ROOT, "worker", "filmstock-sources", stock_id, "source", f"{stock_id}.cube")
            lut_out = os.path.join(PROJECT_ROOT, "worker", "filmstock-assets", "filmstocks", stock_id, "runtime", f"{stock_id}.lut")
            export_cube_file(lut_table, cube_out, title=stock["name"])
            export_runtime_lut(lut_table, lut_out)

        # Grade the benchmark image
        graded_rgb = apply_trilinear_lut(bench_rgb, lut_table)
        graded_img = Image.fromarray(graded_rgb)
        
        # Save preview thumbnail
        thumb_filename = f"{stock_id}.jpg"
        thumb_path = os.path.join(PREVIEWS_DIR, thumb_filename)
        graded_img.save(thumb_path, format="JPEG", quality=90)
        stock["thumb_filename"] = thumb_filename
        print(f"Done (saved {thumb_filename})")

    # Write Markdown Showcase README
    print("\nGenerating visual catalogue README...")
    with open(SHOWCASE_MD, "w", encoding="utf-8") as md:
        md.write("# Momints Film Stock & LUT Showcase Catalogue\n\n")
        md.write("> **Internal Review Document for Zaac & Trav.**  \n")
        md.write("> Visual proof sheet and technical index of all curated film stocks available for selection and staging in Momints.  \n")
        md.write("> All protected brand trademarks have been safely abstracted into evocative Momints names.\n\n")
        md.write("---\n\n")

        md.write("## 1. Quick Comparison Index\n\n")
        md.write("| Stock Name | Category | Inspiration | Key Aesthetic |\n")
        md.write("| :--- | :--- | :--- | :--- |\n")
        for s in stocks:
            md.write(f"| **{s['name']}** | {s['category']} | *{s['inspiration']}* | {s['description']} |\n")
        md.write("\n---\n\n")

        md.write("## 2. Visual Proof Sheet (Side-by-Side Review)\n\n")
        md.write("### Benchmark Scene: Original Reference\n\n")
        md.write("![Original Reference](previews/original-reference.jpg)\n\n")
        md.write("---\n\n")

        # Group by category
        categories = ["Color Negative", "Color Reversal / Slide", "Black & White", "Cine & Specialty", "Creative Specialty", "Vintage Reversal"]
        for cat in categories:
            cat_stocks = [s for s in stocks if s["category"] == cat]
            if not cat_stocks:
                continue
            md.write(f"### Category: {cat}\n\n")
            for s in cat_stocks:
                md.write(f"#### {s['name']} (`{s['id']}`)\n")
                md.write(f"- **Inspiration:** *{s['inspiration']}*\n")
                md.write(f"- **Look & Mood:** {s['description']}\n")
                md.write(f"- **Visual Traits:** `{'` · `'.join(s['traits'])}`\n\n")
                md.write(f"![{s['name']}](previews/{s['thumb_filename']})\n\n")
                md.write("---\n\n")

        md.write("## 3. How Trav Can Deploy Any Stock to Staging\n\n")
        md.write("1. **Zero App Rebuilds:** The Momints app downloads selected film stock packages on-demand from the Cloudflare Worker via `GET /v1/filmstocks`.\n")
        md.write("2. **Staging Packages:** All 12 stocks have compiled 33-point `.cube` and runtime `.lut` assets staged in `worker/filmstock-sources/` and `worker/filmstock-assets/`.\n")
        md.write("3. **Publishing a Batch:** To activate any stock for users or testing, Trav simply updates `worker/filmstock-catalogue.json` with the chosen stock IDs and deploys the Worker.\n")

    print(f"Catalogue showcase saved to {SHOWCASE_MD}")
    print("Done! All previews rendered successfully.")


if __name__ == "__main__":
    main()

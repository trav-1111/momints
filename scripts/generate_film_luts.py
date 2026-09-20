#!/usr/bin/env python3
"""
Film Stock LUT Generator for Momints
Uses spectral_film_lut to synthesize authentic 3D LUTs based on manufacturer datasheets
and packs them into optimized 2D strip textures (1024x32 PNG) for Skia GPU shaders.
"""

import argparse
import json
import os
import time

LUT_SIZE = 32
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "luts")

def get_stocks():
    """Load the optional spectral dependency only when baking LUT assets."""
    from spectral_film_lut.negative_film.kodak_5219 import KODAK_5219
    from spectral_film_lut.negative_film.kodak_gold_200 import KODAK_GOLD_200
    from spectral_film_lut.negative_film.kodak_portra_400 import KODAK_PORTRA_400
    from spectral_film_lut.reversal_film.fuji_velvia_50 import FUJI_VELVIA_50
    from spectral_film_lut.bw_negative_film.kodak_trix_400 import KODAK_TRI_X_400
    from spectral_film_lut.print_film.kodak_2383 import KODAK_2383
    from spectral_film_lut.print_film.kodak_endura_premier import KODAK_ENDURA_PREMIER

    return [
        {
            "id": "momints-aura-400",
            "legacy_id": "kodak-portra-400",
            "name": "Momints Aura 400",
            "negative": KODAK_PORTRA_400,
            "print": KODAK_ENDURA_PREMIER,
            "kwargs": {"input_colorspace": "sRGB", "gamma_func": "sRGB"},
        },
        {
            "id": "momints-neon-800t",
            "legacy_id": "cinestill-800t",
            "name": "Momints Neon 800T",
            "negative": KODAK_5219,
            "print": KODAK_2383,
            "kwargs": {"input_colorspace": "sRGB", "gamma_func": "sRGB"},
        },
        {
            "id": "momints-vivid-50",
            "legacy_id": "fuji-velvia-50",
            "name": "Momints Vivid 50",
            "negative": FUJI_VELVIA_50,
            "print": None,
            "kwargs": {"input_colorspace": "sRGB", "gamma_func": "sRGB"},
        },
        {
            "id": "momints-amber-200",
            "legacy_id": "kodak-gold-200",
            "name": "Momints Amber 200",
            "negative": KODAK_GOLD_200,
            "print": KODAK_ENDURA_PREMIER,
            "kwargs": {"input_colorspace": "sRGB", "gamma_func": "sRGB"},
        },
        {
            "id": "momints-silver-400",
            "legacy_id": "kodak-tri-x-400",
            "name": "Momints Silver 400",
            "negative": KODAK_TRI_X_400,
            "print": None,
            "kwargs": {
                "input_colorspace": "sRGB",
                "gamma_func": "sRGB",
                "inversion": True,
            },
        },
    ]


def lut_strip_xy(red_index: int, green_index: int, blue_index: int, size: int = LUT_SIZE):
    """Return the packed pixel coordinate shared with the SkSL sampler."""
    return blue_index * size + red_index, green_index


def pack_strip_bytes(table_3d, size: int = LUT_SIZE):
    """
    Packs an (N, N, N, 3) float32 3D LUT into an (N, N*N, 3) uint8 strip image.
    X-axis = blue_slice * N + red_index
    Y-axis = green_index
    """
    strip = bytearray(size * size * size * 3)
    for r in range(size):
        for g in range(size):
            for b in range(size):
                x, y = lut_strip_xy(r, g, b, size)
                offset = (y * size * size + x) * 3
                for channel, value in enumerate(table_3d[r, g, b]):
                    strip[offset + channel] = int(min(255, max(0, value * 255.0)))
    return bytes(strip)


def pack_3d_lut_to_strip(table_3d, size: int = LUT_SIZE):
    from PIL import Image

    return Image.frombytes("RGB", (size * size, size), pack_strip_bytes(table_3d, size))


def run_self_test():
    # Exercise the very same byte packing used to bake PNGs, without numpy/Pillow.
    class AxisTable:
        def __getitem__(self, indices):
            return [index / 31 for index in indices]

    packed = pack_strip_bytes(AxisTable())
    checked = 0
    for y in range(LUT_SIZE):
        for x in range(LUT_SIZE * LUT_SIZE):
            offset = (y * LUT_SIZE * LUT_SIZE + x) * 3
            expected = bytes(int(index / 31 * 255) for index in (x % 32, y, x // 32))
            assert packed[offset:offset + 3] == expected
            checked += 1
    probes = [(0, 0, 0), (31, 0, 0), (0, 31, 0), (0, 0, 31), (13, 17, 23), (31, 31, 31)]
    coordinates = [
        {"r": r, "g": g, "b": b, "x": lut_strip_xy(r, g, b)[0], "y": lut_strip_xy(r, g, b)[1]}
        for r, g, b in probes
    ]
    assert coordinates[0]["x"] == 0 and coordinates[0]["y"] == 0
    assert coordinates[-1]["x"] == LUT_SIZE * LUT_SIZE - 1
    assert coordinates[-1]["y"] == LUT_SIZE - 1
    print(json.dumps({"size": LUT_SIZE, "width": LUT_SIZE * LUT_SIZE, "height": LUT_SIZE,
                      "packedPixelsChecked": checked, "coordinates": coordinates}))


def main(output_dir=OUTPUT_DIR):
    from spectral_film_lut.film_spectral import FilmSpectral
    from spectral_film_lut.utils import create_lut

    stocks = get_stocks()
    os.makedirs(output_dir, exist_ok=True)
    print(f"Baking {len(stocks)} Momints film stock LUTs (size {LUT_SIZE}^3) -> {output_dir}\n")

    for stock in stocks:
        t0 = time.time()
        stock_id = stock["id"]
        stock_name = stock["name"]
        print(f"Generating [{stock_id}] - {stock_name}...", end=" ", flush=True)

        neg_spec = FilmSpectral(stock["negative"])
        prt_spec = FilmSpectral(stock["print"]) if stock["print"] is not None else None

        table = create_lut(
            negative_film=neg_spec,
            print_film=prt_spec,
            lut_size=LUT_SIZE,
            cube=False,
            **stock["kwargs"],
        )

        strip_img = pack_3d_lut_to_strip(table, size=LUT_SIZE)
        out_path = os.path.join(output_dir, f"{stock_id}.png")
        strip_img.save(out_path, format="PNG", optimize=True)

        # Also write legacy filename for seamless backwards compatibility
        legacy_id = stock.get("legacy_id")
        if legacy_id:
            legacy_path = os.path.join(output_dir, f"{legacy_id}.png")
            strip_img.save(legacy_path, format="PNG", optimize=True)

        size_kb = os.path.getsize(out_path) / 1024.0
        elapsed = time.time() - t0
        print(f"Done in {elapsed:.2f}s ({size_kb:.1f} KB -> {out_path})")

    print("\nAll Momints film stock LUT textures successfully baked!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true", help="verify LUT strip coordinate packing without dependencies")
    parser.add_argument("--output-dir", default=OUTPUT_DIR, help="directory for generated PNG strips")
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
    else:
        main(os.path.abspath(args.output_dir))

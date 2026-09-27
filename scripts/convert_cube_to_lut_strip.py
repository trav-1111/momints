#!/usr/bin/env python3
"""
Convert .cube 3D LUTs (e.g. 33x33x33) into 1024x32 RGB PNG strip textures (32x32x32)
matching the Momints SkSL and Native OpenGL ES film emulation shader layout.
"""

import math
import os
import sys
from PIL import Image

TARGET_SIZE = 32
TARGET_WIDTH = TARGET_SIZE * TARGET_SIZE  # 1024
TARGET_HEIGHT = TARGET_SIZE  # 32

def parse_cube(cube_path):
    with open(cube_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    size = None
    domain_min = [0.0, 0.0, 0.0]
    domain_max = [1.0, 1.0, 1.0]
    values = []
    
    for line_num, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split()
        keyword = parts[0]
        
        if keyword == 'TITLE':
            continue
        if keyword == 'LUT_3D_SIZE':
            size = int(parts[1])
            continue
        if keyword in ('DOMAIN_MIN', 'DOMAIN_MAX'):
            parsed = [float(p) for p in parts[1:4]]
            if keyword == 'DOMAIN_MIN':
                domain_min = parsed
            else:
                domain_max = parsed
            continue
        if keyword.isalpha() and keyword.isupper():
            continue
            
        triplet = [float(p) for p in parts]
        if len(triplet) == 3:
            values.append(triplet)
            
    if size is None:
        raise ValueError(f"Missing LUT_3D_SIZE in {cube_path}")
    expected_samples = size ** 3
    if len(values) != expected_samples:
        raise ValueError(f"Expected {expected_samples} samples, got {len(values)} in {cube_path}")
        
    return size, values

def trilinear_sample(cube_values, size, r_norm, g_norm, b_norm):
    rx = min(1.0, max(0.0, r_norm)) * (size - 1)
    gy = min(1.0, max(0.0, g_norm)) * (size - 1)
    bz = min(1.0, max(0.0, b_norm)) * (size - 1)
    
    r0 = int(math.floor(rx))
    r1 = min(r0 + 1, size - 1)
    g0 = int(math.floor(gy))
    g1 = min(g0 + 1, size - 1)
    b0 = int(math.floor(bz))
    b1 = min(b0 + 1, size - 1)
    
    fr = rx - r0
    fg = gy - g0
    fb = bz - b0
    
    def at(r, g, b):
        return cube_values[b * size * size + g * size + r]
    
    c000 = at(r0, g0, b0)
    c100 = at(r1, g0, b0)
    c010 = at(r0, g1, b0)
    c110 = at(r1, g1, b0)
    c001 = at(r0, g0, b1)
    c101 = at(r1, g0, b1)
    c011 = at(r0, g1, b1)
    c111 = at(r1, g1, b1)
    
    out = [0.0, 0.0, 0.0]
    for ch in range(3):
        c00 = c000[ch] + (c100[ch] - c000[ch]) * fr
        c10 = c010[ch] + (c110[ch] - c010[ch]) * fr
        c01 = c001[ch] + (c101[ch] - c001[ch]) * fr
        c11 = c011[ch] + (c111[ch] - c011[ch]) * fr
        
        c0 = c00 + (c10 - c00) * fg
        c1 = c01 + (c11 - c01) * fg
        
        out[ch] = c0 + (c1 - c0) * fb
        
    return out

def convert_cube_to_strip(cube_path, output_png_path):
    size, values = parse_cube(cube_path)
    print(f"Loaded {cube_path}: size {size}^3 ({len(values)} samples)")
    
    # 1024x32 RGB strip: x = b * 32 + r, y = g
    strip = bytearray(TARGET_WIDTH * TARGET_HEIGHT * 3)
    
    for b in range(TARGET_SIZE):
        b_norm = b / (TARGET_SIZE - 1.0)
        for g in range(TARGET_SIZE):
            g_norm = g / (TARGET_SIZE - 1.0)
            for r in range(TARGET_SIZE):
                r_norm = r / (TARGET_SIZE - 1.0)
                
                rgb = trilinear_sample(values, size, r_norm, g_norm, b_norm)
                
                x = b * TARGET_SIZE + r
                y = g
                offset = (y * TARGET_WIDTH + x) * 3
                
                strip[offset + 0] = int(round(min(255.0, max(0.0, rgb[0] * 255.0))))
                strip[offset + 1] = int(round(min(255.0, max(0.0, rgb[1] * 255.0))))
                strip[offset + 2] = int(round(min(255.0, max(0.0, rgb[2] * 255.0))))
                
    img = Image.frombytes("RGB", (TARGET_WIDTH, TARGET_HEIGHT), bytes(strip))
    img.save(output_png_path, format="PNG", optimize=True)
    print(f"Saved {output_png_path} ({TARGET_WIDTH}x{TARGET_HEIGHT}, RGB 8-bit)")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: convert_cube_to_lut_strip.py <input.cube> <output.png>")
        sys.exit(1)
    convert_cube_to_strip(sys.argv[1], sys.argv[2])

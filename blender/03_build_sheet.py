"""
03 — Une los cuadros de lava en una sprite sheet.

Uso (desde la raíz del repo, con Python 3 + Pillow y numpy: `pip install pillow numpy`):
    python blender/03_build_sheet.py

Entrada: blender/output/frame_00.png ... frame_15.png (512x512)
Salida:  assets/mask/lava_sheet.png (cuadrícula 4x4 = 2048x2048, PNG con transparencia)

Orden de los cuadros: de izquierda a derecha y de arriba hacia abajo
(cuadro 0 arriba a la izquierda), igual que lo lee el shader de mask.js.
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES_DIR = os.path.join(ROOT, "blender", "output")
OUT_PATH = os.path.join(ROOT, "assets", "mask", "lava_sheet.png")

GRID = 4
FRAMES = GRID * GRID
MAX_BYTES = 4 * 1024 * 1024  # objetivo de peso
# Bits por canal de color. 7 = 128 niveles: no se notan bandas y el PNG baja ~11%.
COLOR_BITS = 7


def main():
    frames = []
    for i in range(FRAMES):
        path = os.path.join(FRAMES_DIR, f"frame_{i:02d}.png")
        if not os.path.exists(path):
            sys.exit(f"[03] falta {path}: corre primero 02_lava_frames.py")
        frames.append(Image.open(path).convert("RGBA"))

    size = frames[0].width
    if any(f.size != (size, size) for f in frames):
        sys.exit("[03] todos los cuadros deben ser cuadrados y del mismo tamaño")

    sheet = Image.new("RGBA", (size * GRID, size * GRID), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(frame, ((i % GRID) * size, (i // GRID) * size))

    if COLOR_BITS < 8:
        px = np.asarray(sheet).copy()
        keep = (0xFF << (8 - COLOR_BITS)) & 0xFF
        # Se conservan los bits altos y se replican abajo para que 255 siga siendo 255.
        px[..., :3] = (px[..., :3] & keep) | (px[..., :3] >> COLOR_BITS)
        sheet = Image.fromarray(px, "RGBA")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    sheet.save(OUT_PATH, optimize=True, compress_level=9)
    weight = os.path.getsize(OUT_PATH)
    print(f"[03] {OUT_PATH}: {sheet.width}x{sheet.height}, {weight / 1024 / 1024:.2f} MB")
    if weight > MAX_BYTES:
        print("[03] AVISO: supera 4 MB; considera bajar COLOR_BITS o SIZE en 02.")


if __name__ == "__main__":
    main()

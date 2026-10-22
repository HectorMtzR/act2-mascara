"""
04 — Sprite de brasa/chispa para las partículas de la erupción.

Uso (desde la raíz del repo, con Python 3 + Pillow y numpy):
    python blender/04_ember.py

Salida: assets/particles/ember.png (64x64, fondo transparente).
Núcleo casi blanco, anillo amarillo y halo naranja que se desvanece; pensado para
mezcla aditiva (THREE.AdditiveBlending).
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "assets", "particles", "ember.png")
SIZE = 64

# (radio normalizado, color sRGB) — de adentro hacia afuera.
STOPS = [
    (0.00, (255, 250, 225)),
    (0.18, (255, 210, 63)),   # #ffd23f
    (0.45, (255, 90, 0)),     # #ff5a00
    (1.00, (150, 20, 0)),
]


def main():
    c = (SIZE - 1) / 2
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    r = np.hypot(x - c, y - c) / (SIZE / 2)  # 0 en el centro, 1 en el borde

    pos = [s[0] for s in STOPS]
    rgb = np.dstack([np.interp(r, pos, [s[1][k] for s in STOPS]) for k in range(3)])

    # Núcleo sólido + halo suave que llega a 0 antes del borde (sin cortes cuadrados).
    core = np.clip(1 - r / 0.22, 0, 1) ** 0.5
    halo = np.clip(1 - r, 0, 1) ** 2.2
    alpha = np.clip(np.maximum(core, halo), 0, 1)

    img = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    Image.fromarray(img, "RGBA").save(OUT_PATH, optimize=True)
    print(f"[04] {OUT_PATH}: {SIZE}x{SIZE}, {os.path.getsize(OUT_PATH)} bytes")


if __name__ == "__main__":
    main()

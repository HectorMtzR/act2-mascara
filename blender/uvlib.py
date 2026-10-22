"""
Utilidades compartidas por los scripts de Blender: lectura del OBJ canónico y
máscaras rasterizadas en espacio UV con numpy (funciona dentro de Blender, sin Pillow).

Convención de imágenes: arreglos (N, N[, C]) con la fila 0 ABAJO (igual que `image.pixels`
de Blender y que la coordenada v de las UVs).
"""
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJ_PATH = os.path.join(ROOT, "assets", "face", "canonical_face_model.obj")

# Contornos de MediaPipe Face Mesh (índices de landmark), en orden alrededor del hueco.
MOUTH_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
               324, 318, 402, 317, 14, 87, 178, 88, 95]
EYE_RIGHT = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
EYE_LEFT = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]


def load_canonical_obj(path=OBJ_PATH):
    """Devuelve (verts (468,3), uvs (468,2) por índice de vértice, faces (898,3))."""
    verts, vts, faces = [], [], []
    for line in open(path, encoding="utf-8"):
        p = line.split()
        if not p:
            continue
        if p[0] == "v":
            verts.append([float(x) for x in p[1:4]])
        elif p[0] == "vt":
            vts.append([float(x) for x in p[1:3]])
        elif p[0] == "f":
            faces.append([[int(n) - 1 for n in c.split("/")[:2]] for c in p[1:4]])
    uvs = np.zeros((len(verts), 2))
    for face in faces:
        for vi, ti in face:
            uvs[vi] = vts[ti]
    tri = np.array([[vi for vi, _ in f] for f in faces])
    return np.array(verts), uvs, tri


def _pixel_grid(x0, y0, x1, y1):
    return np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)


def _bbox(pts, n):
    x0, y0 = np.floor(pts.min(0)).astype(int)
    x1, y1 = np.ceil(pts.max(0)).astype(int)
    return max(x0, 0), max(y0, 0), min(x1, n - 1), min(y1, n - 1)


def fill_triangles(n, tris_uv):
    """Máscara booleana de los triángulos (tris_uv: (T,3,2) en UV 0..1)."""
    mask = np.zeros((n, n), dtype=bool)
    for a, b, c in tris_uv * n:
        x0, y0, x1, y1 = _bbox(np.array([a, b, c]), n)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        xs, ys = _pixel_grid(x0, y0, x1, y1)
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        mask[y0:y1 + 1, x0:x1 + 1] |= (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
    return mask


def fill_polygon(n, poly_uv):
    """Máscara booleana de un polígono cerrado (regla par-impar)."""
    pts = np.asarray(poly_uv) * n
    mask = np.zeros((n, n), dtype=bool)
    x0, y0, x1, y1 = _bbox(pts, n)
    xs, ys = _pixel_grid(x0, y0, x1, y1)
    inside = np.zeros(xs.shape, dtype=bool)
    for (xa, ya), (xb, yb) in zip(pts, np.roll(pts, -1, axis=0)):
        crosses = (ya > ys) != (yb > ys)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = xa + (ys - ya) * (xb - xa) / (yb - ya)
        inside ^= crosses & (xs < xi)
    mask[y0:y1 + 1, x0:x1 + 1] = inside
    return mask


def draw_polyline(n, poly_uv, closed=True):
    """Máscara booleana del contorno (1 px), útil para polígonos casi planos."""
    pts = np.asarray(poly_uv) * n
    if closed:
        pts = np.vstack([pts, pts[:1]])
    mask = np.zeros((n, n), dtype=bool)
    for p, q in zip(pts[:-1], pts[1:]):
        k = int(np.hypot(*(q - p))) * 2 + 2
        s = (p + (q - p) * np.linspace(0, 1, k)[:, None]).astype(int).clip(0, n - 1)
        mask[s[:, 1], s[:, 0]] = True
    return mask


def dilate(mask, radius):
    """Dilatación con disco de radio `radius` px."""
    out = mask.copy()
    r = int(np.ceil(radius))
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= radius * radius and (dx or dy):
                out |= np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
    return out


def blur(img, radius, passes=3):
    """Desenfoque de caja separable repetido (≈ gaussiano)."""
    out = img.astype(np.float32)
    r = max(int(radius), 1)
    k = 2 * r + 1
    for _ in range(passes):
        for axis in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode="edge"), axis=axis)
            hi = np.take(c, np.arange(k, c.shape[axis]), axis=axis)
            lo = np.take(c, np.arange(0, c.shape[axis] - k), axis=axis)
            out = (hi - lo) / k
    return out


def linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_hex_to_linear(hex_color):
    """'#ff5a00' -> (r, g, b, 1) lineal, para colores de nodos de Blender."""
    h = hex_color.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return (*lin.tolist(), 1.0)

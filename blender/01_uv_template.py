"""
01 — Plantilla UV de la malla canónica de MediaPipe.

Uso (desde la raíz del repo):
    blender --background --factory-startup --python blender/01_uv_template.py

Salida: assets/face/uv_template.png (1024x1024, PNG con transparencia).

Primero intenta `bpy.ops.uv.export_layout`. Si falla en modo terminal (necesita contexto
de edición / GPU), dibuja los triángulos UV directamente con numpy.
"""
import os
import sys

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJ_PATH = os.path.join(ROOT, "assets", "face", "canonical_face_model.obj")
OUT_PATH = os.path.join(ROOT, "assets", "face", "uv_template.png")
SIZE = 1024

FILL_RGBA = (1.0, 0.55, 0.1, 0.35)   # relleno de cada triángulo (naranja translúcido)
EDGE_RGBA = (0.08, 0.02, 0.0, 0.95)  # aristas casi negras (contraste sobre la piel)
EDGE_PX = 2.5                        # grosor de las aristas (en cámara la textura se reduce ~3x)


def import_canonical_mesh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=OBJ_PATH)
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


def export_with_operator(obj):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.export_layout(
        filepath=OUT_PATH,
        export_all=True,
        mode="PNG",
        size=(SIZE, SIZE),
        opacity=0.35,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_triangles(obj):
    """Triángulos en coordenadas UV (N, 3, 2)."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers.active.data
    tris = [[uv[li].uv[:] for li in t.loops] for t in mesh.loop_triangles]
    return np.array(tris, dtype=np.float64)


def rasterize(tris):
    """Dibuja relleno + aristas de cada triángulo. Fila 0 = abajo (convención de Blender)."""
    img = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    px = tris * SIZE

    # Relleno con coordenadas baricéntricas dentro de la caja de cada triángulo.
    for a, b, c in px:
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, SIZE - 1), min(y1, SIZE - 1)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
        img[y0:y1 + 1, x0:x1 + 1][inside] = FILL_RGBA

    # Aristas: muestrear cada segmento y pintar un disco de radio EDGE_PX.
    r = int(np.ceil(EDGE_PX))
    offs = [(dx, dy) for dx in range(-r, r + 1) for dy in range(-r, r + 1) if dx * dx + dy * dy <= EDGE_PX ** 2]
    for tri in px:
        for p, q in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            n = int(np.hypot(*(q - p))) * 2 + 2
            pts = p + (q - p) * np.linspace(0, 1, n)[:, None]
            ix = pts.astype(int)
            for dx, dy in offs:
                x = np.clip(ix[:, 0] + dx, 0, SIZE - 1)
                y = np.clip(ix[:, 1] + dy, 0, SIZE - 1)
                img[y, x] = EDGE_RGBA
    return img


def save_png(pixels):
    image = bpy.data.images.new("uv_template", SIZE, SIZE, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = OUT_PATH
    image.file_format = "PNG"
    image.save()


def main():
    obj = import_canonical_mesh()
    print(f"[01] malla: {len(obj.data.vertices)} vértices, {len(obj.data.polygons)} caras")
    try:
        export_with_operator(obj)
        print("[01] plantilla exportada con uv.export_layout")
    except Exception as err:  # noqa: BLE001 — cualquier fallo del operador activa el plan B
        reason = str(err).strip().splitlines()[-2:-1] or [str(err)]
        print(f"[01] uv.export_layout falló ({reason[0].strip()}); dibujando con numpy")
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        save_png(rasterize(uv_triangles(obj)))
    print(f"[01] listo: {OUT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"[01] ERROR: {err}")
        sys.exit(1)

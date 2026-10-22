"""
02 — Cuadros de la animación de lava, horneados (bake) a la UV de la malla canónica.

Uso (desde la raíz del repo):
    blender --background --factory-startup --python blender/02_lava_frames.py

Salida: blender/output/frame_00.png ... frame_15.png (512x512, PNG con transparencia).

Flujo:
  1. Importa la malla canónica de MediaPipe (UVs incluidas).
  2. Guarda en cada vértice un peso "heat" (ojos, frente, pómulos) para que ahí haya
     más grietas y más brillo.
  3. Material procedural: Voronoi (distancia a borde) = grietas, Noise = roca,
     ColorRamp + Emission = lava.
  4. Por cada cuadro mueve el ruido del flujo en un círculo (cos/sin de la fase) y modula el
     brillo con sin(2·fase): el último cuadro empata con el primero, el loop no salta.
  5. Hornea la emisión a una imagen en espacio UV (Cycles) y aplica alfa = 0 en ojos y boca.
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uvlib  # noqa: E402

OUT_DIR = os.path.join(uvlib.ROOT, "blender", "output")

# --- Ajustes de la animación ---
FRAMES = 16
SIZE = 512                # tamaño final de cada cuadro
SUPERSAMPLE = 2           # se hornea a SIZE*2 y se reduce (bordes suaves)
BAKE_SAMPLES = 4

# --- Ajustes del diseño ---
COLORS = {
    "rock_dark": "#1a1414",
    "rock_mid": "#2a201d",
    "rock_light": "#3a2e2a",
    "lava_deep": "#7a1500",
    "lava": "#ff5a00",
    "lava_core": "#ffd23f",
    "lava_white": "#fff4c2",
}
CRACK_SCALE = 0.55        # grietas principales (celdas por unidad de la malla, ~15 de ancho)
FINE_CRACK_SCALE = 1.35   # grietas finas, solo en zonas intensas
CRACK_WIDTH = (0.035, 0.085)  # ancho mínimo/máximo (varía a lo largo de la grieta)
FLOW_RADIUS = 1.6         # cuánto se desplaza el ruido del flujo en un loop
FLOW_SCALE = 0.6          # tamaño de los "pulsos" de lava que recorren las grietas
FLOW_CONTRAST = (0.2, 1.45)  # energía mínima/máxima de la lava a lo largo de la grieta
PULSE = 0.3               # amplitud del latido del brillo

# Zonas intensas (centro x, y en unidades de la malla canónica, radio).
HOT_SPOTS = [
    ((-3.15, 2.62), 2.2),   # ojo derecho
    ((3.15, 2.62), 2.2),    # ojo izquierdo
    ((0.0, 6.2), 3.2),      # frente
    ((-4.9, -0.6), 2.0),    # pómulo derecho
    ((4.9, -0.6), 2.0),     # pómulo izquierdo
]

# Transparencia de ojos y boca (px a resolución de bake).
EYE_GROW = 3
MOUTH_GROW = 7
HOLE_FEATHER = 2
ISLAND_MARGIN = 10


# ---------------------------------------------------------------- escena

def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = BAKE_SAMPLES
    scene.render.bake.margin = ISLAND_MARGIN
    scene.render.bake.margin_type = "EXTEND"  # el borde exterior no tiene caras vecinas
    scene.render.bake.use_clear = True
    return scene


def import_mesh(verts_ref):
    # Sin conversión de ejes: las coordenadas quedan iguales a las del OBJ.
    bpy.ops.wm.obj_import(filepath=uvlib.OBJ_PATH, forward_axis="Y", up_axis="Z")
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    co = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    err = np.abs(co.reshape(-1, 3) - verts_ref).max()
    if err > 1e-4:
        raise RuntimeError(f"El orden de vértices importado no coincide con el OBJ (error {err})")
    return obj


def add_heat_attribute(obj, verts):
    xy = verts[:, :2]
    heat = np.zeros(len(verts))
    for (cx, cy), r in HOT_SPOTS:
        d2 = ((xy - (cx, cy)) ** 2).sum(1)
        heat = np.maximum(heat, np.exp(-d2 / (2 * (r * 0.6) ** 2)))
    attr = obj.data.attributes.new("heat", "FLOAT", "POINT")
    attr.data.foreach_set("value", heat.astype(np.float32))


# ---------------------------------------------------------------- material

class Graph:
    """Atajos para armar el árbol de nodos sin ruido."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nodes = mat.node_tree.nodes
        self.links = mat.node_tree.links
        self.nodes.clear()

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, src, dst):
        self.links.new(src, dst)

    def _in(self, sock, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.link(value, sock)
        else:
            sock.default_value = value

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        self._in(n.inputs[2], c)
        return n.outputs[0]

    def vadd(self, a, b):
        n = self.node("ShaderNodeVectorMath", operation="ADD")
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        return n.outputs[0]

    def vscale(self, a, s):
        n = self.node("ShaderNodeVectorMath", operation="SCALE")
        self._in(n.inputs[0], a)
        self._in(n.inputs["Scale"], s)
        return n.outputs[0]

    def noise(self, vec, scale, detail=2.0, roughness=0.5):
        n = self.node("ShaderNodeTexNoise", noise_dimensions="3D")
        self._in(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = roughness
        return n

    def voronoi(self, vec, scale, feature):
        n = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature=feature)
        self._in(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = 1.0
        return n

    def smoothstep(self, value, lo, hi, out_lo=0.0, out_hi=1.0):
        n = self.node("ShaderNodeMapRange", data_type="FLOAT", interpolation_type="SMOOTHSTEP", clamp=True)
        self._in(n.inputs["Value"], value)
        self._in(n.inputs["From Min"], lo)
        self._in(n.inputs["From Max"], hi)
        self._in(n.inputs["To Min"], out_lo)
        self._in(n.inputs["To Max"], out_hi)
        return n.outputs["Result"]

    def ramp(self, fac, stops):
        n = self.node("ShaderNodeValToRGB")
        els = n.color_ramp.elements
        # La rampa trae 2 elementos (0 y 1); se reubican los extremos y se crean los del medio.
        (p0, c0), (p1, c1) = stops[0], stops[-1]
        els[0].position, els[0].color = p0, uvlib.srgb_hex_to_linear(c0)
        els[1].position, els[1].color = p1, uvlib.srgb_hex_to_linear(c1)
        for pos, hex_color in stops[1:-1]:
            els.new(pos).color = uvlib.srgb_hex_to_linear(hex_color)
        self._in(n.inputs["Fac"], fac)
        return n.outputs["Color"]

    def mix(self, blend, a, b, fac=1.0):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_result=False)
        self._in(n.inputs[0], fac)
        self._in(n.inputs[6], a)
        self._in(n.inputs[7], b)
        return n.outputs[2]


def build_material(obj, bake_image):
    mat = bpy.data.materials.new("Lava")
    obj.data.materials.append(mat)
    g = Graph(mat)

    coord = g.node("ShaderNodeTexCoord").outputs["Object"]
    heat = g.node("ShaderNodeAttribute", attribute_name="heat").outputs["Fac"]

    # Controles por cuadro (se cambian antes de cada bake).
    flow_offset = g.node("ShaderNodeCombineXYZ")
    pulse = g.node("ShaderNodeValue")
    pulse.outputs[0].default_value = 1.0

    # Coordenadas deformadas con ruido para que las grietas sean irregulares (fijas en el tiempo).
    warp = g.noise(coord, scale=0.18, detail=3.0).outputs["Color"]
    warp = g.vscale(g.vadd(warp, (-0.5, -0.5, -0.5)), 2.2)
    wcoord = g.vadd(coord, warp)

    # --- Grietas (Voronoi, distancia a borde) ---
    width_var = g.noise(coord, scale=0.45, detail=1.0).outputs["Fac"]
    width = g.smoothstep(width_var, 0.3, 0.7, *CRACK_WIDTH)
    d_main = g.voronoi(wcoord, CRACK_SCALE, "DISTANCE_TO_EDGE").outputs["Distance"]
    crack_main = g.smoothstep(d_main, 0.0, width, 1.0, 0.0)

    d_fine = g.voronoi(wcoord, FINE_CRACK_SCALE, "DISTANCE_TO_EDGE").outputs["Distance"]
    crack_fine = g.smoothstep(d_fine, 0.0, g.math("MULTIPLY", width, 0.75), 1.0, 0.0)
    fine_mask = g.smoothstep(heat, 0.25, 0.7)
    crack = g.math("MAXIMUM", crack_main, g.math("MULTIPLY", crack_fine, fine_mask))

    # --- Roca: ruido fino + placas con tono propio + bordes chamuscados ---
    # Detalle moderado: el grano muy fino se pierde en cámara y infla el PNG.
    rock_noise = g.noise(coord, scale=1.6, detail=4.0, roughness=0.55).outputs["Fac"]
    rock = g.ramp(rock_noise, [(0.3, COLORS["rock_dark"]), (0.5, COLORS["rock_mid"]),
                               (0.7, COLORS["rock_light"])])
    plate = g.voronoi(wcoord, CRACK_SCALE, "F1").outputs["Color"]
    plate_r = g.node("ShaderNodeSeparateColor")
    g.link(plate, plate_r.inputs[0])
    plate_shade = g.math("MULTIPLY_ADD", plate_r.outputs[0], 0.55, 0.7)
    rock = g.mix("MULTIPLY", rock, plate_shade)
    charred = g.smoothstep(d_main, 0.0, g.math("MULTIPLY", width, 3.0), 0.35, 1.0)
    rock = g.mix("MULTIPLY", rock, charred)

    # Resplandor naranja sobre la roca alrededor de las grietas.
    halo = g.smoothstep(d_main, 0.0, g.math("MULTIPLY", width, 4.5), 1.0, 0.0)
    halo = g.math("MULTIPLY", halo, g.math("MULTIPLY_ADD", heat, 0.25, 0.12))
    halo = g.math("MULTIPLY", halo, pulse.outputs[0])
    rock = g.mix("ADD", rock, uvlib.srgb_hex_to_linear(COLORS["lava"]), halo)

    # --- Lava: el ruido del flujo se desplaza en círculo => loop continuo ---
    flow_coord = g.vadd(coord, flow_offset.outputs[0])
    flow = g.noise(flow_coord, scale=FLOW_SCALE, detail=2.0).outputs["Fac"]
    flicker = g.noise(g.vadd(flow_coord, g.vscale(flow_offset.outputs[0], -1.7)), scale=1.4).outputs["Fac"]
    energy = g.smoothstep(flow, 0.32, 0.68, *FLOW_CONTRAST)
    energy = g.math("MULTIPLY_ADD", g.math("SUBTRACT", flicker, 0.5), 0.6, energy)
    energy = g.math("MULTIPLY", energy, g.math("MULTIPLY_ADD", heat, 0.35, 0.8))
    energy = g.math("MULTIPLY", energy, pulse.outputs[0])
    lava_t = g.math("MULTIPLY", g.math("POWER", crack, 0.8), energy, clamp=True)
    lava = g.ramp(lava_t, [(0.0, COLORS["lava_deep"]), (0.3, COLORS["lava"]),
                           (0.7, COLORS["lava_core"]), (1.0, COLORS["lava_white"])])

    color = g.mix("MIX", rock, lava, g.math("POWER", crack, 0.6))

    emit = g.node("ShaderNodeEmission")
    g.link(color, emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 1.0
    out = g.node("ShaderNodeOutputMaterial")
    g.link(emit.outputs[0], out.inputs["Surface"])

    # Nodo de imagen activo = destino del bake.
    img_node = g.node("ShaderNodeTexImage", image=bake_image)
    g.nodes.active = img_node
    img_node.select = True

    return flow_offset, pulse


# ---------------------------------------------------------------- transparencia

def build_alpha(n, uvs, tri):
    """Alfa en espacio UV: 1 en la cara, 0 en ojos/boca y fuera de la malla."""
    island = uvlib.dilate(uvlib.fill_triangles(n, uvs[tri]), ISLAND_MARGIN)
    holes = np.zeros((n, n), dtype=bool)
    for contour, grow in ((uvlib.EYE_RIGHT, EYE_GROW), (uvlib.EYE_LEFT, EYE_GROW),
                          (uvlib.MOUTH_INNER, MOUTH_GROW)):
        poly = uvs[contour]
        region = uvlib.fill_polygon(n, poly) | uvlib.draw_polyline(n, poly)
        holes |= uvlib.dilate(region, grow)
    soft_holes = np.clip(uvlib.blur(holes, HOLE_FEATHER) * 1.6, 0, 1)
    soft_holes = np.maximum(soft_holes, holes)
    return island.astype(np.float32) * (1.0 - soft_holes)


# ---------------------------------------------------------------- main

def save_frame(rgba_srgb, path):
    n = rgba_srgb.shape[0]
    img = bpy.data.images.new("frame_out", n, n, alpha=True)  # 8 bits: guarda los valores tal cual
    img.pixels.foreach_set(rgba_srgb.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def downsample(img, f):
    if f == 1:
        return img
    n = img.shape[0] // f
    return img.reshape(n, f, n, f, -1).mean(axis=(1, 3))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    verts, uvs, tri = uvlib.load_canonical_obj()

    scene = setup_scene()
    obj = import_mesh(verts)
    add_heat_attribute(obj, verts)

    bake_n = SIZE * SUPERSAMPLE
    bake_img = bpy.data.images.new("bake", bake_n, bake_n, alpha=True, float_buffer=True)
    flow_offset, pulse = build_material(obj, bake_img)
    alpha = build_alpha(bake_n, uvs, tri)

    for f in range(FRAMES):
        phase = 2 * math.pi * f / FRAMES
        flow_offset.inputs["X"].default_value = FLOW_RADIUS * math.cos(phase)
        flow_offset.inputs["Y"].default_value = FLOW_RADIUS * math.sin(phase)
        pulse.outputs[0].default_value = 1.0 + PULSE * math.sin(2 * phase)

        bpy.ops.object.bake(type="EMIT")

        px = np.empty(bake_n * bake_n * 4, dtype=np.float32)
        bake_img.pixels.foreach_get(px)
        px = px.reshape(bake_n, bake_n, 4)
        rgba = np.dstack([uvlib.linear_to_srgb(px[..., :3]), alpha])
        rgba = downsample(rgba, SUPERSAMPLE)

        path = os.path.join(OUT_DIR, f"frame_{f:02d}.png")
        save_frame(rgba, path)
        print(f"[02] {os.path.basename(path)}  (fase {phase:.2f})", flush=True)

    print(f"[02] listo: {FRAMES} cuadros en {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        import traceback
        traceback.print_exc()
        print(f"[02] ERROR: {err}")
        sys.exit(1)

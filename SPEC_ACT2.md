# Máscara de Lava AR — Especificación del proyecto

> Documento para desarrollar con Claude Code. Actividad 2 del curso de Realidad Virtual y Aumentada:
> "Filtro facial interactivo con máscara animada reactiva a gestos".
> **Fecha de entrega: 26 de octubre de 2026.**
>
> **Importante:** este proyecto es la base de la Actividad 3 (máscara de Día de Muertos). Todo debe quedar
> modular para que la Actividad 3 sea copiar el repo, cambiar la textura y cambiar el efecto del gesto.

---

## 1. Resumen

Filtro facial web para celular. Al abrir la página se activa la **cámara frontal**, se detecta el rostro y se le pone encima una **máscara de lava animada** que cubre toda la cara, sigue sus movimientos y se deforma con los gestos.

- **Diseño:** piel de roca volcánica oscura con **grietas de lava** que brillan y laten.
- **Animación:** la lava fluye lento por las grietas y el brillo pulsa en loop.
- **Gesto principal:** al **abrir la boca**, ocurre una **erupción**: las grietas se encienden al máximo, salen chispas y brasas de la boca y suena un rugido de fuego.
- **Gesto secundario (opcional):** al **levantar las cejas**, la lava se calienta (cambia de naranja a amarillo-blanco) por un momento.

La textura animada se **genera en Blender** con scripts de Python que Claude Code escribe y ejecuta desde la terminal.

---

## 2. Stack técnico

### Filtro (web)
- **HTML + CSS + JavaScript (ES modules), sin paso de build.** Sitio estático.
- **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`, desde CDN) con:
  - `runningMode: "VIDEO"`, `numFaces: 1`
  - `outputFaceBlendshapes: true` (para los gestos)
  - Delegado GPU con **respaldo a CPU** si falla (algunos iPhone).
- **three.js** (desde CDN con `importmap`) para dibujar la malla facial con la textura.
- **Web Audio API** para sonidos. Vibración no aplica en este proyecto.
- **Hosting: GitHub Pages** (HTTPS, necesario para la cámara).
- Sin frameworks.

### Textura (Blender)
- **Blender 4.x** ejecutado en modo terminal: `blender --background --python script.py`.
- Antes de empezar, verificar que el comando `blender` funcione en la terminal. Si no está en el PATH, usar la ruta completa del ejecutable (en Mac: `/Applications/Blender.app/Contents/MacOS/Blender`).
- Python con Pillow (o el módulo de imágenes de Blender) para armar la sprite sheet.

---

## 3. Estructura del repositorio

```
/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── main.js        # arranque: cámara, MediaPipe, render loop
│   ├── config.js      # TODAS las constantes ajustables
│   ├── face.js        # MediaPipe: landmarks y blendshapes
│   ├── mask.js        # malla facial three.js + shader de la textura animada
│   ├── gestures.js    # detección de gestos con umbral y pausa (cooldown)
│   ├── effects.js     # partículas (chispas/brasas) y efectos del gesto
│   └── audio.js       # sonidos
├── assets/
│   ├── face/
│   │   ├── canonical_face_model.obj   # malla canónica de MediaPipe (con UVs)
│   │   └── uv_template.png            # plantilla UV exportada
│   ├── mask/
│   │   └── lava_sheet.png             # sprite sheet de la animación (con transparencia)
│   ├── particles/
│   │   └── ember.png                  # sprite de brasa/chispa
│   └── sounds/                        # ambient_fire, eruption, (opcional) sizzle
├── blender/
│   ├── 01_uv_template.py      # exporta la plantilla UV de la malla canónica
│   ├── 02_lava_frames.py      # genera los cuadros de la animación de lava
│   ├── 03_build_sheet.py      # une los cuadros en la sprite sheet
│   └── output/                # cuadros intermedios (se puede ignorar en git)
├── docs/
│   └── screenshots/
├── README.md
└── SPEC_ACT2.md
```

---

## 4. Malla facial

### Origen
- Descargar `canonical_face_model.obj` y `canonical_face_model_uv_visualization.png` del repositorio oficial de MediaPipe (GitHub, carpeta `mediapipe/modules/face_geometry/data/`). Licencia **Apache 2.0** → acreditar en el README.
- **Verificar** que el orden de vértices del OBJ corresponde al índice de los landmarks de MediaPipe (468 puntos; los 10 extra del iris se ignoran para la malla).

### Construcción en three.js
- Crear una `BufferGeometry` con:
  - Los **índices de triángulos** y las **UVs** del OBJ (fijos).
  - Las **posiciones** actualizadas en cada cuadro con los landmarks detectados.
- Cámara **ortográfica** alineada exactamente con el video:
  - `x = (lm.x - 0.5) * ancho`, `y = -(lm.y - 0.5) * alto`, `z = -lm.z * ancho`.
  - **Vista en espejo** (como selfie): invertir X del video y de la malla de forma consistente.
  - Si el video se muestra con `object-fit: cover`, aplicar el mismo recorte/escala a la malla. **Este es el error más común: la máscara desfasada del rostro.** Probarlo primero con la plantilla UV como textura.
- Si no hay rostro detectado, ocultar la máscara (sin errores).

---

## 5. Textura animada en Blender

### Dirección de diseño
| Elemento | Descripción | Color de referencia |
|---|---|---|
| Roca | Piel de roca volcánica, oscura y con relieve visual (ruido) | `#1a1414` – `#3a2e2a` |
| Grietas | Red de grietas irregulares (tipo Voronoi) que recorren toda la cara | Naranja `#ff5a00` |
| Núcleo de grietas | Centro más caliente de las grietas | Amarillo `#ffd23f` |
| Zonas intensas | Más grietas y más brillo alrededor de los **ojos**, la **frente** y los **pómulos** | — |
| Ojos y boca | **Transparentes** (se ven los ojos y la boca reales) | Alfa = 0 |

Colores saturados y contornos marcados: el detalle fino se pierde en cámara.

### Script 01 — Plantilla UV (`01_uv_template.py`)
- Importar `canonical_face_model.obj` en Blender.
- Exportar el layout UV como PNG de **1024×1024** a `assets/face/uv_template.png`.
- Si `bpy.ops.uv.export_layout` falla en modo terminal (necesita contexto de edición), generar la plantilla dibujando los triángulos UV con Pillow a partir del OBJ.

### Script 02 — Cuadros de lava (`02_lava_frames.py`)
- Material procedural sobre la malla canónica:
  - **Voronoi** (distancia a borde) para las grietas.
  - **Noise** para la textura de la roca.
  - **ColorRamp** + **Emission** para el brillo de la lava.
  - Animación: desplazar la entrada de los ruidos con el tiempo para que la lava "fluya", y modular la intensidad de emisión para que **lata**.
- **Hornear (bake)** el resultado a la UV de la malla en cada cuadro (Cycles, bake de Emission/Combined) para que la textura respete los rasgos y **no tenga costuras**.
  - Plan B si el bake da problemas: renderizar un plano con cámara ortográfica y aplicar la máscara de ojos/boca con la plantilla UV.
- **16 cuadros a 512×512**, pensados para reproducirse a ~8–10 fps (loop de ~2 s).
- El loop debe ser **continuo, sin salto** entre el último y el primer cuadro (usar seno/coseno de la fase para mover los ruidos, o fundido cruzado al final).
- Aplicar **alfa = 0** en ojos y boca usando las islas UV de esas zonas.
- Salida: `blender/output/frame_00.png` … `frame_15.png`.

### Script 03 — Sprite sheet (`03_build_sheet.py`)
- Unir los 16 cuadros en una cuadrícula de **4×4** → `assets/mask/lava_sheet.png` (2048×2048, PNG con transparencia).
- Optimizar el peso del archivo (idealmente < 4 MB).

### Revisión visual
Después de cada render, **abrir las imágenes generadas y revisarlas** (cuadros y sprite sheet) antes de integrarlas. Ajustar el script si las grietas se ven planas, si hay costuras o si los ojos/boca no quedan transparentes.

### Script extra — Partícula
- Generar `assets/particles/ember.png` (brasa pequeña con brillo, 64×64, fondo transparente) en Blender o con Pillow.

---

## 6. Shader de la máscara (`mask.js`)

`ShaderMaterial` con:
- `uniform sampler2D uSheet` — sprite sheet.
- `uniform float uFrame` — cuadro actual (avanza con el tiempo a `MASK_FPS`).
- `uniform float uGlow` — multiplicador de brillo (1.0 normal, sube con la erupción).
- `uniform float uHeat` — 0 a 1, mezcla el color de la lava hacia amarillo-blanco (gesto de cejas).
- Calcular la UV del cuadro dentro de la cuadrícula 4×4.
- Respetar el **alfa** de la textura (`transparent: true`).
- Sin iluminación de escena: la textura ya trae su propio sombreado y brillo.

---

## 7. Gestos (`gestures.js`)

Usar los **blendshapes** de MediaPipe:

| Gesto | Blendshape | Umbral | Pausa (cooldown) |
|---|---|---|---|
| Abrir la boca (principal) | `jawOpen` | > 0.5 | 1.0 s |
| Levantar las cejas (opcional) | `browInnerUp` | > 0.5 | 1.5 s |

- Disparar el evento **solo al cruzar el umbral hacia arriba**, no en cada cuadro mientras se mantiene.
- Respetar el cooldown para evitar disparos repetidos.
- **Modo depuración:** con `?debug=1` en la URL, mostrar en pantalla los valores de los blendshapes en tiempo real (útil para calibrar umbrales).

---

## 8. Efectos (`effects.js`)

### Erupción (boca abierta)
- `uGlow` sube de 1.0 a ~2.5 y regresa en ~1 s (curva suave).
- **Partículas** (`THREE.Points` con `ember.png`, mezcla aditiva) que salen **desde el centro de la boca** (landmark del labio inferior/superior), hacia arriba y afuera, con gravedad ligera, durante ~0.8 s.
- Sonido `eruption`.
- Ligero temblor de la cámara o destello naranja en los bordes de la pantalla (opcional).

### Calor (cejas arriba, opcional)
- `uHeat` sube de 0 a 1 y regresa en ~1.5 s.
- Sonido `sizzle` (opcional).

### Ambiente
- Sonido `ambient_fire` en loop a volumen bajo, después del primer toque.

---

## 9. Inicio y UI

**La página abre directo al filtro** (0.5 pts de la rúbrica):
- Al cargar, pide permiso de cámara frontal y arranca. **Sin menús ni pantallas previas.**
- Mientras carga el modelo de MediaPipe: indicador pequeño "Cargando…".
- Si no hay rostro: mensaje discreto "Muestra tu cara a la cámara".
- Botón pequeño 🔇/🔊 en una esquina: el primer toque desbloquea el audio (los navegadores no permiten sonido sin interacción).
- Texto pequeño con la instrucción: "Abre la boca para hacer erupción 🌋".
- Si se niega el permiso de cámara: mensaje claro explicando cómo activarla.

---

## 10. Constantes (`config.js`)

```js
export const CONFIG = {
  MASK_SHEET: "assets/mask/lava_sheet.png",
  SHEET_GRID: 4,             // 4x4 cuadros
  SHEET_FRAMES: 16,
  MASK_FPS: 8,
  GESTURES: {
    jawOpen:     { threshold: 0.5, cooldown: 1.0 },
    browInnerUp: { threshold: 0.5, cooldown: 1.5 },
  },
  ERUPTION: { glowPeak: 2.5, duration: 1.0, particles: 60 },
  HEAT: { duration: 1.5 },
  AMBIENT_VOLUME: 0.25,
};
```

La ruta de la textura y la configuración de efectos deben vivir aquí para que la Actividad 3 solo cambie este archivo y `effects.js`.

---

## 11. Recursos externos y créditos

| Recurso | Fuente | Licencia |
|---|---|---|
| Malla canónica y modelo Face Landmarker | MediaPipe (Google) | Apache 2.0 |
| three.js | threejs.org | MIT |
| Sonidos | Pixabay, Freesound o Kenney | Registrar la de cada archivo |
| Textura de lava | Propia, generada en Blender | Propia |

---

## 12. README.md (requisito de la rúbrica)

1. Nombre y descripción del filtro.
2. Cómo se usa (gestos).
3. Herramientas: MediaPipe, three.js, Blender (con scripts de Python), Claude Code.
4. **Proceso de la textura:** explicar el flujo plantilla UV → material procedural → bake → sprite sheet, con imágenes de la plantilla y de algunos cuadros.
5. Enlace para probarlo (GitHub Pages).
6. Instrucciones de instalación y ejecución local, incluyendo cómo regenerar la textura con Blender.
7. Capturas (`docs/screenshots/`).
8. Créditos con licencia.
9. Autor.

---

## 13. Fases de desarrollo

Commit con mensaje claro al cerrar cada fase.

| Fase | Objetivo | Listo cuando… |
|---|---|---|
| 1. Base | Cámara frontal + MediaPipe dibujando los landmarks como puntos. Publicado en GitHub Pages | Se ven los puntos sobre la cara en el celular |
| 2. Malla | Malla canónica con `uv_template.png` como textura, alineada al rostro | La plantilla sigue la cara sin desfase al girar y gesticular |
| 3. Blender | Scripts 01–03 funcionando: plantilla UV, 16 cuadros de lava, sprite sheet | Existe `lava_sheet.png` revisada visualmente |
| 4. Máscara | Shader con la sprite sheet animada, ojos y boca transparentes | La lava se mueve sobre la cara en loop sin saltos |
| 5. Gestos | Blendshapes, umbrales, cooldown, erupción con partículas y sonido, modo debug | Abrir la boca dispara la erupción de forma confiable |
| 6. Pulido | Pruebas, ajuste de umbrales, README, capturas | Lista la entrega |

---

## 14. Pruebas

- [ ] Probar en **al menos 2 teléfonos** (idealmente un Android y un iPhone).
- [ ] La máscara cubre toda la cara y sigue giros a los lados, arriba y abajo, sin desfase.
- [ ] Probar con **varias personas**, con **lentes** y con **distinta iluminación**.
- [ ] El gesto de boca abierta funciona de forma confiable y no se dispara al hablar normal (ajustar umbral con `?debug=1`).
- [ ] Ojos y boca reales visibles a través de la máscara.
- [ ] Sin errores en consola; fluido (~30 fps).
- [ ] La página abre directo al filtro desde el enlace, en ventana de incógnito.

---

## 15. Rúbrica y cómo se cubre

| Criterio | Pts | Cómo se cubre |
|---|---|---|
| Detección y seguimiento facial | 2 | Malla de MediaPipe con 468 puntos que cubre todo el rostro y se actualiza cada cuadro |
| Diseño original de la máscara | 2 | Diseño propio de lava creado en Blender, con estilo coherente (roca + grietas) |
| Animación | 1.5 | Loop propio de 16 cuadros: lava que fluye y late |
| Reacción a gestos | 2 | Boca abierta → erupción (brillo + partículas + sonido) con umbral y pausa; cejas → calor |
| Inicio y funcionamiento | 0.5 | Abre directo al filtro, sin pasos extra |
| Repositorio GitHub | 1 | Código modular, scripts de Blender incluidos y README completo |
| Artículo LinkedIn | 1 | Proceso, retos, video y enlace (fuera del código) |

---

## 16. Tareas manuales (las hace el equipo, no Claude Code)

- [ ] Instalar Blender 4.x y confirmar que abre.
- [ ] Revisar las imágenes de la lava y pedir ajustes de diseño (colores, cantidad de grietas, brillo).
- [ ] Descargar los sonidos (fuego ambiente, erupción) y anotar sus créditos.
- [ ] Probar con varias personas, con lentes y con distinta luz.
- [ ] Grabar el video demo de 30–60 s con buena luz.
- [ ] Escribir el artículo de LinkedIn. Mencionar con honestidad que la textura se generó en Blender con scripts hechos junto con Claude Code, y que el concepto y la dirección de diseño son propios.
- [ ] Subir los 3 enlaces al formulario.

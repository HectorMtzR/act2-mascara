// Malla facial three.js: triángulos y UVs fijos de la malla canónica de MediaPipe,
// posiciones actualizadas cada cuadro con los landmarks detectados.
// La textura es una sprite sheet animada que se dibuja con un ShaderMaterial.
import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * Lee el OBJ canónico. En este archivo los índices de UV (`vt`) no coinciden con los de
 * vértice (`v`), pero cada vértice usa siempre la misma UV, así que se reordenan las UVs
 * por índice de vértice: el vértice i de la malla = landmark i de MediaPipe.
 */
function parseCanonicalObj(text) {
  const vts = [];
  const faces = [];
  let numVerts = 0;
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "v") numVerts++;
    else if (p[0] === "vt") vts.push([+p[1], +p[2]]);
    else if (p[0] === "f") faces.push(p.slice(1, 4).map((c) => c.split("/").map((n) => +n - 1)));
  }

  const uvs = new Float32Array(numVerts * 2);
  const indices = new Uint16Array(faces.length * 3);
  faces.forEach((face, f) => {
    face.forEach(([vi, ti], k) => {
      indices[f * 3 + k] = vi;
      uvs[vi * 2] = vts[ti][0];
      uvs[vi * 2 + 1] = vts[ti][1];
    });
  });
  return { numVerts, uvs, indices };
}

async function loadTexture(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uSheet;
  uniform float uFrame;   // cuadro actual; la parte decimal funde con el siguiente
  uniform float uGrid;    // cuadros por lado (4 => 4x4)
  uniform float uFrames;  // total de cuadros
  uniform float uBlend;   // 1 = fundido entre cuadros, 0 = cuadros duros
  uniform float uInset;   // margen dentro de cada cuadro (evita mezclar con el vecino)
  uniform float uGlow;    // 1 normal, sube con la erupción
  uniform float uHeat;    // 0..1, lleva la lava hacia amarillo-blanco
  uniform float uCover;   // 1 = ignora la transparencia de ojos y boca (lava debajo)
  varying vec2 vUv;

  // UV dentro de la sprite sheet. El cuadro 0 está arriba a la izquierda.
  vec2 frameUv(float frame, vec2 uv) {
    float col = mod(frame, uGrid);
    float row = floor(frame / uGrid);
    uv = clamp(uv, uInset, 1.0 - uInset);
    return vec2(col + uv.x, uGrid - 1.0 - row + uv.y) / uGrid;
  }

  void main() {
    float f0 = mod(floor(uFrame), uFrames);
    float f1 = mod(f0 + 1.0, uFrames);
    vec4 a = texture2D(uSheet, frameUv(f0, vUv));
    vec4 b = texture2D(uSheet, frameUv(f1, vUv));
    vec4 c = mix(a, b, fract(uFrame) * uBlend);

    // Máscara de lava: la roca es oscura (canal rojo bajo); las grietas, brillantes.
    float lava = smoothstep(0.08, 0.6, c.r);
    vec3 rgb = c.rgb * mix(1.0, uGlow, lava);
    // Calor: solo el núcleo de las grietas pasa a amarillo y lo más caliente a casi blanco.
    float core = smoothstep(0.25, 0.9, c.r);
    vec3 hot = mix(vec3(1.0, 0.72, 0.16), vec3(1.0, 0.96, 0.82), core) * max(1.0, uGlow);
    rgb = mix(rgb, hot, uHeat * core);

    // Toda la malla cae dentro de la isla UV; los únicos huecos son ojos y boca,
    // y debajo de ellos el bake también tiene lava.
    float alpha = max(c.a, uCover);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(rgb, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Crea la máscara y la agrega a la escena (oculta hasta que haya rostro).
 * `sheet`: { url, grid, frames }. Con grid = frames = 1 se dibuja una imagen fija.
 * Devuelve { mesh, uniforms, update(landmarks, landmarkToWorld), tick(timeSec), hide() }.
 */
export async function createMask(scene, sheet) {
  const [objText, texture] = await Promise.all([
    fetch(CONFIG.FACE_MODEL).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${CONFIG.FACE_MODEL} (${r.status})`);
      return r.text();
    }),
    loadTexture(sheet.url),
  ]);
  const { numVerts, uvs, indices } = parseCanonicalObj(objText);

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(numVerts * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const frameSize = texture.image.width / sheet.grid;
  const uniforms = {
    uSheet: { value: texture },
    uFrame: { value: 0 },
    uGrid: { value: sheet.grid },
    uFrames: { value: sheet.frames },
    uBlend: { value: CONFIG.MASK_BLEND ? 1 : 0 },
    uInset: { value: 0.5 / frameSize },
    uGlow: { value: 1 },
    uHeat: { value: 0 },
    uCover: { value: CONFIG.MASK_COVER_EYES_MOUTH ? 1 : 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    // El espejo invierte el sentido de los triángulos; se dibujan ambas caras.
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // las posiciones cambian cada cuadro
  mesh.visible = false;
  scene.add(mesh);

  function update(landmarks, landmarkToWorld) {
    // Los 10 landmarks extra del iris (468–477) no forman parte de la malla.
    for (let i = 0; i < numVerts; i++) landmarkToWorld(landmarks[i], positions, i * 3);
    geometry.attributes.position.needsUpdate = true;
    mesh.visible = true;
  }

  /** Avanza la animación; `timeSec` es el tiempo global en segundos. */
  function tick(timeSec) {
    uniforms.uFrame.value = (timeSec * CONFIG.MASK_FPS) % sheet.frames;
  }

  function hide() {
    mesh.visible = false;
  }

  return { mesh, uniforms, update, tick, hide };
}

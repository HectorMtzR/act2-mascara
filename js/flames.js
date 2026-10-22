// Corona de flamas alrededor del contorno de la cara (y sobre el pelo).
// Malla en forma de anillo construida cada cuadro desde el óvalo facial de MediaPipe;
// las flamas se dibujan con un shader de ruido animado (sin texturas).
import * as THREE from "three";
import { CONFIG } from "./config.js";

// Óvalo facial de MediaPipe (FACEMESH_FACE_OVAL), en orden alrededor de la cara.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const FOREHEAD = 10;
const CHIN = 152;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;     // compartido con la máscara: sube con la erupción
  uniform float uGlowPeak;
  uniform float uHeat;     // compartido con la máscara: gesto de cejas
  uniform float uTongues;  // número aproximado de lenguas de fuego
  uniform float uSpeed;
  varying vec2 vUv;        // x: posición alrededor del contorno (0..1), y: 0 base → 1 punta

  // Ruido de valor 3D (Inigo Quilez) + fbm.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    float erupt = clamp((uGlow - 1.0) / max(uGlowPeak - 1.0, 0.001), 0.0, 1.0);
    float v = vUv.y;
    // El contorno es un lazo cerrado: se recorre el ruido sobre un círculo (sin costura).
    float th = vUv.x * 6.2831853;
    float t = uTime * uSpeed * (1.0 + erupt);
    // Ruido estirado hacia arriba (z) para que las lenguas sean altas y delgadas.
    vec3 p = vec3(cos(th) * uTongues, sin(th) * uTongues, v * 3.4 - t);
    float n = fbm(p);
    float lick = noise(vec3(cos(th), sin(th), 0.0) * uTongues * 2.2 + vec3(0.0, 0.0, v * 4.0 - t * 1.6));

    // Forma: llena en la base, se rompe en lenguas separadas hacia la punta.
    float shape = n * 1.25 + lick * 0.45 - v * (1.45 - 0.3 * erupt) - 0.05;
    float alpha = smoothstep(0.0, 0.06, shape) * (1.0 - smoothstep(0.88, 1.0, v));
    if (alpha < 0.01) discard;

    // Color (lineal): rojo en las puntas → naranja → amarillo → blanco solo junto a la cara.
    float heat = clamp(shape * 1.5 + (1.0 - v) * (1.0 - v) * 0.35 + uHeat * 0.3 + erupt * 0.12, 0.0, 1.0);
    vec3 col = mix(vec3(0.7, 0.03, 0.0), vec3(1.0, 0.2, 0.0), smoothstep(0.0, 0.25, heat));
    col = mix(col, vec3(1.0, 0.55, 0.03), smoothstep(0.25, 0.55, heat));
    col = mix(col, vec3(1.0, 0.92, 0.65), smoothstep(0.75, 1.0, heat));

    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

/** Catmull-Rom cerrado: subdivide un lazo de puntos (x, y, z) para un contorno suave. */
function subdivideLoop(pts, sub, out) {
  const n = pts.length / 3;
  let o = 0;
  for (let k = 0; k < n; k++) {
    const i0 = ((k - 1 + n) % n) * 3;
    const i1 = k * 3;
    const i2 = ((k + 1) % n) * 3;
    const i3 = ((k + 2) % n) * 3;
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      for (let c = 0; c < 3; c++) {
        const p0 = pts[i0 + c], p1 = pts[i1 + c], p2 = pts[i2 + c], p3 = pts[i3 + c];
        out[o + c] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      }
      o += 3;
    }
  }
}

/**
 * @param scene     escena de three.js
 * @param shared    { uGlow, uHeat } — los mismos uniforms de la máscara (los mueve effects.js)
 * Devuelve { update(landmarks, landmarkToWorld), tick(timeSec), hide() }.
 */
export function createFlames(scene, shared) {
  const F = CONFIG.FLAMES;
  const N = FACE_OVAL.length * F.subdivisions; // puntos alrededor del contorno
  const R = F.rows;                            // filas de la base a la punta
  const cols = N + 1;                          // la última columna repite la primera (u = 1)

  const positions = new Float32Array(cols * (R + 1) * 3);
  const uvs = new Float32Array(cols * (R + 1) * 2);
  const indices = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j <= R; j++) {
      const k = i * (R + 1) + j;
      uvs[k * 2] = i / N;
      uvs[k * 2 + 1] = j / R;
      if (i < N && j < R) {
        const a = k, b = k + 1, c = k + R + 1, d = k + R + 2;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlow: shared.uGlow,
      uHeat: shared.uHeat,
      uGlowPeak: { value: CONFIG.ERUPTION.glowPeak },
      uTongues: { value: F.tongues },
      uSpeed: { value: F.speed },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,  // detrás de la máscara: se dibuja antes y sin profundidad
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  scene.add(mesh);

  const ring = new Float32Array(FACE_OVAL.length * 3);
  const smooth = new Float32Array(N * 3);
  const heights = new Float32Array(N);
  const tmp = new Float32Array(3);

  function update(landmarks, landmarkToWorld) {
    for (let k = 0; k < FACE_OVAL.length; k++) landmarkToWorld(landmarks[FACE_OVAL[k]], ring, k * 3);
    subdivideLoop(ring, F.subdivisions, smooth);

    // Ejes de la cara: "arriba" (barbilla → frente) y alto de la cara.
    landmarkToWorld(landmarks[FOREHEAD], tmp, 0);
    const fx = tmp[0], fy = tmp[1];
    landmarkToWorld(landmarks[CHIN], tmp, 0);
    let upX = fx - tmp[0], upY = fy - tmp[1];
    const faceH = Math.hypot(upX, upY) || 1;
    upX /= faceH;
    upY /= faceH;

    let cx = 0, cy = 0;
    for (let i = 0; i < N; i++) { cx += smooth[i * 3]; cy += smooth[i * 3 + 1]; }
    cx /= N;
    cy /= N;

    // Erupción: las flamas crecen (uGlow va de 1 a glowPeak).
    const erupt = (shared.uGlow.value - 1) / Math.max(CONFIG.ERUPTION.glowPeak - 1, 0.001);
    const grow = 1 + F.eruptionGrow * Math.min(Math.max(erupt, 0), 1);

    // Altura por punto según hacia dónde mira el borde (arriba, lados, barbilla).
    for (let i = 0; i < N; i++) {
      const prev = ((i - 1 + N) % N) * 3, next = ((i + 1) % N) * 3;
      let nx = smooth[next + 1] - smooth[prev + 1];
      let ny = -(smooth[next] - smooth[prev]);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      if (nx * (smooth[i * 3] - cx) + ny * (smooth[i * 3 + 1] - cy) < 0) { nx = -nx; ny = -ny; }
      const a = nx * upX + ny * upY; // 1 arriba, 0 lados, -1 barbilla
      const h = a >= 0
        ? F.side + (F.top - F.side) * Math.pow(a, 1.6)
        : F.side + (F.chin - F.side) * Math.min(-a * 1.4, 1);
      heights[i] = h * faceH * grow;

      // Columna de la flama: parte un poco dentro del contorno (la máscara la tapa)
      // y se curva hacia arriba conforme sube.
      let x = smooth[i * 3] - nx * F.inset * faceH;
      let y = smooth[i * 3 + 1] - ny * F.inset * faceH;
      const z = smooth[i * 3 + 2];
      const step = (heights[i] + F.inset * faceH) / R;
      for (let j = 0; j <= R; j++) {
        const k = (i * (R + 1) + j) * 3;
        positions[k] = x;
        positions[k + 1] = y;
        positions[k + 2] = z;
        const s = j / R;
        let dx = nx + (upX - nx) * F.bend * s;
        let dy = ny + (upY - ny) * F.bend * s;
        const dl = Math.hypot(dx, dy) || 1;
        x += (dx / dl) * step;
        y += (dy / dl) * step;
      }
    }
    // Cerrar el lazo: la última columna copia la primera.
    positions.copyWithin(N * (R + 1) * 3, 0, (R + 1) * 3);

    geometry.attributes.position.needsUpdate = true;
    mesh.visible = true;
  }

  function tick(timeSec) {
    material.uniforms.uTime.value = timeSec;
  }

  function hide() {
    mesh.visible = false;
  }

  return { update, tick, hide };
}

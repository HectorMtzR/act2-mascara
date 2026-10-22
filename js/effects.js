// Efectos de los gestos: erupción (boca abierta) y calor (cejas arriba).
// Para la Actividad 3 este archivo y config.js son los que cambian.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { playSound } from "./audio.js";

// Landmarks de MediaPipe usados por los efectos.
const LIP_TOP = 13;     // centro del labio superior (interior)
const LIP_BOTTOM = 14;  // centro del labio inferior (interior)
const FOREHEAD = 10;
const CHIN = 152;
const EYE_OUTER_R = 33;
const EYE_OUTER_L = 263;

/** Curva 0 → 1 → 0 en `duration` s: subida suave en `attack` (fracción) y bajada lenta. */
function envelope(t, duration, attack) {
  const x = t / duration;
  if (x <= 0 || x >= 1) return 0;
  if (x < attack) {
    const k = x / attack;
    return k * k * (3 - 2 * k);
  }
  const k = (x - attack) / (1 - attack);
  return 1 - k * k * (3 - 2 * k);
}

const rand = (min, max) => min + Math.random() * (max - min);

// ---------- Partículas (brasas) ----------

const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute float aLife;   // 1 al nacer, 0 al morir
  uniform float uPixelRatio;
  varying float vLife;
  void main() {
    vLife = aLife;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const particleFragment = /* glsl */ `
  uniform sampler2D uTex;
  varying float vLife;
  void main() {
    if (vLife <= 0.0) discard;
    vec4 t = texture2D(uTex, gl_PointCoord);
    // Nace amarillo-blanco y se enfría a rojo.
    vec3 tint = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.9, 0.55), vLife);
    float a = t.a * smoothstep(0.0, 0.3, vLife);
    // Más intensa que la lava encendida para que destaque sobre la máscara.
    gl_FragColor = vec4(t.rgb * tint * 1.6, a);
    #include <colorspace_fragment>
  }
`;

function createParticles(scene, renderer, texture, max) {
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const life = new Float32Array(max);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aLife", new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: texture },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false, // siempre delante de la máscara
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  // Estado por partícula (JS); los atributos se copian al GPU cada cuadro.
  const vel = new Float32Array(max * 2);
  const age = new Float32Array(max);
  const maxAge = new Float32Array(max);
  let next = 0;

  function spawn(x, y, vx, vy, s, lifetime) {
    const i = next;
    next = (next + 1) % max;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = 0;
    vel[i * 2] = vx;
    vel[i * 2 + 1] = vy;
    size[i] = s;
    age[i] = 0;
    maxAge[i] = lifetime;
    life[i] = 1;
  }

  function update(dt, gravity) {
    let alive = false;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      if (age[i] >= maxAge[i]) {
        life[i] = 0;
        continue;
      }
      alive = true;
      vel[i * 2 + 1] -= gravity * dt;
      pos[i * 3] += vel[i * 2] * dt;
      pos[i * 3 + 1] += vel[i * 2 + 1] * dt;
      life[i] = 1 - age[i] / maxAge[i];
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aLife.needsUpdate = true;
    points.visible = alive;
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  return { spawn, update };
}

// ---------- Efectos ----------

/**
 * @param scene, renderer  de three.js
 * @param mask   resultado de createMask (usa mask.uniforms.uGlow / uHeat)
 * @param flash  elemento HTML del destello en los bordes (opcional)
 */
export async function createEffects({ scene, renderer, mask, flash }) {
  const texture = await new THREE.TextureLoader().loadAsync(CONFIG.EMBER_SPRITE);
  texture.colorSpace = THREE.SRGBColorSpace;

  const E = CONFIG.ERUPTION;
  const particles = createParticles(scene, renderer, texture, E.particles * 2);

  let eruptionStart = -Infinity;
  let heatStart = -Infinity;
  let spawnDebt = 0;
  let lastTime = null;
  let lastFlash = -1;

  // Geometría de la cara en el mundo (se actualiza cuando hay rostro).
  const face = { mouthX: 0, mouthY: 0, upX: 0, upY: 1, scale: 100, valid: false };
  const tmp = new Float32Array(3);
  const world = (lm, toWorld) => (toWorld(lm, tmp, 0), [tmp[0], tmp[1]]);

  function readFace(landmarks, toWorld) {
    const [tx, ty] = world(landmarks[LIP_TOP], toWorld);
    const [bx, by] = world(landmarks[LIP_BOTTOM], toWorld);
    const [fx, fy] = world(landmarks[FOREHEAD], toWorld);
    const [cx, cy] = world(landmarks[CHIN], toWorld);
    const [rx, ry] = world(landmarks[EYE_OUTER_R], toWorld);
    const [lx, ly] = world(landmarks[EYE_OUTER_L], toWorld);
    face.mouthX = (tx + bx) / 2;
    face.mouthY = (ty + by) / 2;
    const ux = fx - cx;
    const uy = fy - cy;
    const len = Math.hypot(ux, uy) || 1;
    face.upX = ux / len;
    face.upY = uy / len;
    face.scale = Math.hypot(lx - rx, ly - ry);
    face.valid = true;
  }

  function emitEmbers(count) {
    const s = face.scale;
    for (let k = 0; k < count; k++) {
      // Dirección: "arriba de la cara" girada al azar hacia los lados.
      const a = rand(-E.spread, E.spread);
      const dx = face.upX * Math.cos(a) - face.upY * Math.sin(a);
      const dy = face.upX * Math.sin(a) + face.upY * Math.cos(a);
      const speed = rand(...E.speed) * s;
      particles.spawn(
        face.mouthX + rand(-0.08, 0.08) * s,
        face.mouthY + rand(-0.04, 0.04) * s,
        dx * speed,
        dy * speed,
        rand(...E.size) * s,
        rand(...E.life),
      );
    }
  }

  /** Dispara el efecto asociado a un gesto (nombre del blendshape). */
  function trigger(gesture, timeSec) {
    if (gesture === "jawOpen") {
      eruptionStart = timeSec;
      spawnDebt = 0;
      playSound("eruption");
    } else if (gesture === "browInnerUp") {
      heatStart = timeSec;
      playSound("sizzle");
    }
  }

  /** Avanza los efectos. `landmarks` puede ser null si no hay rostro. */
  function update(timeSec, landmarks, toWorld) {
    const dt = lastTime === null ? 0 : Math.min(timeSec - lastTime, 0.1);
    lastTime = timeSec;
    if (landmarks) readFace(landmarks, toWorld);

    // Erupción: brillo de la lava, brasas y destello.
    const te = timeSec - eruptionStart;
    const glow = envelope(te, E.duration, 0.15);
    mask.uniforms.uGlow.value = 1 + (E.glowPeak - 1) * glow;

    if (te >= 0 && te < E.spawnTime && face.valid) {
      spawnDebt += (E.particles / E.spawnTime) * dt;
      const n = Math.floor(spawnDebt);
      spawnDebt -= n;
      emitEmbers(n);
    }
    particles.update(dt, E.gravity * face.scale);

    if (flash) {
      const f = Math.round(envelope(te, E.duration * 0.8, 0.1) * E.flash * 100) / 100;
      if (f !== lastFlash) {
        flash.style.opacity = f;
        lastFlash = f;
      }
    }

    // Calor: la lava se pone amarillo-blanca.
    mask.uniforms.uHeat.value = envelope(timeSec - heatStart, CONFIG.HEAT.duration, 0.2);
  }

  return { trigger, update };
}

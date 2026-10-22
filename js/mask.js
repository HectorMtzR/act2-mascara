// Malla facial three.js: triángulos y UVs fijos de la malla canónica de MediaPipe,
// posiciones actualizadas cada cuadro con los landmarks detectados.
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

/**
 * Crea la máscara y la agrega a la escena (oculta hasta que haya rostro).
 * Devuelve { mesh, update(landmarks, landmarkToWorld), hide() }.
 */
export async function createMask(scene, textureUrl) {
  const [objText, texture] = await Promise.all([
    fetch(CONFIG.FACE_MODEL).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${CONFIG.FACE_MODEL} (${r.status})`);
      return r.text();
    }),
    loadTexture(textureUrl),
  ]);
  const { numVerts, uvs, indices } = parseCanonicalObj(objText);

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(numVerts * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const material = new THREE.MeshBasicMaterial({
    map: texture,
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

  function hide() {
    mesh.visible = false;
  }

  return { mesh, update, hide };
}

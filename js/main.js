// Arranque: cámara frontal, MediaPipe y render loop.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { createFaceTracker } from "./face.js";
import { createScene } from "./scene.js";
import { createMask } from "./mask.js";
import { unlockAudio, setMuted, isMuted } from "./audio.js";

const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
const NUM_MESH_POINTS = 478; // 468 de la cara + 10 del iris

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ui = {
  loading: document.getElementById("loading"),
  noFace: document.getElementById("no-face"),
  error: document.getElementById("error"),
  hint: document.getElementById("hint"),
  sound: document.getElementById("sound"),
  debug: document.getElementById("debug"),
};

function show(el, visible) {
  el.hidden = !visible;
}

function showError(title, detail) {
  show(ui.loading, false);
  show(ui.noFace, false);
  show(ui.hint, false);
  ui.error.innerHTML = `<strong>${title}</strong><p>${detail}</p>`;
  show(ui.error, true);
}

// ---------- Cámara ----------
async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("insecure"), { name: "InsecureContext" });
  }
  const cam = CONFIG.CAMERA;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: cam.FACING_MODE,
      width: { ideal: cam.IDEAL_WIDTH },
      height: { ideal: cam.IDEAL_HEIGHT },
    },
  });
  video.srcObject = stream;
  await video.play();
}

function explainCameraError(err) {
  switch (err.name) {
    case "NotAllowedError":
    case "SecurityError":
      showError(
        "Necesitamos tu cámara 📷",
        "Se negó el permiso para usar la cámara. Toca el ícono de candado o de cámara en la barra " +
          "de direcciones, permite el acceso a la cámara y recarga la página. En iPhone: " +
          "Ajustes → Safari → Cámara → Permitir."
      );
      break;
    case "NotFoundError":
    case "OverconstrainedError":
      showError("No encontramos una cámara", "Este dispositivo no tiene cámara frontal disponible.");
      break;
    case "NotReadableError":
      showError("La cámara está ocupada", "Cierra otras apps que usen la cámara y recarga la página.");
      break;
    case "InsecureContext":
      showError("Se necesita HTTPS", "Abre el filtro desde su enlace https:// para poder usar la cámara.");
      break;
    default:
      showError("No se pudo iniciar la cámara", err.message || String(err));
  }
}

// ---------- Puntos de landmarks (solo con ?debug=1) ----------
function createLandmarkPoints() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(NUM_MESH_POINTS * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: CONFIG.DEBUG_POINT_COLOR,
    size: CONFIG.DEBUG_POINT_SIZE,
    sizeAttenuation: false,
    depthTest: false, // siempre encima de la máscara
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.visible = false;
  return points;
}

function updateLandmarkPoints(points, landmarks, toWorld) {
  const attr = points.geometry.attributes.position;
  const n = Math.min(landmarks.length, NUM_MESH_POINTS);
  for (let i = 0; i < n; i++) toWorld(landmarks[i], attr.array, i * 3);
  points.geometry.setDrawRange(0, n);
  attr.needsUpdate = true;
}

// ---------- Botón de sonido ----------
function setupSoundButton() {
  const refresh = () => {
    ui.sound.textContent = isMuted() ? "🔇" : "🔊";
    ui.sound.setAttribute("aria-label", isMuted() ? "Activar sonido" : "Silenciar");
  };
  ui.sound.addEventListener("click", async () => {
    await unlockAudio();
    setMuted(!isMuted());
    refresh();
  });
  refresh();
}

// ---------- Depuración ----------
function createDebugPanel(delegate) {
  if (!DEBUG) return () => {};
  show(ui.debug, true);
  let frames = 0;
  let fps = 0;
  let last = performance.now();
  return (face) => {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      fps = (frames * 1000) / (now - last);
      frames = 0;
      last = now;
    }
    ui.debug.textContent =
      `fps ${fps.toFixed(0)} · ${delegate}\n` +
      `video ${video.videoWidth}×${video.videoHeight}\n` +
      `cara ${face ? `sí (${face.landmarks.length} pts)` : "no"}`;
  };
}

// ---------- Arranque ----------
async function main() {
  setupSoundButton();

  // La cámara, el modelo y la malla se cargan en paralelo.
  const view = createScene(canvas, video);
  const trackerPromise = createFaceTracker();
  const maskPromise = createMask(view.scene, CONFIG.UV_TEMPLATE);
  // Los errores se manejan abajo, después de la cámara.
  trackerPromise.catch(() => {});
  maskPromise.catch(() => {});
  try {
    await startCamera();
  } catch (err) {
    console.error("[main] cámara:", err);
    explainCameraError(err);
    return;
  }

  let tracker;
  try {
    tracker = await trackerPromise;
  } catch (err) {
    console.error("[main] MediaPipe:", err);
    showError("No se pudo cargar el detector facial", "Revisa tu conexión a internet y recarga la página.");
    return;
  }

  let mask;
  try {
    mask = await maskPromise;
  } catch (err) {
    console.error("[main] máscara:", err);
    showError("No se pudo cargar la máscara", "Recarga la página para intentarlo de nuevo.");
    return;
  }
  show(ui.loading, false);
  show(ui.hint, true);
  view.resize(); // el video ya tiene tamaño real

  const points = DEBUG ? createLandmarkPoints() : null;
  if (points) view.scene.add(points);
  const updateDebug = createDebugPanel(tracker.delegate);

  function frame(timeMs) {
    const face = tracker.detect(video, timeMs);
    if (face) {
      mask.update(face.landmarks, view.landmarkToWorld);
      if (points) updateLandmarkPoints(points, face.landmarks, view.landmarkToWorld);
    } else {
      mask.hide();
    }
    if (points) points.visible = !!face;
    show(ui.noFace, !face);
    updateDebug(face);
    view.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();

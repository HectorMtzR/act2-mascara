// MediaPipe Face Landmarker: carga del modelo y detección por cuadro.
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { CONFIG } from "./config.js";

async function createLandmarker(vision, delegate) {
  const mp = CONFIG.MEDIAPIPE;
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mp.MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: mp.NUM_FACES,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: mp.MIN_DETECTION_CONFIDENCE,
    minTrackingConfidence: mp.MIN_TRACKING_CONFIDENCE,
  });
}

/**
 * Crea el detector. Intenta con GPU y, si falla (p. ej. algunos iPhone), usa CPU.
 * Devuelve { delegate, detect(video, timeMs) }.
 * detect() regresa null si no hay rostro o si el video no tiene un cuadro nuevo.
 */
export async function createFaceTracker() {
  const vision = await FilesetResolver.forVisionTasks(CONFIG.MEDIAPIPE.WASM_URL);

  let landmarker;
  let delegate = "GPU";
  try {
    landmarker = await createLandmarker(vision, "GPU");
  } catch (err) {
    console.warn("[face] GPU no disponible, usando CPU:", err);
    delegate = "CPU";
    landmarker = await createLandmarker(vision, "CPU");
  }

  let lastVideoTime = -1;
  let lastTimestamp = 0;
  let lastResult = null;

  function detect(video, timeMs) {
    if (video.readyState < 2) return null;
    // Solo procesar cuando el video tiene un cuadro nuevo.
    if (video.currentTime === lastVideoTime) return lastResult;
    lastVideoTime = video.currentTime;

    // MediaPipe exige marcas de tiempo estrictamente crecientes.
    const ts = Math.max(timeMs, lastTimestamp + 1);
    lastTimestamp = ts;

    const res = landmarker.detectForVideo(video, ts);
    if (!res.faceLandmarks || res.faceLandmarks.length === 0) {
      lastResult = null;
      return null;
    }

    // Blendshapes como objeto { nombre: valor } para acceso directo.
    const blendshapes = {};
    const cats = res.faceBlendshapes?.[0]?.categories ?? [];
    for (const c of cats) blendshapes[c.categoryName] = c.score;

    lastResult = { landmarks: res.faceLandmarks[0], blendshapes };
    return lastResult;
  }

  return { delegate, detect };
}

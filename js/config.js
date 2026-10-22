// Todas las constantes ajustables del filtro.
// Para la Actividad 3 basta con cambiar este archivo (textura, gestos, efectos) y effects.js.

const MEDIAPIPE_VERSION = "0.10.14";

export const CONFIG = {
  // --- Malla facial ---
  FACE_MODEL: "assets/face/canonical_face_model.obj",
  UV_TEMPLATE: "assets/face/uv_template.png",

  // --- Máscara ---
  MASK_SHEET: "assets/mask/lava_sheet.png",
  SHEET_GRID: 4,             // 4x4 cuadros
  SHEET_FRAMES: 16,
  MASK_FPS: 8,
  MASK_BLEND: true,          // funde cada cuadro con el siguiente (flujo suave a 8 fps)

  // --- Gestos (blendshapes de MediaPipe) ---
  GESTURES: {
    jawOpen:     { threshold: 0.5, cooldown: 1.0 },
    browInnerUp: { threshold: 0.5, cooldown: 1.5 },
  },

  // --- Efectos ---
  ERUPTION: { glowPeak: 2.5, duration: 1.0, particles: 60 },
  HEAT: { duration: 1.5 },
  AMBIENT_VOLUME: 0.25,

  // --- MediaPipe Face Landmarker ---
  MEDIAPIPE: {
    WASM_URL: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    MODEL_URL:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    NUM_FACES: 1,
    MIN_DETECTION_CONFIDENCE: 0.5,
    MIN_TRACKING_CONFIDENCE: 0.5,
  },

  // --- Cámara ---
  CAMERA: {
    FACING_MODE: "user",
    IDEAL_WIDTH: 1280,
    IDEAL_HEIGHT: 720,
    MIRROR: true,            // vista tipo selfie
  },

  // --- Depuración (?debug=1) ---
  DEBUG_POINT_SIZE: 3,       // px, puntos de landmarks (Fase 1)
  DEBUG_POINT_COLOR: 0x00ff88,
};

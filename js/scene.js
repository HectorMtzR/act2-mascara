// Escena three.js: renderer transparente sobre el video, cámara ortográfica en píxeles
// y conversión landmark -> mundo con el mismo recorte que `object-fit: cover` del video.
import * as THREE from "three";
import { CONFIG } from "./config.js";

export function createScene(canvas, video) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Unidades = píxeles CSS, origen en el centro de la pantalla.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  camera.position.z = 10000;

  // Tamaño con que se dibuja el video tras `object-fit: cover` (puede exceder la pantalla).
  const layout = { width: 1, height: 1, videoW: 1, videoH: 1 };
  const mirror = CONFIG.CAMERA.MIRROR ? -1 : 1;

  function resize() {
    const w = video.clientWidth || window.innerWidth;
    const h = video.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);

    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();

    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const s = Math.max(w / vw, h / vh); // escala de `cover`
    layout.videoW = vw * s;
    layout.videoH = vh * s;
    layout.width = w;
    layout.height = h;
  }

  /**
   * Convierte un landmark normalizado de MediaPipe a coordenadas de mundo.
   * El recorte de `cover` es centrado, así que basta con escalar al tamaño dibujado.
   * Escribe en `out` (array plano) a partir de `offset`.
   */
  function landmarkToWorld(lm, out, offset) {
    out[offset]     = mirror * (lm.x - 0.5) * layout.videoW;
    out[offset + 1] = -(lm.y - 0.5) * layout.videoH;
    out[offset + 2] = -lm.z * layout.videoW;
  }

  function render() {
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize);
  video.addEventListener("loadedmetadata", resize);
  video.addEventListener("resize", resize); // cambia al rotar el teléfono
  resize();

  return { renderer, scene, camera, layout, resize, landmarkToWorld, render };
}

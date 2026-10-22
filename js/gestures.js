// Detección de gestos a partir de los blendshapes de MediaPipe.
// Un gesto se dispara solo al cruzar su umbral hacia arriba y respetando su pausa (cooldown).
import { CONFIG } from "./config.js";

/**
 * @param defs  { nombreBlendshape: { threshold, cooldown } }
 * @returns { update(blendshapes, timeSec) -> string[] disparados, reset(), state }
 */
export function createGestureDetector(defs = CONFIG.GESTURES, release = CONFIG.GESTURE_RELEASE) {
  const state = {};
  for (const name of Object.keys(defs)) {
    state[name] = { value: 0, active: false, lastFired: -Infinity, count: 0 };
  }

  function update(blendshapes, timeSec) {
    const fired = [];
    for (const [name, { threshold, cooldown }] of Object.entries(defs)) {
      const s = state[name];
      const v = blendshapes[name] ?? 0;
      s.value = v;

      if (!s.active && v > threshold) {
        // Cruce hacia arriba. Si cae dentro de la pausa, se ignora (hay que volver a bajar).
        s.active = true;
        if (timeSec - s.lastFired >= cooldown) {
          s.lastFired = timeSec;
          s.count++;
          fired.push(name);
        }
      } else if (s.active && v < threshold * release) {
        s.active = false;
      }
    }
    return fired;
  }

  /** Sin rostro: se olvida el estado para no disparar al reaparecer con el gesto a medias. */
  function reset() {
    for (const s of Object.values(state)) {
      s.value = 0;
      s.active = true;
    }
  }

  return { update, reset, state };
}

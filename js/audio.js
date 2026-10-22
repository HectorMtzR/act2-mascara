// Sonidos con Web Audio API.
// Fase 1: solo desbloqueo por toque y estado de silencio. Los sonidos se agregan en la Fase 5.

let ctx = null;
let master = null;
let muted = true;

/** Debe llamarse dentro de un gesto del usuario (los navegadores bloquean el audio antes). */
export async function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") await ctx.resume();
  return true;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 1;
}

export function isMuted() {
  return muted;
}

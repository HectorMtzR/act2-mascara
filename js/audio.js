// Sonidos con Web Audio API.
// Si CONFIG.SOUNDS trae la ruta de un archivo, se usa ese archivo; si no (o si falla),
// se usa un sonido sintetizado aquí mismo, para que el filtro suene sin assets.
import { CONFIG } from "./config.js";

let ctx = null;
let master = null;
let muted = true;
let ambient = null;
const files = {}; // nombre -> AudioBuffer cargado

// ---------- Desbloqueo y volumen ----------

/** Debe llamarse dentro de un gesto del usuario (los navegadores bloquean el audio antes). */
export async function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
    loadFiles();
  }
  if (ctx.state === "suspended") await ctx.resume();
  return true;
}

export function isUnlocked() {
  return !!ctx;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
}

export function isMuted() {
  return muted;
}

async function loadFiles() {
  for (const [name, url] of Object.entries(CONFIG.SOUNDS)) {
    if (!url) continue;
    try {
      const data = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.arrayBuffer();
      });
      files[name] = await ctx.decodeAudioData(data);
      if (name === "ambient_fire" && ambient) restartAmbient();
    } catch (err) {
      console.warn(`[audio] no se pudo cargar ${url}; se usa el sonido sintetizado`, err);
    }
  }
}

// ---------- Reproducción ----------

function out(volume) {
  const g = ctx.createGain();
  g.gain.value = volume;
  g.connect(master);
  return g;
}

function playBuffer(buffer, volume, loop = false) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.connect(out(volume));
  src.start();
  return src;
}

/** Reproduce un efecto por nombre ("eruption", "sizzle"…). */
export function playSound(name) {
  if (!ctx || muted) return;
  if (files[name]) playBuffer(files[name], CONFIG.EFFECT_VOLUME);
  else SYNTH[name]?.(ctx.currentTime, out(CONFIG.EFFECT_VOLUME));
}

/** Fuego ambiente en loop a volumen bajo (se llama tras el primer toque). */
export function startAmbient() {
  if (!ctx || ambient) return;
  const buffer = files.ambient_fire ?? fireLoopBuffer();
  ambient = playBuffer(buffer, CONFIG.AMBIENT_VOLUME, true);
}

function restartAmbient() {
  ambient.stop();
  ambient = null;
  startAmbient();
}

// ---------- Sonidos sintetizados ----------

let noiseCache = null;
function whiteNoise() {
  if (!noiseCache) {
    noiseCache = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseCache.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseCache;
}

/** Fuego: ruido grave (rumor) + chasquidos aleatorios; extremos fundidos para un loop limpio. */
function fireLoopBuffer() {
  const sr = ctx.sampleRate;
  const fade = Math.floor(sr * 0.25);
  const n = sr * 4 + fade;
  const d = new Float32Array(n);
  let brown = 0;
  for (let i = 0; i < n; i++) {
    brown = (brown + 0.02 * (Math.random() * 2 - 1)) * 0.995;
    d[i] = brown * 2.2;
  }
  for (let k = 0; k < 4 * 14; k++) {
    const at = Math.floor(Math.random() * (n - sr * 0.02));
    const len = Math.floor(sr * (0.002 + Math.random() * 0.012));
    const amp = 0.15 + Math.random() * 0.5;
    for (let i = 0; i < len; i++) d[at + i] += amp * (Math.random() * 2 - 1) * Math.exp(-6 * i / len);
  }
  const buffer = ctx.createBuffer(1, n - fade, sr);
  const outData = buffer.getChannelData(0);
  for (let i = 0; i < n - fade; i++) outData[i] = d[i];
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    outData[i] = d[i] * t + d[n - fade + i] * (1 - t);
  }
  return buffer;
}

const SYNTH = {
  /** Rugido: ruido con filtro que se abre y se cierra + golpe grave. */
  eruption(t, dest) {
    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoise();
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    lp.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    noise.connect(lp).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + 1.6);

    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(95, t);
    boom.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.9, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    boom.connect(bg).connect(dest);
    boom.start(t);
    boom.stop(t + 0.75);
  },

  /** Siseo: ruido agudo con un temblor rápido de volumen. */
  sizzle(t, dest) {
    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoise();
    noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 0.12;
    lfo.connect(depth).connect(g.gain);
    noise.connect(hp).connect(g).connect(dest);
    noise.start(t);
    lfo.start(t);
    noise.stop(t + 1.4);
    lfo.stop(t + 1.4);
  },
};

import { Rng } from '@forge/core';

/**
 * Synthétiseur d'effets sonores rétro dans l'esprit de sfxr (DrPetter, 2007), réécrit en TypeScript.
 *
 * Même architecture que l'original : oscillateur à période exprimée en échantillons suréchantillonnés
 * (×8), glissando multiplicatif, arpège unique, vibrato, enveloppe attaque / maintien (+ punch) /
 * déclin, relance périodique (« repeat »), filtre passe-bas résonant à deux pôles, passe-haut à un
 * pôle et phaser à tampon circulaire. Les paramètres sont exprimés en unités physiques (Hz,
 * secondes, octaves/s) plutôt qu'en valeurs normalisées, pour être faciles à écrire par une IA.
 */

export type SfxrWave = 'square' | 'sawtooth' | 'sine' | 'triangle' | 'noise';

export interface SfxrParams {
  wave: SfxrWave;
  /** Durée de montée de l'enveloppe (s). */
  attack: number;
  /** Durée de maintien (s). */
  sustain: number;
  /** Surplus de volume au début du maintien (0–1). */
  punch: number;
  /** Durée du déclin final (s). */
  decay: number;
  /** Fréquence de départ (Hz). */
  baseFrequency: number;
  /** Fréquence plancher (Hz) : le son s'arrête si un glissando descend en dessous (0 = aucune). */
  frequencyLimit: number;
  /** Glissando de hauteur (octaves/s, négatif = descend). */
  slide: number;
  /** Accélération du glissando (octaves/s²). */
  deltaSlide: number;
  /** Profondeur du vibrato (demi-tons). */
  vibratoDepth: number;
  /** Vitesse du vibrato (Hz). */
  vibratoSpeed: number;
  /** Saut de hauteur unique (demi-tons, 0 = aucun). */
  arpeggio: number;
  /** Délai avant le saut d'arpège (s). */
  arpeggioDelay: number;
  /** Rapport cyclique du carré (0,5 = carré plein, plus petit = plus nasillard). */
  duty: number;
  /** Variation du rapport cyclique (par seconde). */
  dutySweep: number;
  /** Intervalle de relance de la hauteur / de l'arpège (s, 0 = aucune relance). */
  repeatInterval: number;
  /** Décalage du phaser (-1 à 1, 0 = pas de phaser). */
  phaserOffset: number;
  /** Balayage du phaser (-1 à 1). */
  phaserSweep: number;
  /** Coupure du passe-bas (Hz, ≥ 20000 = désactivé). */
  lowPassCutoff: number;
  /** Balayage du passe-bas (octaves/s). */
  lowPassSweep: number;
  /** Résonance du passe-bas (0–1). */
  lowPassResonance: number;
  /** Coupure du passe-haut (Hz, 0 = désactivé). */
  highPassCutoff: number;
  /** Balayage du passe-haut (octaves/s). */
  highPassSweep: number;
  /** Volume final (0–1). */
  volume: number;
}

export const DEFAULT_SFXR_PARAMS: SfxrParams = {
  wave: 'square',
  attack: 0,
  sustain: 0.08,
  punch: 0,
  decay: 0.2,
  baseFrequency: 440,
  frequencyLimit: 0,
  slide: 0,
  deltaSlide: 0,
  vibratoDepth: 0,
  vibratoSpeed: 0,
  arpeggio: 0,
  arpeggioDelay: 0,
  duty: 0.5,
  dutySweep: 0,
  repeatInterval: 0,
  phaserOffset: 0,
  phaserSweep: 0,
  lowPassCutoff: 22050,
  lowPassSweep: 0,
  lowPassResonance: 0,
  highPassCutoff: 0,
  highPassSweep: 0,
  volume: 1,
};

export interface SfxrOptions {
  sampleRate?: number;
  /** Durée maximale rendue (s). */
  maxSeconds?: number;
  /** Graine du bruit (forme d'onde `noise`). */
  seed?: number;
}

const OVERSAMPLE = 8;
const PHASER_SIZE = 1024;
const NOISE_SIZE = 32;
const LOWPASS_OFF_HZ = 20000;

/** État de hauteur, réinitialisé à chaque relance (« repeat »). */
interface PitchState {
  period: number;
  slide: number;
  duty: number;
  arpTime: number;
  arpLimit: number;
}

/** Rend l'effet en échantillons mono flottants (amplitude brute, non normalisée). */
export function synthesizeSfxr(p: SfxrParams, options: SfxrOptions = {}): Float32Array {
  const sr = options.sampleRate ?? 44100;
  const osr = sr * OVERSAMPLE;
  const rng = new Rng(options.seed ?? 1);
  const envLength = [p.attack, p.sustain, p.decay].map((t) => Math.max(1, Math.round(t * sr)));
  const maxSamples = Math.floor((options.maxSeconds ?? 3) * sr);
  const total = Math.min(maxSamples, envLength[0] + envLength[1] + envLength[2] + 3);
  const out = new Float32Array(total);

  const minFreq = p.frequencyLimit > 0 ? p.frequencyLimit : 5;
  const maxPeriod = osr / minFreq;
  const pitch: PitchState = { period: 0, slide: 0, duty: 0.5, arpTime: 0, arpLimit: 0 };
  const resetPitch = () => {
    pitch.period = osr / Math.max(minFreq, p.baseFrequency);
    pitch.slide = p.slide;
    pitch.duty = clamp(p.duty, 0.02, 0.5);
    pitch.arpTime = 0;
    pitch.arpLimit = p.arpeggio !== 0 ? Math.max(1, Math.round(p.arpeggioDelay * sr)) : 0;
  };
  resetPitch();
  const arpFactor = Math.pow(2, -p.arpeggio / 12);
  const repeatLimit = p.repeatInterval > 0 ? Math.max(32, Math.round(p.repeatInterval * sr)) : 0;
  let repeatTime = 0;

  // Filtre passe-bas résonant (ressort amorti) : w ≈ ω² par échantillon suréchantillonné.
  const lowPassOn = p.lowPassCutoff < LOWPASS_OFF_HZ;
  let lpW = Math.min(0.1, Math.pow((2 * Math.PI * p.lowPassCutoff) / osr, 2));
  const lpSweep = Math.pow(2, (2 * p.lowPassSweep) / osr);
  const lpDamp = Math.min(0.8, (5 / (1 + p.lowPassResonance * p.lowPassResonance * 20)) * (0.01 + lpW));
  let lpPos = 0;
  let lpVel = 0;
  // Passe-haut à un pôle : k ≈ ωc par échantillon suréchantillonné.
  let hpK = Math.min(0.1, (2 * Math.PI * p.highPassCutoff) / osr);
  const hpSweep = Math.pow(2, p.highPassSweep / sr);
  let hpOut = 0;

  // Phaser : ligne à retard de 1024 échantillons suréchantillonnés (≈ 2,9 ms).
  const phaser = new Float32Array(PHASER_SIZE);
  let phaserPos = 0;
  let phaserOffset = Math.sign(p.phaserOffset) * p.phaserOffset * p.phaserOffset * (PHASER_SIZE - 4);
  const phaserStep = Math.sign(p.phaserSweep) * p.phaserSweep * p.phaserSweep;

  const noise = new Float32Array(NOISE_SIZE);
  const refillNoise = () => {
    for (let i = 0; i < NOISE_SIZE; i++) noise[i] = rng.float(-1, 1);
  };
  refillNoise();

  const vibratoStep = (2 * Math.PI * p.vibratoSpeed) / sr;
  const vibratoAmount = p.vibratoDepth / 12;
  let vibratoPhase = 0;
  let phase = 0;
  let envStage = 0;
  let envTime = 0;
  let written = 0;

  for (let i = 0; i < total; i++) {
    if (repeatLimit && ++repeatTime >= repeatLimit) {
      repeatTime = 0;
      resetPitch();
    }
    if (pitch.arpLimit && ++pitch.arpTime >= pitch.arpLimit) {
      pitch.arpLimit = 0;
      pitch.period *= arpFactor;
    }
    pitch.slide += p.deltaSlide / sr;
    pitch.period *= Math.pow(2, -pitch.slide / sr);
    if (pitch.period > maxPeriod) {
      pitch.period = maxPeriod;
      if (p.frequencyLimit > 0) break;
    }
    let period = pitch.period;
    if (vibratoAmount > 0) {
      vibratoPhase += vibratoStep;
      period *= Math.pow(2, -Math.sin(vibratoPhase) * vibratoAmount);
    }
    period = Math.max(OVERSAMPLE, period);
    pitch.duty = clamp(pitch.duty + p.dutySweep / sr, 0.02, 0.5);

    // Enveloppe de volume.
    if (++envTime > envLength[envStage]) {
      envTime = 0;
      if (++envStage === 3) break;
    }
    const t = envTime / envLength[envStage];
    const env = envStage === 0 ? t : envStage === 1 ? 1 + (1 - t) * 2 * p.punch : 1 - t;

    phaserOffset += phaserStep;
    const phaserDelay = Math.min(PHASER_SIZE - 1, Math.abs(Math.trunc(phaserOffset)));
    if (hpSweep !== 1) hpK = clamp(hpK * hpSweep, 0.00001, 0.1);

    let acc = 0;
    for (let s = 0; s < OVERSAMPLE; s++) {
      phase += 1;
      if (phase >= period) {
        phase %= period;
        if (p.wave === 'noise') refillNoise();
      }
      const x = oscillator(p.wave, phase / period, pitch.duty, noise);
      // Passe-bas résonant.
      const prev = lpPos;
      if (lowPassOn) {
        lpW = clamp(lpW * lpSweep, 0, 0.1);
        lpVel += (x - lpPos) * lpW;
        lpVel -= lpVel * lpDamp;
      } else {
        lpPos = x;
        lpVel = 0;
      }
      lpPos += lpVel;
      // Passe-haut.
      hpOut += lpPos - prev;
      hpOut -= hpOut * hpK;
      // Phaser.
      phaser[phaserPos] = hpOut;
      const y = hpOut + phaser[(phaserPos - phaserDelay + PHASER_SIZE) % PHASER_SIZE];
      phaserPos = (phaserPos + 1) % PHASER_SIZE;
      acc += y * env;
    }
    out[i] = acc / OVERSAMPLE;
    written = i + 1;
  }

  const result = out.subarray(0, written);
  fadeTail(result, Math.round(sr * 0.003));
  return result;
}

/** Forme d'onde de base pour une phase normalisée `fp` dans [0, 1). */
function oscillator(wave: SfxrWave, fp: number, duty: number, noise: Float32Array): number {
  switch (wave) {
    case 'square':
      return fp < duty ? 0.5 : -0.5;
    case 'sawtooth':
      return 1 - fp * 2;
    case 'sine':
      return Math.sin(fp * 2 * Math.PI);
    case 'triangle':
      return fp < 0.5 ? 4 * fp - 1 : 3 - 4 * fp;
    case 'noise':
      return noise[Math.min(NOISE_SIZE - 1, Math.floor(fp * NOISE_SIZE))];
  }
}

/** Petit fondu linéaire sur les derniers échantillons (évite le clic d'un arrêt brutal). */
function fadeTail(samples: Float32Array, length: number): void {
  const n = Math.min(length, samples.length);
  for (let i = 0; i < n; i++) samples[samples.length - 1 - i] *= i / n;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

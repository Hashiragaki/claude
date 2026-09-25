import type { DrumHit } from './notes';
import type { Instrument } from './music-spec';

/**
 * Synthèse hors-ligne des instruments de musique (pur TypeScript, sans WebAudio).
 *
 * Chaque voix s'écrit par addition dans un tampon mono ; avec `wrap`, les échantillons qui dépassent
 * la fin du tampon reviennent au début (queues de relâchement d'une boucle sans couture).
 */

export type PitchedInstrument = Exclude<Instrument, 'drums'>;

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Bruit blanc déterministe (xorshift32) dans [-1, 1). */
export class NoiseSource {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 2147483648 - 1;
  }
}

/** Enveloppe ADSR : durées en secondes, `sustain` = niveau de maintien (0–1). */
export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** Niveau de l'enveloppe à `t` secondes pour une note tenue `gate` secondes. */
export function adsrLevel(env: Adsr, t: number, gate: number): number {
  const held = (x: number): number => {
    if (x < env.attack) return x / env.attack;
    const d = x - env.attack;
    if (d >= env.decay) return env.sustain;
    const k = 1 - d / env.decay;
    return env.sustain + (1 - env.sustain) * k * k;
  };
  if (t < gate) return held(t);
  const r = t - gate;
  if (r >= env.release) return 0;
  const k = 1 - r / env.release;
  return held(gate) * k * k;
}

/** Correction PolyBLEP d'une discontinuité (oscillateurs à bande limitée). */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Impulsion rectangulaire à bande limitée, centrée (sans composante continue). */
export function pulseWave(phase: number, dt: number, duty: number): number {
  let v = phase < duty ? 1 : -1;
  v += polyBlep(phase, dt);
  v -= polyBlep((phase - duty + 1) % 1, dt);
  return v - (2 * duty - 1);
}

/** Dent de scie à bande limitée. */
export function sawWave(phase: number, dt: number): number {
  return 2 * phase - 1 - polyBlep(phase, dt);
}

export function triangleWave(phase: number): number {
  return 1 - 4 * Math.abs(phase - 0.5);
}

/** Passe-bas à un pôle. */
export class OnePole {
  private y = 0;
  private a = 1;

  constructor(cutoff: number, sampleRate: number) {
    this.set(cutoff, sampleRate);
  }

  set(cutoff: number, sampleRate: number): void {
    this.a = 1 - Math.exp((-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
  }

  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** Filtre d'état variable (topologie TPT), sortie passe-bas ; coupure modulable. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly q = 0.9,
  ) {}

  setCutoff(cutoff: number): void {
    const g = Math.tan((Math.PI * Math.min(cutoff, this.sampleRate * 0.45)) / this.sampleRate);
    const k = 1 / this.q;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  lowpass(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
}

/** Biquad RBJ (passe-haut / passe-bande) pour la batterie. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'highpass' | 'bandpass' | 'lowpass', freq: number, q: number, sampleRate: number) {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    if (type === 'highpass') {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else if (type === 'lowpass') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Contexte de rendu d'une note. */
export interface VoiceContext {
  out: Float32Array;
  /** Échantillon de départ. */
  start: number;
  /** Durée tenue (échantillons). */
  gate: number;
  frequency: number;
  velocity: number;
  sampleRate: number;
  /** Replie les échantillons au-delà de la fin du tampon vers le début (boucle). */
  wrap: boolean;
  /** Graine propre à la note (bruit, phases). */
  seed: number;
}

function write(ctx: VoiceContext, offset: number, value: number): boolean {
  let i = ctx.start + offset;
  if (i >= ctx.out.length) {
    if (!ctx.wrap) return false;
    i %= ctx.out.length;
  }
  ctx.out[i] += value;
  return true;
}

interface OscVoice {
  env: Adsr;
  gain: number;
  wave: (phase: number, dt: number) => number;
  /** Vibrato retardé : profondeur (demi-tons), vitesse (Hz), délai (s). */
  vibrato?: [number, number, number];
  /** Coupure d'un passe-bas doux (Hz), en multiple de la fréquence si `keyTrack`. */
  lowpass?: number;
  keyTrack?: boolean;
}

function renderOsc(ctx: VoiceContext, v: OscVoice): void {
  const sr = ctx.sampleRate;
  const gateSec = ctx.gate / sr;
  const length = ctx.gate + Math.ceil(v.env.release * sr);
  const lp = v.lowpass ? new OnePole(v.keyTrack ? v.lowpass * ctx.frequency : v.lowpass, sr) : null;
  const lp2 = v.lowpass ? new OnePole(v.keyTrack ? v.lowpass * ctx.frequency : v.lowpass, sr) : null;
  let phase = (ctx.seed % 997) / 997;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    let f = ctx.frequency;
    if (v.vibrato && t > v.vibrato[2]) {
      const ramp = Math.min(1, (t - v.vibrato[2]) / 0.25);
      f *= Math.pow(2, (ramp * v.vibrato[0] * Math.sin(2 * Math.PI * v.vibrato[1] * t)) / 12);
    }
    const dt = f / sr;
    phase += dt;
    if (phase >= 1) phase -= 1;
    let s = v.wave(phase, dt);
    if (lp && lp2) s = lp2.process(lp.process(s));
    if (!write(ctx, i, s * adsrLevel(v.env, t, gateSec) * v.gain * ctx.velocity)) break;
  }
}

/** Nappe : trois dents de scie désaccordées + sous-octave, filtrées avec un lent balayage. */
function renderPad(ctx: VoiceContext): void {
  const sr = ctx.sampleRate;
  const env: Adsr = { attack: 0.35, decay: 0.6, sustain: 0.8, release: 0.9 };
  const gateSec = ctx.gate / sr;
  const length = ctx.gate + Math.ceil(env.release * sr);
  const detune = [-0.09, 0, 0.09].map((c) => Math.pow(2, c / 12));
  const phases = detune.map((_, k) => ((ctx.seed * (k + 3)) % 101) / 101);
  let sub = 0;
  const filter = new Svf(sr, 0.8);
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    if (i % 16 === 0) filter.setCutoff(1500 + 450 * Math.sin(2 * Math.PI * 0.25 * t + ctx.seed));
    const wobble = 1 + 0.002 * Math.sin(2 * Math.PI * 4.5 * t);
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const dt = (ctx.frequency * detune[k] * wobble) / sr;
      phases[k] += dt;
      if (phases[k] >= 1) phases[k] -= 1;
      s += sawWave(phases[k], dt);
    }
    sub += ctx.frequency / 2 / sr;
    if (sub >= 1) sub -= 1;
    s = filter.lowpass(s / 3) + 0.25 * Math.sin(2 * Math.PI * sub);
    if (!write(ctx, i, s * adsrLevel(env, t, gateSec) * 0.5 * ctx.velocity)) break;
  }
}

/** Corde pincée (Karplus-Strong avec retard fractionnaire passe-tout pour la justesse). */
function renderPluck(ctx: VoiceContext): void {
  const sr = ctx.sampleRate;
  const period = sr / ctx.frequency;
  const lineLength = Math.max(2, Math.floor(period - 0.6));
  const frac = period - 0.5 - lineLength;
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(lineLength);
  const noise = new NoiseSource(ctx.seed);
  const bright = new OnePole(Math.min(8000, ctx.frequency * 7), sr);
  for (let i = 0; i < lineLength; i++) line[i] = bright.process(noise.next());
  // Excitation centrée : sans composante continue, la corde ne laisse pas de décalage qui traîne.
  const mean = line.reduce((a, v) => a + v, 0) / lineLength;
  for (let i = 0; i < lineLength; i++) line[i] -= mean;
  const attack = Math.max(1, Math.round(0.001 * sr));
  // Temps de décroissance (−60 dB) plus court pour les notes aiguës, comme une vraie corde.
  const t60 = Math.min(2.5, 1.4 * Math.pow(220 / ctx.frequency, 0.5));
  const loopGain = Math.pow(0.001, 1 / (ctx.frequency * t60));
  const release = Math.ceil(0.12 * sr);
  const length = Math.min(ctx.gate + release, Math.ceil(t60 * sr));
  let r = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < length; i++) {
    const x = line[r];
    const avg = 0.5 * (x + prev);
    prev = x;
    const ap = c * avg + apIn - c * apOut;
    apIn = avg;
    apOut = ap;
    line[r] = ap * loopGain;
    r = (r + 1) % lineLength;
    const damp = (i < ctx.gate ? 1 : Math.pow(1 - (i - ctx.gate) / release, 2)) * Math.min(1, i / attack);
    if (!write(ctx, i, x * damp * 0.9 * ctx.velocity)) break;
  }
}

/** Basse synthé : scie + carré dans un passe-bas à enveloppe, renforcés d'une sinusoïde. */
function renderBass(ctx: VoiceContext): void {
  const sr = ctx.sampleRate;
  const env: Adsr = { attack: 0.004, decay: 0.15, sustain: 0.75, release: 0.07 };
  const gateSec = ctx.gate / sr;
  const length = ctx.gate + Math.ceil(env.release * sr);
  const filter = new Svf(sr, 1.1);
  const f = ctx.frequency;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    if (i % 16 === 0) filter.setCutoff(Math.min(3000, f * (2.5 + 6 * Math.exp(-t / 0.08))));
    const dt = f / sr;
    phase += dt;
    if (phase >= 1) phase -= 1;
    const raw = 0.6 * sawWave(phase, dt) + 0.4 * pulseWave(phase, dt, 0.5);
    const s = filter.lowpass(raw) * 0.8 + 0.45 * Math.sin(2 * Math.PI * phase);
    if (!write(ctx, i, s * adsrLevel(env, t, gateSec) * 0.55 * ctx.velocity)) break;
  }
}

/** Bruit « accordé » : bruit échantillonné-bloqué à une cadence liée à la hauteur (façon NES). */
function renderNoise(ctx: VoiceContext): void {
  const sr = ctx.sampleRate;
  const env: Adsr = { attack: 0.002, decay: 0.12, sustain: 0.25, release: 0.08 };
  const gateSec = ctx.gate / sr;
  const length = ctx.gate + Math.ceil(env.release * sr);
  const noise = new NoiseSource(ctx.seed);
  const rate = Math.min(sr, ctx.frequency * 8) / sr;
  let acc = 1;
  let value = 0;
  for (let i = 0; i < length; i++) {
    acc += rate;
    if (acc >= 1) {
      acc -= 1;
      value = noise.next();
    }
    if (!write(ctx, i, value * adsrLevel(env, i / sr, gateSec) * 0.35 * ctx.velocity)) break;
  }
}

const LEAD_ENV: Adsr = { attack: 0.006, decay: 0.1, sustain: 0.7, release: 0.07 };

/** Rend une note d'un instrument mélodique dans `ctx.out`. */
export function renderVoice(instrument: PitchedInstrument, ctx: VoiceContext): void {
  switch (instrument) {
    case 'square':
      return renderOsc(ctx, {
        env: LEAD_ENV,
        gain: 0.32,
        wave: (p, dt) => pulseWave(p, dt, 0.5),
        vibrato: [0.15, 5.5, 0.18],
        lowpass: 7000,
      });
    case 'pulse25':
      return renderOsc(ctx, {
        env: LEAD_ENV,
        gain: 0.36,
        wave: (p, dt) => pulseWave(p, dt, 0.25),
        vibrato: [0.15, 5.5, 0.18],
        lowpass: 7000,
      });
    case 'triangle':
      return renderOsc(ctx, {
        env: { attack: 0.004, decay: 0.05, sustain: 0.9, release: 0.05 },
        gain: 0.62,
        wave: (p) => triangleWave(p),
      });
    case 'sawtooth':
      return renderOsc(ctx, {
        env: { attack: 0.01, decay: 0.12, sustain: 0.7, release: 0.09 },
        gain: 0.38,
        wave: sawWave,
        vibrato: [0.12, 5, 0.2],
        lowpass: 6,
        keyTrack: true,
      });
    case 'sine':
      return renderOsc(ctx, {
        env: { attack: 0.015, decay: 0.25, sustain: 0.65, release: 0.18 },
        gain: 0.55,
        wave: (p) => Math.sin(2 * Math.PI * p) + 0.08 * Math.sin(4 * Math.PI * p),
        vibrato: [0.1, 5, 0.25],
      });
    case 'noise':
      return renderNoise(ctx);
    case 'pad':
      return renderPad(ctx);
    case 'pluck':
      return renderPluck(ctx);
    case 'bass':
      return renderBass(ctx);
  }
}

/** Rend un coup de batterie dans `ctx.out` (`frequency` et `gate` sont ignorés). */
export function renderDrum(hit: DrumHit, ctx: VoiceContext): void {
  const sr = ctx.sampleRate;
  const noise = new NoiseSource(ctx.seed);
  const v = ctx.velocity;
  switch (hit) {
    case 'K': {
      // Grosse caisse : sinusoïde dont la hauteur chute, petit clic, légère saturation.
      let phase = 0;
      for (let i = 0; i < Math.ceil(0.45 * sr); i++) {
        const t = i / sr;
        phase += (45 + 110 * Math.exp(-t / 0.04)) / sr;
        const click = t < 0.004 ? noise.next() * 0.3 * (1 - t / 0.004) : 0;
        const s = Math.tanh(1.6 * Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.16)) + click;
        if (!write(ctx, i, s * 0.95 * v)) break;
      }
      return;
    }
    case 'S': {
      // Caisse claire : bruit filtré en bande + corps tonal.
      const band = new Biquad('bandpass', 1900, 0.7, sr);
      const hp = new Biquad('highpass', 500, 0.7, sr);
      let phase = 0;
      for (let i = 0; i < Math.ceil(0.28 * sr); i++) {
        const t = i / sr;
        phase += (180 + 40 * Math.exp(-t / 0.02)) / sr;
        const tone = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.05) * 0.45;
        const n = hp.process(band.process(noise.next())) * 2.2 * Math.exp(-t / 0.085);
        if (!write(ctx, i, (tone + n) * 0.8 * v)) break;
      }
      return;
    }
    case 'H':
    case 'O': {
      // Charleston : bruit passe-haut, court (fermé) ou long (ouvert).
      const hp = new Biquad('highpass', 7000, 0.7, sr);
      const decay = hit === 'H' ? 0.022 : 0.14;
      for (let i = 0; i < Math.ceil(decay * 6 * sr); i++) {
        const t = i / sr;
        if (!write(ctx, i, hp.process(noise.next()) * Math.exp(-t / decay) * 0.42 * v)) break;
      }
      return;
    }
    case 'C': {
      // Cymbale crash : bruit brillant, longue décroissance.
      const hp = new Biquad('highpass', 4200, 0.6, sr);
      const band = new Biquad('bandpass', 8000, 0.5, sr);
      for (let i = 0; i < Math.ceil(1.8 * sr); i++) {
        const t = i / sr;
        const n = hp.process(noise.next());
        const s = (n * 0.7 + band.process(n) * 0.6) * Math.exp(-t / 0.45);
        if (!write(ctx, i, s * 0.4 * v)) break;
      }
      return;
    }
    case 'T': {
      // Tom : sinusoïde grave qui descend, avec un peu de bruit.
      const lp = new OnePole(2500, sr);
      let phase = 0;
      for (let i = 0; i < Math.ceil(0.45 * sr); i++) {
        const t = i / sr;
        phase += (95 + 45 * Math.exp(-t / 0.08)) / sr;
        const s =
          Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.17) + lp.process(noise.next()) * 0.15 * Math.exp(-t / 0.03);
        if (!write(ctx, i, s * 0.8 * v)) break;
      }
      return;
    }
  }
}

/** Réglages de mixage par instrument : part envoyée à la réverbération. */
export const REVERB_SEND: Record<Instrument, number> = {
  square: 0.16,
  pulse25: 0.18,
  triangle: 0.1,
  sawtooth: 0.2,
  sine: 0.28,
  noise: 0.1,
  pad: 0.4,
  pluck: 0.3,
  bass: 0.02,
  drums: 0.07,
};

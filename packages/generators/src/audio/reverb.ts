/**
 * Réverbération stéréo de type Schroeder/Freeverb (8 filtres en peigne amortis + 4 passe-tout par
 * canal). En mode boucle, le signal est traité deux fois de suite et seul le second passage est
 * gardé : la queue de réverbération de la fin se retrouve au début et la boucle reste sans couture.
 */

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

export interface ReverbOptions {
  /** Taille de la pièce (0–1) : rétroaction des peignes. */
  room?: number;
  /** Amortissement des aigus (0–1). */
  damping?: number;
  /** Traite l'entrée comme une boucle. */
  loop?: boolean;
}

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;

  constructor(
    size: number,
    private readonly feedback: number,
    private readonly damping: number,
  ) {
    this.buffer = new Float32Array(size);
  }

  process(x: number): number {
    const y = this.buffer[this.index];
    this.store = y * (1 - this.damping) + this.store * this.damping;
    this.buffer[this.index] = x + this.store * this.feedback;
    if (++this.index >= this.buffer.length) this.index = 0;
    return y;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  process(x: number): number {
    const b = this.buffer[this.index];
    this.buffer[this.index] = x + b * 0.5;
    if (++this.index >= this.buffer.length) this.index = 0;
    return b - x;
  }
}

function makeChannel(scale: number, spread: number, feedback: number, damping: number) {
  const combs = COMBS.map((n) => new Comb(Math.round((n + spread) * scale), feedback, damping));
  const allpasses = ALLPASSES.map((n) => new Allpass(Math.round((n + spread) * scale)));
  return (x: number): number => {
    let y = 0;
    for (const c of combs) y += c.process(x);
    for (const a of allpasses) y = a.process(y);
    return y;
  };
}

/** Calcule le signal réverbéré (stéréo) d'un bus d'envoi mono de `input.length` échantillons. */
export function renderReverb(
  input: Float32Array,
  sampleRate: number,
  options: ReverbOptions = {},
): { left: Float32Array; right: Float32Array } {
  const scale = sampleRate / 44100;
  const feedback = 0.7 + 0.28 * (options.room ?? 0.75);
  const damping = 0.4 * (options.damping ?? 0.5);
  const left = makeChannel(scale, 0, feedback, damping);
  const right = makeChannel(scale, STEREO_SPREAD, feedback, damping);
  const n = input.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const gain = 0.015;
  const passes = options.loop ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const keep = pass === passes - 1;
    for (let i = 0; i < n; i++) {
      const x = input[i] * gain;
      const l = left(x);
      const r = right(x);
      if (keep) {
        outL[i] = l;
        outR[i] = r;
      }
    }
  }
  return { left: outL, right: outR };
}

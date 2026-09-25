import type { Rng } from '@forge/core';
import { matchKeywords, normalizeText } from './keywords';
import { DEFAULT_SFXR_PARAMS, type SfxrParams } from './sfxr';
import type { SfxPreset } from './sfx-spec';

/**
 * Préréglages aléatoires façon boutons de sfxr : chaque famille tire ses paramètres dans des plages
 * choisies pour sonner juste (hauteurs, glissements et durées typiques du jeu vidéo rétro).
 */

type ConcretePreset = Exclude<SfxPreset, 'random'>;
type PresetFn = (rng: Rng) => Partial<SfxrParams>;

/** Tirage log-uniforme (adapté aux fréquences). */
function logFloat(rng: Rng, min: number, max: number): number {
  return Math.exp(rng.float(Math.log(min), Math.log(max)));
}

const PRESETS: Record<ConcretePreset, PresetFn> = {
  coin: (rng) => ({
    wave: rng.weighted(['square', 'triangle', 'sine'], [6, 2, 1]),
    baseFrequency: logFloat(rng, 750, 1600),
    duty: rng.pick([0.5, 0.5, 0.25]),
    sustain: rng.float(0.02, 0.08),
    decay: rng.float(0.15, 0.4),
    punch: rng.float(0.3, 0.6),
    ...(rng.bool(0.85) ? { arpeggio: rng.pick([4, 5, 7, 12]), arpeggioDelay: rng.float(0.04, 0.09) } : {}),
  }),

  laser: (rng) => {
    const steep = rng.bool(0.33);
    const narrow = rng.bool(0.5);
    return {
      wave: rng.pick(['square', 'square', 'sawtooth', 'sine']),
      baseFrequency: logFloat(rng, steep ? 600 : 900, steep ? 2200 : 2800),
      frequencyLimit: rng.bool(0.5) ? rng.float(60, 250) : 0,
      slide: steep ? -rng.float(16, 30) : -rng.float(4, 16),
      duty: narrow ? rng.float(0.1, 0.3) : rng.float(0.3, 0.5),
      dutySweep: narrow ? rng.float(0, 0.6) : -rng.float(0, 0.8),
      sustain: rng.float(0.03, 0.15),
      decay: rng.float(0.05, 0.25),
      punch: rng.bool(0.5) ? rng.float(0, 0.3) : 0,
      ...(rng.bool(0.33) ? { phaserOffset: rng.float(0.1, 0.35), phaserSweep: -rng.float(0, 0.1) } : {}),
      ...(rng.bool(0.5) ? { highPassCutoff: rng.float(100, 800) } : {}),
    };
  },

  explosion: (rng) => ({
    wave: 'noise',
    baseFrequency: logFloat(rng, 40, 400),
    slide: rng.bool(0.5) ? -rng.float(0.5, 2.5) : rng.float(-0.3, 0.3),
    sustain: rng.float(0.1, 0.35),
    decay: rng.float(0.4, 1),
    punch: rng.float(0.3, 0.7),
    ...(rng.bool(0.4) ? { phaserOffset: rng.float(-0.3, 0.6), phaserSweep: -rng.float(0, 0.3) } : {}),
    ...(rng.bool(0.25) ? { repeatInterval: rng.float(0.1, 0.3) } : {}),
    ...(rng.bool(0.6) ? { lowPassCutoff: rng.float(1500, 5000), lowPassSweep: -rng.float(1, 3) } : {}),
    ...(rng.bool(0.3) ? { vibratoDepth: rng.float(1, 4), vibratoSpeed: rng.float(5, 20) } : {}),
  }),

  powerup: (rng) => {
    const repeat = rng.bool(0.5);
    return {
      wave: rng.pick(['square', 'sawtooth', 'square']),
      duty: rng.float(0.2, 0.5),
      baseFrequency: logFloat(rng, 250, 700),
      slide: repeat ? rng.float(4, 12) : rng.float(1, 4),
      ...(repeat ? { repeatInterval: rng.float(0.08, 0.16) } : {}),
      ...(!repeat && rng.bool(0.5) ? { vibratoDepth: rng.float(0.5, 2), vibratoSpeed: rng.float(8, 15) } : {}),
      sustain: rng.float(0.1, 0.35),
      decay: rng.float(0.15, 0.4),
    };
  },

  hit: (rng) => ({
    wave: rng.pick(['square', 'sawtooth', 'noise']),
    duty: rng.float(0.2, 0.5),
    baseFrequency: logFloat(rng, 200, 900),
    slide: -rng.float(12, 40),
    sustain: rng.float(0, 0.05),
    decay: rng.float(0.08, 0.25),
    punch: rng.float(0.2, 0.5),
    ...(rng.bool(0.5) ? { highPassCutoff: rng.float(100, 700) } : {}),
  }),

  jump: (rng) => ({
    wave: 'square',
    duty: rng.float(0.25, 0.5),
    baseFrequency: logFloat(rng, 250, 600),
    slide: rng.float(1.5, 5),
    sustain: rng.float(0.05, 0.2),
    decay: rng.float(0.08, 0.25),
    ...(rng.bool(0.5) ? { highPassCutoff: rng.float(80, 400) } : {}),
    ...(rng.bool(0.5) ? { lowPassCutoff: rng.float(3000, 9000) } : {}),
  }),

  blip: (rng) => ({
    wave: rng.pick(['square', 'square', 'sawtooth']),
    duty: rng.float(0.25, 0.5),
    baseFrequency: logFloat(rng, 400, 1400),
    sustain: rng.float(0.02, 0.06),
    decay: rng.float(0.01, 0.08),
    highPassCutoff: 60,
  }),

  select: (rng) => ({
    wave: rng.pick(['square', 'triangle']),
    duty: 0.5,
    baseFrequency: logFloat(rng, 600, 1200),
    arpeggio: rng.pick([5, 7, 12]),
    arpeggioDelay: rng.float(0.04, 0.07),
    sustain: rng.float(0.06, 0.1),
    decay: rng.float(0.05, 0.15),
    punch: 0.2,
  }),

  cancel: (rng) => ({
    wave: rng.pick(['square', 'triangle']),
    duty: 0.5,
    baseFrequency: logFloat(rng, 500, 900),
    ...(rng.bool(0.6)
      ? { arpeggio: -rng.pick([5, 7, 12]), arpeggioDelay: rng.float(0.05, 0.08) }
      : { slide: -rng.float(3, 6) }),
    sustain: rng.float(0.05, 0.1),
    decay: rng.float(0.08, 0.2),
    lowPassCutoff: rng.float(3000, 6000),
  }),

  door: (rng) =>
    rng.bool(0.5)
      ? {
          // Grincement : dent de scie grave, vibrato irrégulier, filtre résonant.
          wave: 'sawtooth',
          baseFrequency: logFloat(rng, 90, 180),
          slide: rng.float(-0.3, 0.3),
          vibratoDepth: rng.float(1, 3),
          vibratoSpeed: rng.float(8, 20),
          attack: rng.float(0.03, 0.08),
          sustain: rng.float(0.3, 0.6),
          decay: rng.float(0.2, 0.4),
          lowPassCutoff: rng.float(1500, 3000),
          lowPassResonance: rng.float(0.4, 0.7),
          highPassCutoff: 80,
        }
      : {
          // Claquement : bruit sourd et percutant.
          wave: 'noise',
          baseFrequency: logFloat(rng, 30, 90),
          punch: rng.float(0.6, 0.9),
          sustain: rng.float(0.02, 0.06),
          decay: rng.float(0.2, 0.4),
          lowPassCutoff: rng.float(600, 1500),
          lowPassSweep: -2,
        },

  step: (rng) => ({
    wave: 'noise',
    baseFrequency: logFloat(rng, 150, 400),
    sustain: rng.float(0.005, 0.02),
    decay: rng.float(0.04, 0.1),
    punch: rng.float(0.3, 0.6),
    lowPassCutoff: rng.float(1200, 3000),
    highPassCutoff: rng.float(60, 150),
    volume: 0.7,
  }),

  magic: (rng) => {
    if (rng.bool(0.6)) {
      // Scintillement : trilles montantes relancées.
      const repeat = rng.float(0.05, 0.1);
      return {
        wave: rng.pick(['sine', 'triangle', 'square']),
        baseFrequency: logFloat(rng, 700, 1400),
        repeatInterval: repeat,
        arpeggio: rng.pick([7, 12]),
        arpeggioDelay: repeat / 2,
        slide: rng.float(1, 3),
        vibratoDepth: 0.3,
        vibratoSpeed: 10,
        sustain: rng.float(0.15, 0.35),
        decay: rng.float(0.3, 0.6),
        lowPassCutoff: rng.float(4000, 9000),
        ...(rng.bool(0.5) ? { phaserOffset: rng.float(0.1, 0.3), phaserSweep: rng.float(0.05, 0.2) } : {}),
      };
    }
    // Soin : note douce qui monte avec un vibrato chantant.
    return {
      wave: rng.pick(['triangle', 'sine']),
      baseFrequency: logFloat(rng, 400, 700),
      slide: rng.float(1.5, 3),
      vibratoDepth: rng.float(0.5, 1.5),
      vibratoSpeed: rng.float(6, 10),
      attack: rng.float(0.02, 0.08),
      sustain: rng.float(0.2, 0.4),
      decay: rng.float(0.3, 0.6),
    };
  },
};

export const CONCRETE_PRESETS = Object.keys(PRESETS) as ConcretePreset[];

/** Mots-clés (FR / EN) de chaque famille, dans l'ordre de priorité en cas d'égalité. */
const PRESET_KEYWORDS: Record<ConcretePreset, readonly string[]> = {
  coin: ['piece', 'pieces', 'coin', 'coins', 'monnaie', 'argent', 'tresor', 'gemme', 'gem', 'rubis', 'ramasser', 'pickup'],
  explosion: ['explos', 'boom', 'bombe', 'bomb', 'detonation', 'dynamite', 'grenade'],
  laser: ['laser', 'lasers', 'tir', 'tirs', 'tirer', 'shoot', 'blaster', 'pistolet', 'gun', 'projectile', 'pew'],
  magic: ['soin', 'soigner', 'magie', 'magique', 'magic', 'sort', 'spell', 'heal', 'guerison', 'enchant', 'sparkle'],
  powerup: ['bonus', 'powerup', 'power', 'amelioration', 'upgrade', 'level', 'niveau', 'victoire', 'win'],
  hit: ['coup', 'coups', 'frapper', 'hit', 'hurt', 'degat', 'blesse', 'blessure', 'damage', 'impact', 'punch', 'aie'],
  jump: ['saut', 'sauts', 'sauter', 'jump', 'bond', 'bondir', 'rebond'],
  door: ['porte', 'door', 'grincement', 'grince', 'creak', 'portail', 'trappe'],
  step: ['pas', 'step', 'steps', 'footstep', 'footsteps', 'marche', 'marcher', 'walk'],
  select: ['menu', 'selection', 'selectionner', 'select', 'valider', 'validation', 'confirm', 'ok', 'clic', 'click'],
  cancel: ['annuler', 'annulation', 'cancel', 'retour', 'back', 'erreur', 'error', 'refus', 'deny', 'impossible'],
  blip: ['blip', 'bip', 'beep', 'notification', 'texte', 'dialogue', 'typing', 'message'],
};

/** Famille d'effet déduite d'une description libre, ou `undefined`. */
export function detectPreset(prompt: string): ConcretePreset | undefined {
  return matchKeywords(prompt, PRESET_KEYWORDS);
}

/** Choisit la famille : explicite, sinon d'après la description, sinon d'après la graine. */
export function resolvePreset(preset: SfxPreset, prompt: string, rng: Rng): ConcretePreset {
  if (preset !== 'random') return preset;
  return detectPreset(prompt) ?? rng.pick(CONCRETE_PRESETS);
}

/** Paramètres complets d'un préréglage, ajustés par les adjectifs de la description. */
export function presetParams(preset: ConcretePreset, prompt: string, rng: Rng): SfxrParams {
  const params: SfxrParams = { ...DEFAULT_SFXR_PARAMS, ...PRESETS[preset](rng) };
  return applyAdjectives(params, prompt);
}

/** Nuances simples : grave / aigu, long / court, doux / fort. */
function applyAdjectives(p: SfxrParams, prompt: string): SfxrParams {
  const words = new Set(normalizeText(prompt).split(' '));
  const has = (...list: string[]) => list.some((w) => words.has(w));
  const out = { ...p };
  if (has('grave', 'graves', 'deep', 'low', 'lourd', 'lourde', 'gros', 'grosse', 'big')) {
    out.baseFrequency *= 0.6;
    out.frequencyLimit *= 0.6;
  }
  if (has('aigu', 'aigue', 'high', 'petit', 'petite', 'small', 'leger', 'legere', 'cristallin')) {
    out.baseFrequency *= 1.5;
    out.frequencyLimit *= 1.5;
  }
  if (has('long', 'longue', 'lent', 'lente', 'slow')) {
    out.sustain *= 1.6;
    out.decay *= 1.6;
  }
  if (has('court', 'courte', 'bref', 'breve', 'short', 'rapide', 'sec', 'seche')) {
    out.sustain *= 0.6;
    out.decay *= 0.6;
  }
  if (has('doux', 'douce', 'soft', 'feutre', 'discret', 'discrete')) {
    out.lowPassCutoff = Math.min(out.lowPassCutoff, 3500);
    out.volume = Math.min(out.volume, 0.75);
  }
  if (has('fort', 'forte', 'loud', 'puissant', 'puissante', 'violent', 'violente')) {
    out.punch = Math.min(1, out.punch + 0.2);
  }
  out.baseFrequency = clamp(out.baseFrequency, 20, 5000);
  out.frequencyLimit = out.frequencyLimit > 0 ? clamp(out.frequencyLimit, 1, out.baseFrequency * 0.9) : 0;
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

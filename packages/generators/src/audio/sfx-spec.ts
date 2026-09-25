import { z } from 'zod';
import { DEFAULT_SFXR_PARAMS as D } from './sfxr';

export const SFX_WAVES = ['square', 'sawtooth', 'sine', 'triangle', 'noise'] as const;

export const SFX_PRESETS = [
  'coin',
  'laser',
  'explosion',
  'powerup',
  'hit',
  'jump',
  'blip',
  'select',
  'cancel',
  'door',
  'step',
  'magic',
  'random',
] as const;
export type SfxPreset = (typeof SFX_PRESETS)[number];

export const sfxParamsSchema = z.object({
  prompt: z.string().default('').describe('Description libre du son (ex. « pièce ramassée, joyeux »)'),
  preset: z
    .enum(SFX_PRESETS)
    .default('random')
    .describe('Famille d’effet ; « random » la déduit de la description ou de la graine'),
});
export type SfxParams = z.infer<typeof sfxParamsSchema>;

const num = (min: number, max: number, def: number, description: string) =>
  z.number().min(min).max(max).default(def).describe(description);

/** Paramètres du synthétiseur (unités physiques), produits par Claude ou par les préréglages. */
export const sfxSpecSchema = z
  .object({
    wave: z
      .enum(SFX_WAVES)
      .default(D.wave)
      .describe('Forme d’onde : square (8-bit), sawtooth (brillant), sine (pur), triangle (doux), noise (bruit)'),
    attack: num(0, 2, D.attack, 'Montée de l’enveloppe en secondes (0 = attaque immédiate)'),
    sustain: num(0, 2, D.sustain, 'Maintien à plein volume en secondes'),
    punch: num(0, 1, D.punch, 'Surplus de volume au début du maintien (0–1), donne de l’impact'),
    decay: num(0, 3, D.decay, 'Déclin final en secondes'),
    baseFrequency: num(20, 5000, D.baseFrequency, 'Fréquence de départ en Hz (440 = la3)'),
    frequencyLimit: num(
      0,
      5000,
      D.frequencyLimit,
      'Fréquence plancher en Hz : le son s’arrête quand un glissement descendant la franchit (0 = aucune)',
    ),
    slide: num(-40, 40, D.slide, 'Glissement de hauteur en octaves par seconde (négatif = descend)'),
    deltaSlide: num(-200, 200, D.deltaSlide, 'Accélération du glissement en octaves/s²'),
    vibratoDepth: num(0, 12, D.vibratoDepth, 'Profondeur du vibrato en demi-tons (0 = aucun)'),
    vibratoSpeed: num(0, 50, D.vibratoSpeed, 'Vitesse du vibrato en Hz'),
    arpeggio: num(-24, 24, D.arpeggio, 'Saut de hauteur unique en demi-tons (ex. 7 = quinte, 12 = octave)'),
    arpeggioDelay: num(0, 2, D.arpeggioDelay, 'Délai avant le saut d’arpège en secondes'),
    duty: num(0.02, 0.5, D.duty, 'Rapport cyclique du carré (0,5 = carré plein, 0,125 = très nasillard)'),
    dutySweep: num(-2, 2, D.dutySweep, 'Variation du rapport cyclique par seconde'),
    repeatInterval: num(
      0,
      2,
      D.repeatInterval,
      'Relance de la hauteur et de l’arpège toutes les N secondes (0 = aucune) : trilles, sirènes',
    ),
    phaserOffset: num(-1, 1, D.phaserOffset, 'Décalage du phaser (0 = aucun, ±1 = maximal)'),
    phaserSweep: num(-1, 1, D.phaserSweep, 'Balayage du phaser dans le temps'),
    lowPassCutoff: num(50, 22050, D.lowPassCutoff, 'Coupure du passe-bas en Hz (≥ 20000 = désactivé)'),
    lowPassSweep: num(-20, 20, D.lowPassSweep, 'Balayage de la coupure du passe-bas en octaves/s'),
    lowPassResonance: num(0, 1, D.lowPassResonance, 'Résonance du passe-bas (0–1)'),
    highPassCutoff: num(0, 5000, D.highPassCutoff, 'Coupure du passe-haut en Hz (0 = désactivé)'),
    highPassSweep: num(-20, 20, D.highPassSweep, 'Balayage de la coupure du passe-haut en octaves/s'),
    volume: num(0.1, 1, D.volume, 'Volume relatif : le pic final vaut 0,9 × volume'),
  })
  .superRefine((spec, ctx) => {
    if (spec.attack + spec.sustain + spec.decay < 0.02) {
      ctx.addIssue({
        code: 'custom',
        path: ['sustain'],
        message: 'Son trop court : attack + sustain + decay doit dépasser 0,02 s.',
      });
    }
    if (spec.frequencyLimit > 0 && spec.frequencyLimit >= spec.baseFrequency) {
      ctx.addIssue({
        code: 'custom',
        path: ['frequencyLimit'],
        message:
          `frequencyLimit (${spec.frequencyLimit} Hz) doit être inférieure à baseFrequency ` +
          `(${spec.baseFrequency} Hz), sinon le son s’arrête immédiatement ; mettez 0 pour aucune limite.`,
      });
    }
  });
export type SfxSpec = z.infer<typeof sfxSpecSchema>;

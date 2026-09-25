import { z } from 'zod';
import { parseDrumTrack, parsePitchedTrack } from './notes';

export const INSTRUMENTS = [
  'square',
  'pulse25',
  'triangle',
  'sawtooth',
  'sine',
  'noise',
  'pad',
  'pluck',
  'bass',
  'drums',
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const MOODS = ['calm', 'happy', 'tense', 'sad', 'epic', 'mysterious', 'battle', 'village'] as const;
export type Mood = (typeof MOODS)[number];

/** Durée maximale d'un morceau (s). */
export const MUSIC_MAX_SECONDS = 90;

export const musicParamsSchema = z.object({
  prompt: z.string().default('').describe('Description libre de la musique (ex. « thème de forêt paisible »)'),
  mood: z.enum(MOODS).default('calm').describe('Ambiance générale'),
  bpm: z.number().int().min(60).max(200).optional().describe('Tempo en battements par minute (sinon selon l’ambiance)'),
  bars: z.number().int().min(4).max(32).default(8).describe('Nombre de mesures'),
  loop: z.boolean().default(true).describe('Boucle sans couture (sinon fin avec queue de réverbération)'),
});
export type MusicParams = z.infer<typeof musicParamsSchema>;

export const musicTrackSchema = z.object({
  name: z.string().min(1).max(40).describe('Nom de la piste (ex. « mélodie », « basse »)'),
  instrument: z
    .enum(INSTRUMENTS)
    .describe(
      'square / pulse25 : leads 8-bit ; triangle : basse ou flûte douce ; sawtooth : lead brillant ; sine : ' +
        'lead pur ; noise : bruit accordé ; pad : nappe d’accords ; pluck : cordes pincées ; bass : basse ' +
        'synthé filtrée ; drums : batterie (K S H O C T)',
    ),
  volume: z.number().min(0).max(1).default(0.7).describe('Volume de la piste (0–1)'),
  pan: z.number().min(-1).max(1).optional().describe('Panoramique : -1 gauche, 0 centre, 1 droite'),
  notes: z
    .string()
    .min(1)
    .max(12000)
    .describe(
      'Jetons séparés par des espaces : C4:2 (note, durée en pas), C4+E4+G4:4 (accord), R:4 (silence), F#3, Bb2 ; ' +
        'drums : K S H O C T R, combinables (K+H:2). La piste boucle pour remplir le morceau.',
    ),
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const musicSpecSchema = z
  .object({
    bpm: z.number().min(40).max(240).describe('Tempo en battements par minute'),
    stepsPerBeat: z.number().int().min(1).max(8).default(4).describe('Pas par temps (4 = doubles croches)'),
    beatsPerBar: z.number().int().min(2).max(8).default(4).describe('Temps par mesure (4 = 4/4, 3 = valse)'),
    bars: z.number().int().min(1).max(64).describe('Nombre de mesures du morceau'),
    key: z.string().max(40).optional().describe('Tonalité indicative (ex. « A minor »)'),
    tracks: z.array(musicTrackSchema).min(1).max(8).describe('Pistes (8 au maximum)'),
  })
  .superRefine((spec, ctx) => {
    const seconds = (spec.bars * spec.beatsPerBar * 60) / spec.bpm;
    if (seconds > MUSIC_MAX_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['bars'],
        message:
          `Morceau trop long : ${seconds.toFixed(1)} s pour ${spec.bars} mesures à ${spec.bpm} bpm ` +
          `(maximum ${MUSIC_MAX_SECONDS} s) ; réduisez bars ou augmentez bpm.`,
      });
    }
    spec.tracks.forEach((track, i) => {
      const parsed = track.instrument === 'drums' ? parseDrumTrack(track.notes) : parsePitchedTrack(track.notes);
      for (const error of parsed.errors) {
        ctx.addIssue({ code: 'custom', path: ['tracks', i, 'notes'], message: `Piste « ${track.name} » : ${error}` });
      }
      if (!parsed.errors.length && parsed.totalSteps === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', i, 'notes'],
          message: `Piste « ${track.name} » : aucune durée (ajoutez au moins un jeton, ex. R:16).`,
        });
      }
    });
  });
export type MusicSpec = z.infer<typeof musicSpecSchema>;

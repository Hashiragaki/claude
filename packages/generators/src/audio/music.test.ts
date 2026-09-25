import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeWav } from '../encode/wav';
import type { RenderContext } from '../types';
import { resolveMood } from './composer';
import { peakOf } from './dsp';
import { musicGenerator } from './music';
import { MOODS, musicSpecSchema, type MusicSpec } from './music-spec';
import { parsePitchedTrack } from './notes';
import { MUSIC_SAMPLE_RATE, renderSong } from './song';

const ctx: RenderContext = { rasterizeSvg: async () => new Uint8Array() };
const params = (over: Record<string, unknown> = {}) => musicGenerator.paramsSchema.parse(over);

async function render(spec: MusicSpec, over: Record<string, unknown> = {}) {
  const result = await musicGenerator.render(spec, params(over), ctx);
  const main = result.files.find((f) => f.role === 'main')!;
  return { result, wav: decodeWav(main.data as Uint8Array) };
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Spec telle que Claude pourrait l'écrire (exemple du prompt système). */
const claudeSpec = {
  bpm: 100,
  bars: 2,
  key: 'C major',
  tracks: [
    { name: 'lead', instrument: 'square', volume: 0.6, notes: 'E5:4 G5:2 E5:2 D5:4 C5:4 | D5:4 B4:2 C5:2 D5:8' },
    { name: 'chords', instrument: 'pad', volume: 0.4, notes: 'C4+E4+G4:16 | B3+D4+G4:16' },
    { name: 'bass', instrument: 'bass', volume: 0.65, notes: 'C3:8 G2:8 | G2:8 D3:8' },
    { name: 'drums', instrument: 'drums', volume: 0.55, notes: 'K+H:2 H:2 S+H:2 H:2 K+H:2 K+H:2 S+H:2 H:2' },
  ],
};

describe('générateur de musique', () => {
  it('accepte des paramètres vides avec des valeurs par défaut', () => {
    expect(params()).toEqual({ prompt: '', mood: 'calm', bars: 8, loop: true });
    expect(() => params({ bpm: 300 })).toThrow();
    expect(musicGenerator.kind).toBe('music');
  });

  it('expose un schéma de spec convertible en JSON Schema', () => {
    const schema = z.toJSONSchema(musicSpecSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['bpm', 'stepsPerBeat', 'beatsPerBar', 'bars', 'key', 'tracks']),
    );
    expect(z.toJSONSchema(musicSpecSchema, { io: 'input' })).toBeTruthy();
  });

  it('est déterministe pour une graine donnée', () => {
    const p = params({ mood: 'happy' });
    expect(musicGenerator.procedural(p, new Rng(3))).toEqual(musicGenerator.procedural(p, new Rng(3)));
    expect(musicGenerator.procedural(p, new Rng(3))).not.toEqual(musicGenerator.procedural(p, new Rng(4)));
  });

  it('compose puis rend chaque ambiance : spec valide, WAV stéréo en boucle exacte', { timeout: 60000 }, async () => {
    for (const mood of MOODS) {
      const spec = musicGenerator.procedural(params({ mood, bars: 4 }), new Rng(11));
      expect(musicSpecSchema.safeParse(spec).success).toBe(true);
      expect(spec.bars).toBe(4);
      const { result, wav } = await render(spec, { mood, bars: 4 });
      expect(wav.sampleRate).toBe(MUSIC_SAMPLE_RATE);
      expect(wav.channels).toHaveLength(2);
      const steps = spec.bars * spec.beatsPerBar * spec.stepsPerBeat;
      const expected = Math.round((steps * MUSIC_SAMPLE_RATE * 60) / (spec.bpm * spec.stepsPerBeat));
      expect(wav.channels[0].length).toBe(expected);
      const peak = peakOf(wav.channels);
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(1);
      expect(rms(wav.channels[0])).toBeGreaterThan(0.03);
      expect(result.info).toMatchObject({ bpm: spec.bpm, bars: 4 });
      expect(result.info.duration).toBeCloseTo(expected / MUSIC_SAMPLE_RATE, 2);
    }
  });

  it('écrit des mélodies dans un registre chantant et des batteries selon l’ambiance', () => {
    for (const mood of MOODS) {
      const spec = musicGenerator.procedural(params({ mood }), new Rng(2));
      const melody = parsePitchedTrack(spec.tracks[0].notes).events.flatMap((e) => e.pitches);
      expect(Math.min(...melody)).toBeGreaterThanOrEqual(55);
      expect(Math.max(...melody)).toBeLessThanOrEqual(88);
      const hasDrums = spec.tracks.some((t) => t.instrument === 'drums');
      if (mood === 'battle' || mood === 'epic' || mood === 'happy') expect(hasDrums).toBe(true);
      if (mood === 'calm' || mood === 'sad') expect(hasDrums).toBe(false);
    }
  });

  it('respecte le tempo demandé et plafonne la durée à 90 s', () => {
    const spec = musicGenerator.procedural(params({ mood: 'battle', bpm: 150 }), new Rng(1));
    expect(spec.bpm).toBe(150);
    const long = musicGenerator.procedural(params({ mood: 'sad', bpm: 60, bars: 32 }), new Rng(1));
    expect((long.bars * long.beatsPerBar * 60) / long.bpm).toBeLessThanOrEqual(90);
  });

  it('déduit l’ambiance de la description quand elle est laissée par défaut', () => {
    expect(resolveMood(params({ prompt: 'combat contre un boss' }))).toBe('battle');
    expect(resolveMood(params({ prompt: 'place du village' }))).toBe('village');
    expect(resolveMood(params({ prompt: 'combat', mood: 'sad' }))).toBe('sad');
  });

  it('rend une spec écrite à la main ; les pistes courtes bouclent', async () => {
    const spec = musicSpecSchema.parse(claudeSpec);
    const { wav } = await render(spec);
    expect(wav.channels[0].length).toBe(Math.round(2 * 4 * 0.6 * MUSIC_SAMPLE_RATE));
    // La batterie d'une demi-mesure boucle : un morceau fait de sa seule piste reste actif jusqu'au bout.
    const drumsOnly = musicSpecSchema.parse({ bpm: 120, bars: 4, tracks: [claudeSpec.tracks[3]] });
    const song = renderSong(drumsOnly);
    const bar = song.loopLength / 4;
    expect(rms(song.left, 3 * bar, 4 * bar)).toBeGreaterThan(0.3 * rms(song.left, 0, bar));
  });

  it('ajoute une queue de réverbération sans boucle', () => {
    const spec = musicSpecSchema.parse({ ...claudeSpec, tracks: claudeSpec.tracks.slice(0, 2) });
    const looped = renderSong(spec, { loop: true });
    const ending = renderSong(spec, { loop: false });
    expect(looped.left.length).toBe(looped.loopLength);
    expect(ending.left.length).toBeGreaterThan(ending.loopLength);
    expect(Math.abs(ending.left[ending.left.length - 1])).toBeLessThan(0.01);
  });

  it('rejette les jetons invalides en nommant la piste et le jeton', () => {
    const bad = musicSpecSchema.safeParse({
      bpm: 120,
      bars: 4,
      tracks: [
        { name: 'mélodie', instrument: 'square', notes: 'C4:2 H9:2 E4' },
        { name: 'rythme', instrument: 'drums', notes: 'K:4 C4:4' },
        { name: 'vide', instrument: 'pad', notes: '   ' },
      ],
    });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message);
    expect(messages.some((m) => /Piste « mélodie ».*« H9:2 »/.test(m))).toBe(true);
    expect(messages.some((m) => /Piste « rythme ».*« C4 ».*drums/.test(m))).toBe(true);
    expect(messages.some((m) => /Piste « vide ».*vide/.test(m))).toBe(true);
    expect(bad.error!.issues[0].path).toEqual(['tracks', 0, 'notes']);
  });

  it('rejette un morceau de plus de 90 s', () => {
    const long = musicSpecSchema.safeParse({ ...claudeSpec, bpm: 60, bars: 40 });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0].message).toMatch(/trop long.*160\.0 s/);
  });

  it('construit des consignes qui intègrent les paramètres et la spec courante', () => {
    const p = params({ prompt: 'forêt enchantée', mood: 'mysterious', bpm: 80, bars: 16 });
    const prompt = musicGenerator.buildPrompt(p);
    expect(prompt).toContain('forêt enchantée');
    expect(prompt).toContain('mysterious');
    expect(prompt).toContain('80 bpm');
    expect(prompt).toContain('16 bars');
    const spec = musicSpecSchema.parse(claudeSpec);
    const edit = musicGenerator.buildEditPrompt(spec, 'plus rapide', p);
    expect(edit).toContain('plus rapide');
    expect(edit).toContain('"instrument": "pad"');
    expect(musicGenerator.systemPrompt).toMatch(/K kick/);
  });
});

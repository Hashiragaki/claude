import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeWav } from '../encode/wav';
import type { RenderContext } from '../types';
import { peakOf } from './dsp';
import { sfxGenerator, SFX_MAX_SECONDS, SFX_SAMPLE_RATE } from './sfx';
import { detectPreset } from './sfx-presets';
import { SFX_PRESETS, sfxSpecSchema, type SfxSpec } from './sfx-spec';
import { DEFAULT_SFXR_PARAMS, synthesizeSfxr } from './sfxr';

const ctx: RenderContext = { rasterizeSvg: async () => new Uint8Array() };
const params = (over: Record<string, unknown> = {}) => sfxGenerator.paramsSchema.parse(over);

async function renderWav(spec: SfxSpec) {
  const result = await sfxGenerator.render(spec, params(), ctx);
  const main = result.files.find((f) => f.role === 'main')!;
  return { result, wav: decodeWav(main.data as Uint8Array) };
}

/** Nombre de passages par zéro montants (estimation de fréquence). */
function risingCrossings(samples: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) n++;
  return n;
}

describe('générateur sfx', () => {
  it('accepte des paramètres vides avec des valeurs par défaut', () => {
    expect(params()).toEqual({ prompt: '', preset: 'random' });
    expect(params({ prompt: 'saut' }).prompt).toBe('saut');
    expect(sfxGenerator.kind).toBe('sfx');
  });

  it('expose un schéma de spec convertible en JSON Schema', () => {
    const schema = z.toJSONSchema(sfxSpecSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.baseFrequency.description).toMatch(/Hz/);
    expect(z.toJSONSchema(sfxSpecSchema, { io: 'input' })).toBeTruthy();
  });

  it('est déterministe pour une graine donnée', () => {
    const p = params({ preset: 'laser' });
    expect(sfxGenerator.procedural(p, new Rng(7))).toEqual(sfxGenerator.procedural(p, new Rng(7)));
    expect(sfxGenerator.procedural(p, new Rng(7))).not.toEqual(sfxGenerator.procedural(p, new Rng(8)));
  });

  it('rend chaque préréglage en WAV mono valide, non muet, pic ≤ 1, durée ≤ 3 s', async () => {
    for (const preset of SFX_PRESETS) {
      for (const seed of [1, 2]) {
        const spec = sfxGenerator.procedural(params({ preset }), new Rng(seed));
        expect(sfxSpecSchema.safeParse(spec).success).toBe(true);
        const { result, wav } = await renderWav(spec);
        expect(wav.sampleRate).toBe(SFX_SAMPLE_RATE);
        expect(wav.channels).toHaveLength(1);
        const peak = peakOf(wav.channels);
        expect(peak).toBeGreaterThan(0.05);
        expect(peak).toBeLessThanOrEqual(1);
        expect(peak).toBeCloseTo(0.9 * spec.volume, 1);
        expect(result.info.sampleRate).toBe(SFX_SAMPLE_RATE);
        expect(result.info.duration).toBeGreaterThan(0);
        expect(result.info.duration).toBeLessThanOrEqual(SFX_MAX_SECONDS);
        expect(result.files.find((f) => f.role === 'source')?.ext).toBe('json');
      }
    }
  });

  it('déduit la famille d’effet des mots-clés français et anglais', () => {
    expect(detectPreset('Pièce ramassée')).toBe('coin');
    expect(detectPreset('saut du héros')).toBe('jump');
    expect(detectPreset('grosse explosion de baril')).toBe('explosion');
    expect(detectPreset('tir laser')).toBe('laser');
    expect(detectPreset('sort de soin')).toBe('magic');
    expect(detectPreset('la porte grince')).toBe('door');
    expect(detectPreset('bruit de pas sur le gravier')).toBe('step');
    expect(detectPreset('valider dans le menu')).toBe('select');
    expect(detectPreset('Annuler')).toBe('cancel');
    expect(detectPreset('coup d’épée')).toBe('hit');
    expect(detectPreset('power-up')).toBe('powerup');
    expect(detectPreset('notification de dialogue')).toBe('blip');
    expect(detectPreset('quelque chose')).toBeUndefined();
    // « random » + description : un saut monte (glissando positif).
    const spec = sfxGenerator.procedural(params({ prompt: 'un petit saut' }), new Rng(3));
    expect(spec.slide).toBeGreaterThan(0);
    expect(spec.wave).toBe('square');
  });

  it('rend une spec écrite à la main (comme Claude) et respecte la hauteur demandée', async () => {
    const spec = sfxSpecSchema.parse({ wave: 'square', baseFrequency: 440, sustain: 0.3, decay: 0.1 });
    const { wav } = await renderWav(spec);
    const samples = wav.channels[0];
    const quarter = Math.round(SFX_SAMPLE_RATE * 0.25);
    expect(risingCrossings(samples, 0, quarter)).toBeGreaterThanOrEqual(108);
    expect(risingCrossings(samples, 0, quarter)).toBeLessThanOrEqual(112);
  });

  it('coupe le son quand un glissement descend sous la fréquence plancher', () => {
    const base = { ...DEFAULT_SFXR_PARAMS, baseFrequency: 1000, sustain: 1, decay: 1 };
    const full = synthesizeSfxr(base);
    const cut = synthesizeSfxr({ ...base, slide: -8, frequencyLimit: 200 });
    expect(cut.length).toBeLessThan(full.length / 3);
  });

  it('limite la durée à 3 s et produit un bruit déterministe', async () => {
    const spec = sfxSpecSchema.parse({ wave: 'noise', attack: 2, sustain: 2, decay: 3 });
    const { result } = await renderWav(spec);
    expect(result.info.duration).toBeLessThanOrEqual(SFX_MAX_SECONDS);
    const a = synthesizeSfxr({ ...DEFAULT_SFXR_PARAMS, wave: 'noise' }, { seed: 5 });
    const b = synthesizeSfxr({ ...DEFAULT_SFXR_PARAMS, wave: 'noise' }, { seed: 5 });
    expect(a).toEqual(b);
  });

  it('rejette une spec invalide avec un message explicite', () => {
    const tooHigh = sfxSpecSchema.safeParse({ baseFrequency: 300, frequencyLimit: 500 });
    expect(tooHigh.success).toBe(false);
    expect(tooHigh.error?.issues[0].message).toMatch(/frequencyLimit .* inférieure à baseFrequency/);
    expect(sfxSpecSchema.safeParse({ baseFrequency: 99999 }).success).toBe(false);
    expect(sfxSpecSchema.safeParse({ wave: 'guitar' }).success).toBe(false);
    const silent = sfxSpecSchema.safeParse({ attack: 0, sustain: 0, decay: 0 });
    expect(silent.error?.issues[0].message).toMatch(/trop court/);
  });

  it('construit des consignes qui intègrent les paramètres et la spec courante', () => {
    const p = params({ prompt: 'pièce d’or', preset: 'coin' });
    const prompt = sfxGenerator.buildPrompt(p);
    expect(prompt).toContain('pièce d’or');
    expect(prompt).toContain('coin');
    const spec = sfxGenerator.procedural(p, new Rng(1));
    const edit = sfxGenerator.buildEditPrompt(spec, 'plus grave', p);
    expect(edit).toContain('plus grave');
    expect(edit).toContain(JSON.stringify(spec, null, 2));
    expect(sfxGenerator.systemPrompt).toMatch(/baseFrequency/);
  });
});

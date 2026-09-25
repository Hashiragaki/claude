import { hashString, type Rng } from '@forge/core';
import { encodeWav } from '../encode/wav';
import type { GeneratorDefinition, GeneratorResult } from '../types';
import { fadeOut, normalizePeak, round2, trailingSilenceEnd } from './dsp';
import { presetParams, resolvePreset } from './sfx-presets';
import { sfxParamsSchema, sfxSpecSchema, type SfxParams, type SfxSpec } from './sfx-spec';
import { synthesizeSfxr } from './sfxr';

/** Fréquence d'échantillonnage des effets (celle de sfxr). */
export const SFX_SAMPLE_RATE = 44100;
/** Durée maximale d'un effet (s). */
export const SFX_MAX_SECONDS = 3;

const SYSTEM_PROMPT = `You design retro video-game sound effects for the Forge engine. You answer with a JSON "spec" of
parameters for an sfxr-style synthesizer (8x supersampled oscillator -> resonant low-pass -> high-pass -> phaser,
shaped by an attack/sustain/decay envelope). All fields are optional; omitted fields use the defaults shown.

Parameters (physical units):
- wave: "square" (classic 8-bit, default) | "sawtooth" (bright, buzzy) | "sine" (pure, soft) | "triangle" (mellow)
  | "noise" (explosions, hits, steps; baseFrequency then sets the noise grain: 30-150 Hz rumble, 300+ Hz hiss).
- attack (0-2 s, default 0), sustain (0-2 s, default 0.08), decay (0-3 s, default 0.2): envelope stages.
  Total length = attack + sustain + decay (capped at 3 s). Most game sounds are 0.1-0.6 s long.
- punch (0-1): extra loudness at the start of the sustain, gives impact (coins, hits, explosions: 0.3-0.7).
- baseFrequency (20-5000 Hz, default 440): starting pitch. 700-1600 Hz for coins/blips, 200-600 for jumps.
- frequencyLimit (0-5000 Hz): the sound stops when a downward slide passes below it (0 = none). Must be lower
  than baseFrequency.
- slide (-40..40 octaves/s): pitch glide. Lasers -4..-20, hits -12..-40, jumps +1.5..+5, power-ups +1..+12.
- deltaSlide (-200..200 octaves/s^2): acceleration of the slide (rarely needed).
- vibratoDepth (0-12 semitones) and vibratoSpeed (0-50 Hz): pitch wobble (0.3-2 semitones at 6-15 Hz).
- arpeggio (-24..24 semitones) after arpeggioDelay (0-2 s): a single pitch jump. Coins: +5, +7 or +12 after
  0.04-0.09 s. Menu cancel: -5 or -7.
- duty (0.02-0.5, default 0.5) and dutySweep (-2..2 per s): square pulse width; 0.125-0.25 sounds nasal.
- repeatInterval (0-2 s): restarts pitch, slide and arpeggio every N seconds (trills, sirens, sparkles).
- phaserOffset (-1..1) and phaserSweep (-1..1): comb/phaser colour (0 = off). 0.1-0.4 adds a swoosh.
- lowPassCutoff (50-22050 Hz, >= 20000 = off), lowPassSweep (-20..20 octaves/s), lowPassResonance (0-1).
  Darken explosions and soft sounds (1000-4000 Hz), sweep down for a fading boom.
- highPassCutoff (0-5000 Hz, 0 = off), highPassSweep (-20..20 octaves/s): thins the sound (80-800 Hz).
- volume (0.1-1, default 1): the rendered peak is normalized to 0.9 x volume. Use 0.6-0.8 for subtle UI/steps.

Recipes:
- coin: square, 900-1400 Hz, sustain 0.05, decay 0.3, punch 0.5, arpeggio +7 after 0.06 s.
- laser: square or sawtooth, 1500-2500 Hz, slide -10, frequencyLimit 100, duty 0.25, decay 0.2.
- explosion: noise, 60-200 Hz, slide -1, sustain 0.25, decay 0.8, punch 0.6, lowPassCutoff 3000, lowPassSweep -2.
- jump: square, 350 Hz, slide +3, sustain 0.1, decay 0.15. hit: noise or square, 500 Hz, slide -25, decay 0.15.
- power-up: square, 400 Hz, slide +8, repeatInterval 0.12. step: noise, 250 Hz, decay 0.06, lowPassCutoff 2000.
- magic/heal: triangle or sine, 600 Hz, slide +2, vibratoDepth 1, vibratoSpeed 8, sustain 0.3, decay 0.5.

Example spec (coin pickup):
{"wave":"square","baseFrequency":1046,"sustain":0.05,"decay":0.3,"punch":0.5,"arpeggio":7,"arpeggioDelay":0.06}

Keep sounds short, clean and readable in a game mix; avoid harsh high frequencies for sounds that repeat often.`;

function presetHint(params: SfxParams): string {
  return params.preset === 'random' ? '' : `\nSound family: ${params.preset}.`;
}

function buildPrompt(params: SfxParams): string {
  const what = params.prompt.trim() || 'a short, pleasant retro sound effect that fits a game';
  return `Design this sound effect: ${what}${presetHint(params)}\nReturn the complete spec.`;
}

function buildEditPrompt(spec: SfxSpec, instruction: string, params: SfxParams): string {
  const context = params.prompt.trim() ? `\nOriginal request: ${params.prompt.trim()}` : '';
  return (
    `Current sound effect spec:\n${JSON.stringify(spec, null, 2)}${context}${presetHint(params)}\n\n` +
    `Modify it according to this instruction: ${instruction}\n` +
    'Keep every parameter the instruction does not concern, and return the complete modified spec.'
  );
}

function procedural(params: SfxParams, rng: Rng): SfxSpec {
  const preset = resolvePreset(params.preset, params.prompt, rng);
  const raw = presetParams(preset, params.prompt, rng.fork(preset));
  const rounded = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]),
  );
  return sfxSpecSchema.parse(rounded);
}

/** Rend une spec en échantillons mono prêts à encoder (silence final coupé, pic normalisé). */
export function renderSfxSamples(spec: SfxSpec): Float32Array {
  const seed = hashString(JSON.stringify(spec));
  const raw = synthesizeSfxr(spec, { sampleRate: SFX_SAMPLE_RATE, maxSeconds: SFX_MAX_SECONDS, seed });
  const end = trailingSilenceEnd(raw, SFX_SAMPLE_RATE);
  const samples = raw.slice(0, end);
  const naturalEnd = spec.attack + spec.sustain + spec.decay;
  if (naturalEnd > SFX_MAX_SECONDS && end >= raw.length - 1) fadeOut(samples, Math.round(SFX_SAMPLE_RATE * 0.05));
  normalizePeak(samples, 0.9 * spec.volume);
  return samples;
}

async function render(spec: SfxSpec): Promise<GeneratorResult> {
  const parsed = sfxSpecSchema.parse(spec);
  const samples = renderSfxSamples(parsed);
  return {
    files: [
      { role: 'main', ext: 'wav', mime: 'audio/wav', data: encodeWav(samples, SFX_SAMPLE_RATE) },
      { role: 'source', ext: 'json', mime: 'application/json', data: JSON.stringify(parsed, null, 2) },
    ],
    info: { duration: round2(samples.length / SFX_SAMPLE_RATE), sampleRate: SFX_SAMPLE_RATE },
  };
}

/** Effets sonores rétro (synthèse façon sfxr). */
export const sfxGenerator: GeneratorDefinition<SfxParams, SfxSpec> = {
  id: 'sfx',
  kind: 'sfx',
  label: 'Effet sonore',
  description: 'Bruitages rétro synthétisés (pièce, saut, laser, explosion, menu…) exportés en WAV.',
  paramsSchema: sfxParamsSchema,
  specSchema: sfxSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt,
  buildEditPrompt,
  procedural,
  render,
};

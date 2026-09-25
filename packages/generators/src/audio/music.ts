import type { Rng } from '@forge/core';
import { encodeWav } from '../encode/wav';
import type { GeneratorDefinition, GeneratorResult } from '../types';
import { composeMusic, resolveMood } from './composer';
import { round2 } from './dsp';
import { MUSIC_MAX_SECONDS, musicParamsSchema, musicSpecSchema, type MusicParams, type MusicSpec } from './music-spec';
import { MUSIC_SAMPLE_RATE, renderSong } from './song';

const SYSTEM_PROMPT = `You compose short looping game music (chiptune / soft synth) for the Forge engine.
You answer with a compact JSON "spec" that an offline synthesizer renders to a stereo WAV.

Spec format:
- bpm (40-240), stepsPerBeat (default 4: one step = a sixteenth note), beatsPerBar (default 4; 3 for a waltz),
  bars (number of bars in the song), key (informative, e.g. "D dorian"), tracks (1 to 8).
- Duration = bars * beatsPerBar * 60 / bpm seconds and must stay <= ${MUSIC_MAX_SECONDS} s.
- Each track: { name, instrument, volume (0-1, default 0.7), pan (-1 left .. 1 right, optional), notes }.
- instrument: "square" (bright 8-bit lead), "pulse25" (thinner, nasal lead or arpeggio), "triangle" (soft bass or
  flute-like lead), "sawtooth" (bright, heroic lead), "sine" (pure, gentle lead), "noise" (pitched noise, rarely
  useful), "pad" (slow, lush detuned chords), "pluck" (harp / guitar-like plucked string), "bass" (filtered synth
  bass), "drums" (drum kit, see below).

notes: space-separated tokens, each lasting ":n" steps (default 1 step):
- note: C4:4 (C in octave 4 = middle C, 4 steps). Sharps/flats: F#3, Bb2. Octaves 0-8.
- chord: C4+E4+G4:16 (notes played together).
- rest: R:8.
- "|" is ignored and may separate bars for readability.
- drums tracks only: K kick, S snare, H closed hi-hat, O open hi-hat, C crash cymbal, T tom, R rest; combine with +
  ("K+H:2 H:2 S+H:2 H:2" = two beats: kick+hat, hat, snare+hat, hat). Never put notes in a drums track.
- A track shorter than the song loops to fill it (write one or two bars of drums and let them repeat); a longer
  track is cut. In 4/4 with stepsPerBeat 4, one bar = 16 steps: make every track's total a multiple of 16.

Musical guidance:
- Pick a key and mode that fit the mood (major = bright, mixolydian = folk, dorian = mysterious/cool,
  minor = sad/epic, harmonic minor = tense/battle, phrygian = dark). Write a chord progression (one chord per bar
  is typical: I-V-vi-IV, i-bVI-bIII-bVII, i-iv-V-i...) and make the last bar lead back to the first so the loop
  is seamless.
- Typical layers: bass (roots and fifths, octave 2, e.g. A2:8 E2:8), harmony (pad chords in octave 3-4, or pluck/
  pulse25 arpeggios in octave 4-5), a lead melody (octave 4-6) and optional drums.
- Melodies: a short motif (1-2 bars) that repeats with variations, mostly stepwise motion with a few leaps, strong
  beats on chord tones, phrases ending on long chord tones; leave some rests to breathe.
- Moods: calm/sad/mysterious = slow (60-90 bpm), no or very light drums, pad + pluck; happy/village = 100-140 bpm,
  light drums, bouncy bass; epic/battle = 110-170 bpm, driving drums, octave bass, fast arpeggios.
- Balance volumes: lead 0.6, pad 0.4, arpeggio 0.3, bass 0.65, drums 0.5-0.65.

Example (2-bar loop, 4/4, stepsPerBeat 4):
{"bpm":100,"bars":2,"key":"C major","tracks":[
 {"name":"lead","instrument":"square","volume":0.6,"notes":"E5:4 G5:2 E5:2 D5:4 C5:4 | D5:4 B4:2 C5:2 D5:8"},
 {"name":"chords","instrument":"pad","volume":0.4,"notes":"C4+E4+G4:16 | B3+D4+G4:16"},
 {"name":"bass","instrument":"bass","volume":0.65,"notes":"C3:8 G2:8 | G2:8 D3:8"},
 {"name":"drums","instrument":"drums","volume":0.55,"notes":"K+H:2 H:2 S+H:2 H:2 K+H:2 K+H:2 S+H:2 H:2"}]}`;

function describeParams(params: MusicParams): string {
  const lines = [`Mood: ${resolveMood(params)}.`, `Length: ${params.bars} bars.`];
  if (params.bpm) lines.push(`Tempo: ${params.bpm} bpm.`);
  lines.push(params.loop ? 'It must loop seamlessly.' : 'It does not need to loop; give it a clear ending.');
  return lines.join('\n');
}

function buildPrompt(params: MusicParams): string {
  const what = params.prompt.trim() || 'background music for a game scene';
  return `Compose this music: ${what}\n${describeParams(params)}\nReturn the complete spec.`;
}

function buildEditPrompt(spec: MusicSpec, instruction: string, params: MusicParams): string {
  const context = params.prompt.trim() ? `Original request: ${params.prompt.trim()}\n` : '';
  return (
    `Current music spec:\n${JSON.stringify(spec, null, 2)}\n\n${context}${describeParams(params)}\n\n` +
    `Modify it according to this instruction: ${instruction}\n` +
    'Keep the parts the instruction does not concern, and return the complete modified spec.'
  );
}

function procedural(params: MusicParams, rng: Rng): MusicSpec {
  // Dérivation : des graines voisines (1, 2, 3…) donnent des morceaux bien distincts.
  return musicSpecSchema.parse(composeMusic(params, rng.fork('music')));
}

async function render(spec: MusicSpec, params: MusicParams): Promise<GeneratorResult> {
  const parsed = musicSpecSchema.parse(spec);
  const loop = params?.loop ?? true;
  const song = renderSong(parsed, { loop, sampleRate: MUSIC_SAMPLE_RATE });
  return {
    files: [
      { role: 'main', ext: 'wav', mime: 'audio/wav', data: encodeWav([song.left, song.right], song.sampleRate) },
      { role: 'source', ext: 'json', mime: 'application/json', data: JSON.stringify(parsed, null, 2) },
    ],
    info: {
      duration: round2(song.left.length / song.sampleRate),
      bpm: parsed.bpm,
      bars: parsed.bars,
      sampleRate: song.sampleRate,
      loop,
    },
  };
}

/** Musiques en boucle (chiptune / synthé doux) composées par Claude ou procéduralement. */
export const musicGenerator: GeneratorDefinition<MusicParams, MusicSpec> = {
  id: 'music',
  kind: 'music',
  label: 'Musique',
  description: 'Boucles musicales chiptune ou synthé doux selon une ambiance, exportées en WAV stéréo.',
  paramsSchema: musicParamsSchema,
  specSchema: musicSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt,
  buildEditPrompt,
  procedural,
  render,
};

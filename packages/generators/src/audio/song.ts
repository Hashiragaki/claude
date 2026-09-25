import { hashString } from '@forge/core';
import { fadeOut, softClip, trailingSilenceEnd } from './dsp';
import type { MusicSpec, MusicTrack } from './music-spec';
import { parseDrumTrack, parsePitchedTrack } from './notes';
import { renderReverb } from './reverb';
import { midiToFrequency, renderDrum, renderVoice, REVERB_SEND, type VoiceContext } from './synth';

/**
 * Fréquence d'échantillonnage de la musique : 32 kHz. La musique chiptune / synthé a peu de contenu
 * utile au-delà de 14 kHz, et 32 kHz réduit d'environ 27 % la taille des WAV (jusqu'à 90 s en stéréo)
 * et le temps de rendu par rapport à 44,1 kHz. Tous les navigateurs décodent ce format.
 */
export const MUSIC_SAMPLE_RATE = 32000;

/** Durée maximale de la queue ajoutée en fin de morceau non bouclé (s). */
const TAIL_SECONDS = 2.5;
/** Niveau de retour de la réverbération dans le mix. */
const REVERB_WET = 1.1;

export interface RenderSongOptions {
  /** Boucle sans couture (longueur exacte des mesures, queues repliées au début). */
  loop?: boolean;
  sampleRate?: number;
}

export interface RenderedSong {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Longueur musicale exacte (échantillons) : `bars` mesures. */
  loopLength: number;
}

/** Gains gauche / droite à puissance constante. */
function panGains(pan: number): [number, number] {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(angle) * Math.SQRT2, Math.sin(angle) * Math.SQRT2];
}

/** Accentuation selon la position dans la mesure (temps forts plus appuyés). */
function accent(step: number, stepsPerBeat: number, stepsPerBar: number): number {
  const pos = step % stepsPerBar;
  if (pos === 0) return 1;
  if (pos % stepsPerBeat === 0) return 0.92;
  return 0.8;
}

/** Rend une piste (mono) en répétant ses évènements pour couvrir `totalSteps`. */
function renderTrack(
  track: MusicTrack,
  index: number,
  spec: MusicSpec,
  out: Float32Array,
  stepSamples: number,
  totalSteps: number,
  sampleRate: number,
  wrap: boolean,
): void {
  const stepsPerBar = spec.stepsPerBeat * spec.beatsPerBar;
  const seedBase = hashString(`${index}:${track.name}`);
  const isDrums = track.instrument === 'drums';
  const parsed = isDrums ? parseDrumTrack(track.notes) : parsePitchedTrack(track.notes);
  if (parsed.totalSteps === 0) return;
  let n = 0;
  for (let offset = 0; offset < totalSteps; offset += parsed.totalSteps) {
    for (const ev of parsed.events) {
      const step = offset + ev.step;
      if (step >= totalSteps) break;
      const length = Math.min(ev.length, totalSteps - step);
      const start = Math.round(step * stepSamples);
      const ctx: VoiceContext = {
        out,
        start,
        gate: Math.max(1, Math.round((step + length) * stepSamples) - start),
        frequency: 0,
        velocity: accent(step, spec.stepsPerBeat, stepsPerBar),
        sampleRate,
        wrap,
        seed: 0,
      };
      if ('hits' in ev) {
        for (const hit of ev.hits) renderDrum(hit, { ...ctx, seed: seedBase + n++ });
      } else if (track.instrument !== 'drums') {
        const chordGain = 1 / Math.sqrt(ev.pitches.length);
        for (const pitch of ev.pitches) {
          renderVoice(track.instrument, {
            ...ctx,
            frequency: midiToFrequency(pitch),
            velocity: ctx.velocity * chordGain,
            seed: seedBase + n++,
          });
        }
      }
    }
  }
}

/** Rend un morceau complet en stéréo (flottants, pic ≈ 0,9 après saturation douce). */
export function renderSong(spec: MusicSpec, options: RenderSongOptions = {}): RenderedSong {
  const sampleRate = options.sampleRate ?? MUSIC_SAMPLE_RATE;
  const loop = options.loop ?? true;
  const totalSteps = spec.bars * spec.beatsPerBar * spec.stepsPerBeat;
  const stepSamples = (sampleRate * 60) / (spec.bpm * spec.stepsPerBeat);
  const loopLength = Math.round(totalSteps * stepSamples);
  const length = loop ? loopLength : loopLength + Math.round(TAIL_SECONDS * sampleRate);

  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const send = new Float32Array(length);
  const mono = new Float32Array(length);
  spec.tracks.forEach((track, index) => {
    mono.fill(0);
    renderTrack(track, index, spec, mono, stepSamples, totalSteps, sampleRate, loop);
    const [gl, gr] = panGains(track.pan ?? 0);
    const vol = track.volume;
    const sendLevel = REVERB_SEND[track.instrument] * vol;
    for (let i = 0; i < length; i++) {
      const s = mono[i];
      left[i] += s * vol * gl;
      right[i] += s * vol * gr;
      send[i] += s * sendLevel;
    }
  });

  const wet = renderReverb(send, sampleRate, { loop, room: 0.78, damping: 0.5 });
  for (let i = 0; i < length; i++) {
    left[i] += wet.left[i] * REVERB_WET;
    right[i] += wet.right[i] * REVERB_WET;
  }
  softClip([left, right], 0.9);

  if (loop) return { left, right, sampleRate, loopLength };
  const end = Math.max(loopLength, trailingSilenceEnd([left, right], sampleRate));
  const l = left.slice(0, end);
  const r = right.slice(0, end);
  const fade = Math.min(end - loopLength, Math.round(0.3 * sampleRate));
  if (fade > 0) {
    fadeOut(l, fade);
    fadeOut(r, fade);
  }
  return { left: l, right: r, sampleRate, loopLength };
}

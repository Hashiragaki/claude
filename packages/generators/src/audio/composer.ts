import type { Rng } from '@forge/core';
import {
  composeBass,
  composeDrums,
  composeHarmony,
  composeMelody,
  type BassStyle,
  type Density,
  type DrumStyle,
  type HarmonyStyle,
  type SongPlan,
} from './composer-parts';
import { matchKeywords } from './keywords';
import {
  MUSIC_MAX_SECONDS,
  type Instrument,
  type Mood,
  type MusicParams,
  type MusicSpec,
  type MusicTrack,
} from './music-spec';
import { formatTokens, type TokenEvent } from './notes';
import type { PitchedInstrument } from './synth';
import { adaptScale, KEY_NAMES, parseRoman, SCALE_LABELS, SCALES, type ScaleName } from './theory';

/**
 * Composition procédurale par ambiance : tonalité et mode, grille d'accords (un accord par mesure,
 * la dernière mesure garde l'accord de retour pour boucler), basse, couches harmoniques, mélodie à
 * motifs et batterie. Le résultat est une spec ordinaire, rendue ensuite comme celles de Claude.
 */

interface MoodProfile {
  bpm: [number, number];
  /** Toniques possibles (classes de hauteur, 0 = do). */
  roots: number[];
  harmony: { scale: ScaleName; progressions: string[][] }[];
  lead: PitchedInstrument[];
  /** Hauteur MIDI centrale de la mélodie (72 = C5). */
  leadCenter: number;
  density: Density[];
  layers: HarmonyStyle[][];
  layerInstrument: PitchedInstrument[];
  bass: PitchedInstrument[];
  bassStyles: BassStyle[];
  drums: (DrumStyle | null)[];
  /** Probabilité d'une mesure à 3 temps (valse). */
  waltz?: number;
}

const MINOR_ROOTS = [9, 4, 2, 11, 7];
const MAJOR_ROOTS = [0, 2, 5, 7, 10];

export const MOOD_PROFILES: Record<Mood, MoodProfile> = {
  calm: {
    bpm: [72, 90],
    roots: MAJOR_ROOTS,
    harmony: [
      {
        scale: 'major',
        progressions: [
          ['I', 'V', 'vi', 'IV'],
          ['Imaj7', 'IVmaj7', 'Imaj7', 'IVmaj7'],
          ['I', 'iii', 'IV', 'V'],
          ['IV', 'I', 'V', 'vi'],
        ],
      },
      {
        scale: 'lydian',
        progressions: [
          ['Imaj7', 'II', 'Imaj7', 'II'],
          ['I', 'II', 'vii', 'II'],
        ],
      },
    ],
    lead: ['sine', 'triangle', 'pluck'],
    leadCenter: 74,
    density: ['sparse', 'medium'],
    layers: [['pad', 'broken'], ['pad'], ['broken']],
    layerInstrument: ['pluck'],
    bass: ['triangle'],
    bassStyles: ['long', 'rootFifth'],
    drums: [null],
  },
  happy: {
    bpm: [112, 138],
    roots: MAJOR_ROOTS,
    harmony: [
      {
        scale: 'major',
        progressions: [
          ['I', 'V', 'vi', 'IV'],
          ['I', 'IV', 'V', 'IV'],
          ['I', 'vi', 'IV', 'V'],
          ['I', 'IV', 'I', 'V'],
          ['I', 'iii', 'IV', 'V'],
        ],
      },
    ],
    lead: ['square', 'pulse25'],
    leadCenter: 74,
    density: ['medium', 'busy'],
    layers: [['arp'], ['stabs']],
    layerInstrument: ['pulse25', 'pluck'],
    bass: ['triangle', 'bass'],
    bassStyles: ['walk', 'rootFifth', 'eighths'],
    drums: ['pop'],
  },
  tense: {
    bpm: [96, 120],
    roots: MINOR_ROOTS,
    harmony: [
      {
        scale: 'harmonicMinor',
        progressions: [
          ['i', 'i', 'bII', 'V'],
          ['i', 'bVI', 'V', 'V'],
          ['i', 'iv', 'V', 'i'],
        ],
      },
      {
        scale: 'phrygian',
        progressions: [
          ['i', 'bII', 'i', 'bII'],
          ['i', 'bII', 'bVII', 'i'],
        ],
      },
    ],
    lead: ['sawtooth', 'square'],
    leadCenter: 67,
    density: ['sparse'],
    layers: [['pad', 'fastArp'], ['pad']],
    layerInstrument: ['pulse25', 'pluck'],
    bass: ['bass'],
    bassStyles: ['eighths'],
    drums: ['tense'],
  },
  sad: {
    bpm: [62, 78],
    roots: MINOR_ROOTS,
    harmony: [
      {
        scale: 'minor',
        progressions: [
          ['i', 'bVI', 'bIII', 'bVII'],
          ['i', 'iv', 'bVI', 'V'],
          ['i', 'bVII', 'bVI', 'V'],
          ['i', 'bVI', 'iv', 'V'],
          ['i', 'v', 'bVI', 'iv'],
        ],
      },
    ],
    lead: ['sine', 'triangle', 'pluck'],
    leadCenter: 72,
    density: ['sparse'],
    layers: [['pad', 'broken'], ['pad']],
    layerInstrument: ['pluck'],
    bass: ['triangle'],
    bassStyles: ['long'],
    drums: [null],
  },
  epic: {
    bpm: [100, 126],
    roots: MINOR_ROOTS,
    harmony: [
      {
        scale: 'minor',
        progressions: [
          ['i', 'bVI', 'bIII', 'bVII'],
          ['i', 'bVI', 'bVII', 'i'],
          ['i', 'bVII', 'bVI', 'bVII'],
        ],
      },
      {
        scale: 'harmonicMinor',
        progressions: [
          ['i', 'bVI', 'iv', 'V'],
          ['i', 'iv', 'bVI', 'V'],
        ],
      },
    ],
    lead: ['sawtooth', 'square'],
    leadCenter: 72,
    density: ['medium'],
    layers: [
      ['pad', 'arp'],
      ['pad', 'fastArp'],
    ],
    layerInstrument: ['pulse25'],
    bass: ['bass'],
    bassStyles: ['eighths'],
    drums: ['driving'],
  },
  mysterious: {
    bpm: [70, 92],
    roots: MINOR_ROOTS,
    harmony: [
      {
        scale: 'dorian',
        progressions: [
          ['i', 'IV', 'i', 'IV'],
          ['i', 'bVII', 'IV', 'i'],
          ['i', 'ii', 'bVII', 'i'],
        ],
      },
      {
        scale: 'harmonicMinor',
        progressions: [
          ['i', 'bVI', 'V', 'V'],
          ['i', 'iv', 'V', 'bVI'],
        ],
      },
    ],
    lead: ['sine', 'pluck', 'triangle'],
    leadCenter: 72,
    density: ['sparse'],
    layers: [['pad', 'broken'], ['pad']],
    layerInstrument: ['pluck'],
    bass: ['triangle'],
    bassStyles: ['long', 'rootFifth'],
    drums: ['light', null],
  },
  battle: {
    bpm: [140, 166],
    roots: MINOR_ROOTS,
    harmony: [
      {
        scale: 'harmonicMinor',
        progressions: [
          ['i', 'bVI', 'bVII', 'V'],
          ['i', 'bVI', 'bIII', 'V'],
          ['i', 'iv', 'V', 'i'],
          ['i', 'bII', 'i', 'V'],
        ],
      },
      { scale: 'minor', progressions: [['i', 'bVII', 'bVI', 'bVII']] },
    ],
    lead: ['square', 'pulse25'],
    leadCenter: 74,
    density: ['busy'],
    layers: [['fastArp'], ['fastArp', 'pad']],
    layerInstrument: ['pulse25'],
    bass: ['bass'],
    bassStyles: ['octaves'],
    drums: ['battle'],
  },
  village: {
    bpm: [96, 118],
    roots: MAJOR_ROOTS,
    harmony: [
      {
        scale: 'major',
        progressions: [
          ['I', 'IV', 'V', 'I'],
          ['I', 'V', 'IV', 'V'],
          ['I', 'IV', 'I', 'V'],
          ['I', 'vi', 'IV', 'V'],
        ],
      },
      {
        scale: 'mixolydian',
        progressions: [
          ['I', 'bVII', 'IV', 'I'],
          ['I', 'bVII', 'I', 'V'],
        ],
      },
    ],
    lead: ['pulse25', 'square', 'pluck'],
    leadCenter: 74,
    density: ['medium'],
    layers: [['stabs']],
    layerInstrument: ['pluck'],
    bass: ['triangle'],
    bassStyles: ['rootFifth', 'walk'],
    drums: ['village'],
    waltz: 0.4,
  },
};

/** Mots-clés d'ambiance (FR / EN) reconnus dans la description. */
const MOOD_KEYWORDS: Record<Mood, readonly string[]> = {
  battle: ['combat', 'bataille', 'battle', 'boss', 'fight', 'duel', 'ennemi', 'enemy', 'guerre'],
  epic: ['epique', 'epic', 'heroique', 'heroic', 'aventure', 'adventure', 'grandiose', 'quete', 'quest'],
  tense: ['tension', 'tendu', 'tense', 'suspense', 'danger', 'poursuite', 'chase', 'stress', 'infiltration'],
  sad: ['triste', 'sad', 'melancolie', 'melancolique', 'melancholy', 'deuil', 'larmes', 'tears', 'nostalgie'],
  mysterious: ['mystere', 'mysterieux', 'mysterious', 'mystery', 'grotte', 'cave', 'donjon', 'dungeon', 'magie'],
  village: ['village', 'town', 'ville', 'taverne', 'tavern', 'auberge', 'marche', 'market', 'ferme', 'farm'],
  happy: ['joyeux', 'joyeuse', 'happy', 'gai', 'gaie', 'fete', 'party', 'allegre', 'cheerful', 'victoire'],
  calm: ['calme', 'calm', 'paisible', 'peaceful', 'doux', 'relax', 'repos', 'foret', 'forest', 'reve'],
};

/**
 * Ambiance effective : celle des paramètres, sauf si elle vaut la valeur par défaut (`calm`) et que
 * la description évoque clairement une autre ambiance (« musique de combat de boss »).
 */
export function resolveMood(params: MusicParams): Mood {
  if (params.mood !== 'calm') return params.mood;
  return matchKeywords(params.prompt, MOOD_KEYWORDS) ?? 'calm';
}

/** Réduit les évènements à la plus courte période (en mesures) qui se répète à l'identique. */
function compressLoop(events: TokenEvent[], stepsPerBar: number, bars: number): { events: TokenEvent[]; bars: number } {
  const key = (e: TokenEvent, period: number) => `${e.step % period}:${e.length}:${e.body}`;
  for (let p = 1; p < bars; p++) {
    if (bars % p) continue;
    const period = p * stepsPerBar;
    const head = events.filter((e) => e.step < period);
    if (head.some((e) => e.step + e.length > period)) continue;
    const pattern = new Set(head.map((e) => key(e, period)));
    if (events.length === head.length * (bars / p) && events.every((e) => pattern.has(key(e, period)))) {
      return { events: head, bars: p };
    }
  }
  return { events, bars };
}

function track(
  name: string,
  instrument: Instrument,
  volume: number,
  pan: number,
  events: TokenEvent[],
  plan: SongPlan,
): MusicTrack {
  const compact = compressLoop(events, plan.stepsPerBar, plan.bars);
  const out: MusicTrack = {
    name,
    instrument,
    volume,
    notes: formatTokens(compact.events, compact.bars * plan.stepsPerBar),
  };
  if (pan) out.pan = pan;
  return out;
}

/** Compose un morceau complet pour les paramètres donnés. */
export function composeMusic(params: MusicParams, rng: Rng): MusicSpec {
  const mood = resolveMood(params);
  const profile = MOOD_PROFILES[mood];
  const bpm = params.bpm ?? rng.int(profile.bpm[0], profile.bpm[1]);
  const beatsPerBar = profile.waltz && rng.bool(profile.waltz) ? 3 : 4;
  const stepsPerBeat = 4;
  // Respecte la durée maximale en retirant des mesures (par paires) si besoin.
  const maxBars = Math.floor((MUSIC_MAX_SECONDS * bpm) / 60 / beatsPerBar);
  const bars = Math.max(1, Math.min(params.bars, maxBars - (maxBars % 2)));

  const tonicPc = rng.pick(profile.roots);
  const harmony = rng.pick(profile.harmony);
  const progression = rng.pick(harmony.progressions).map(parseRoman);
  const chords = Array.from({ length: bars }, (_, b) =>
    b === bars - 1 ? progression[progression.length - 1] : progression[b % progression.length],
  );
  const scale = SCALES[harmony.scale];
  const plan: SongPlan = {
    tonic: 60 + tonicPc,
    chords,
    scales: chords.map((c) => adaptScale(scale, c)),
    bars,
    beatsPerBar,
    stepsPerBeat,
    stepsPerBar: beatsPerBar * stepsPerBeat,
  };

  const tracks: MusicTrack[] = [];
  const lead = rng.pick(profile.lead);
  const melody = composeMelody(rng.fork('melody'), plan, rng.pick(profile.density), profile.leadCenter);
  tracks.push(track('mélodie', lead, lead === 'pluck' ? 0.75 : 0.62, 0.1, melody, plan));

  const layers = beatsPerBar === 3 ? (['waltz'] as HarmonyStyle[]) : rng.pick(profile.layers);
  const layerInstrument = rng.pick(profile.layerInstrument);
  for (const style of layers) {
    const events = composeHarmony(rng.fork(style), plan, style);
    if (style === 'pad') {
      tracks.push(track('nappe', 'pad', 0.42, 0, events, plan));
      continue;
    }
    const name = style === 'stabs' || style === 'waltz' ? 'accords' : 'arpège';
    const volume = layerInstrument === 'pluck' ? 0.45 : style === 'fastArp' ? 0.26 : 0.3;
    tracks.push(track(name, layerInstrument, volume, -0.35, events, plan));
  }

  const bassStyle = beatsPerBar === 3 ? 'waltz' : rng.pick(profile.bassStyles);
  const bass = rng.pick(profile.bass);
  tracks.push(track('basse', bass, bass === 'triangle' ? 0.7 : 0.62, 0, composeBass(plan, bassStyle), plan));

  const drums = rng.pick(profile.drums);
  if (drums) {
    const volume = drums === 'light' ? 0.3 : drums === 'village' || drums === 'tense' ? 0.5 : 0.62;
    tracks.push(track('batterie', 'drums', volume, 0, composeDrums(plan, drums), plan));
  }

  return {
    bpm,
    stepsPerBeat,
    beatsPerBar,
    bars,
    key: `${KEY_NAMES[tonicPc]} ${SCALE_LABELS[harmony.scale]}`,
    tracks,
  };
}

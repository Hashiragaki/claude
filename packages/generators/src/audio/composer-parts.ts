import type { Rng } from '@forge/core';
import type { DrumHit, TokenEvent } from './notes';
import { pitchesToBody } from './notes';
import {
  chordPitchClasses,
  degreeToMidi,
  nearestChordDegree,
  placeInRange,
  voiceChord,
  type Chord,
} from './theory';

/**
 * Écriture des parties d'un morceau procédural : mélodie (motifs répétés et variés), basse, couches
 * harmoniques (nappe, arpèges, contretemps, valse) et batterie. Toutes les durées sont en pas.
 */

export type Density = 'sparse' | 'medium' | 'busy';
export type BassStyle = 'long' | 'rootFifth' | 'eighths' | 'octaves' | 'walk' | 'waltz';
export type HarmonyStyle = 'pad' | 'arp' | 'fastArp' | 'broken' | 'stabs' | 'waltz';
export type DrumStyle = 'pop' | 'driving' | 'battle' | 'tense' | 'village' | 'light';

/** Contexte harmonique commun à toutes les parties. */
export interface SongPlan {
  /** Tonique MIDI de référence (octave 4). */
  tonic: number;
  /** Accord de chaque mesure. */
  chords: Chord[];
  /** Gamme (adaptée à l'accord) de chaque mesure. */
  scales: number[][];
  bars: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  stepsPerBar: number;
}

// ---------------------------------------------------------------------------------------------
// Mélodie
// ---------------------------------------------------------------------------------------------

interface Cell {
  /** Position dans le motif (pas). */
  step: number;
  length: number;
  rest: boolean;
}

/** Cellules rythmiques d'un temps et de deux temps (négatif = silence), pour 4 pas par temps. */
const ONE_BEAT: Record<Density, number[][]> = {
  sparse: [[4], [4], [-4], [3, 1]],
  medium: [[4], [2, 2], [3, 1], [-2, 2], [4]],
  busy: [[2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1], [2, 2]],
};
const TWO_BEATS: Record<Density, number[][]> = {
  sparse: [[8], [6, 2], [4, 4], [-4, 4], [8], [4, -4]],
  medium: [[4, 4], [6, 2], [2, 2, 4], [4, 2, 2], [3, 3, 2], [8]],
  busy: [[2, 2, 2, 2], [3, 3, 2], [2, 2, 4], [1, 1, 2, 2, 2], [4, 2, 2], [2, 1, 1, 4]],
};
/** Mesures de cadence : notes plus longues, la dernière tenue. */
const CADENCE: Record<number, number[][]> = {
  3: [[4, 8], [2, 2, 8], [12], [4, 4, 4]],
  4: [[4, 4, 8], [2, 2, 4, 8], [8, 4, -4], [4, 12], [6, 2, 8]],
};

function cellsFromDurations(durations: number[], start: number): Cell[] {
  const cells: Cell[] = [];
  let step = start;
  for (const d of durations) {
    cells.push({ step, length: Math.abs(d), rest: d < 0 });
    step += Math.abs(d);
  }
  return cells;
}

function barRhythm(rng: Rng, density: Density, beatsPerBar: number, start: number): Cell[] {
  const durations: number[] = [];
  let beats = beatsPerBar;
  while (beats > 0) {
    if (beats >= 2 && rng.bool(0.65)) {
      durations.push(...rng.pick(TWO_BEATS[density]));
      beats -= 2;
    } else {
      durations.push(...rng.pick(ONE_BEAT[density]));
      beats -= 1;
    }
  }
  // Une mesure qui commence par un silence garde au moins une note.
  if (durations.every((d) => d < 0)) durations[durations.length - 1] *= -1;
  return cellsFromDurations(durations, start);
}

function cadenceRhythm(rng: Rng, beatsPerBar: number, start: number): Cell[] {
  const options = CADENCE[beatsPerBar] ?? [[beatsPerBar * 4]];
  return cellsFromDurations(rng.pick(options), start);
}

/** Pas mélodique aléatoire : surtout conjoint, un saut est suivi d'un retour en sens inverse. */
function randomMove(rng: Rng, previous: number): number {
  if (Math.abs(previous) >= 3) return -Math.sign(previous) * rng.pick([1, 1, 2]);
  return rng.weighted([-2, -1, 0, 1, 2, -3, 3, -4, 4], [12, 28, 7, 28, 12, 3, 4, 2, 3]);
}

interface Motif {
  cells: Cell[];
  moves: number[];
}

function makeMotif(rng: Rng, density: Density, plan: SongPlan, bars: number): Motif {
  const cells: Cell[] = [];
  for (let b = 0; b < bars; b++) cells.push(...barRhythm(rng, density, plan.beatsPerBar, b * plan.stepsPerBar));
  let prev = 0;
  const moves = cells.map(() => (prev = randomMove(rng, prev)));
  return { cells, moves };
}

interface Realized {
  events: TokenEvent[];
  first: number;
  last: number;
}

/**
 * Pose un motif sur les accords à partir de la mesure `bar`. Les notes des temps forts et les notes
 * longues se calent sur l'accord ; la dernière note d'une cadence finit sur la fondamentale ou la tierce.
 */
function realize(
  plan: SongPlan,
  cells: Cell[],
  moves: number[],
  bar: number,
  start: number,
  range: [number, number],
  cadence: boolean,
): Realized {
  const events: TokenEvent[] = [];
  let degree = start;
  let first = start;
  let noteIndex = 0;
  const notes = cells.filter((c) => !c.rest);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.rest) continue;
    const barIndex = bar + Math.floor(cell.step / plan.stepsPerBar);
    if (barIndex >= plan.bars) break;
    const chord = plan.chords[barIndex];
    const scale = plan.scales[barIndex];
    const pcs = chordPitchClasses(chord);
    const pos = cell.step % plan.stepsPerBar;
    const strong = pos === 0 || (plan.beatsPerBar === 4 && pos === plan.stepsPerBar / 2) || cell.length >= 6;
    if (noteIndex > 0) degree += moves[i % moves.length];
    if (degree > range[1]) degree -= 2 * (degree - range[1]);
    if (degree < range[0]) degree += 2 * (range[0] - degree);
    const isLast = cadence && noteIndex === notes.length - 1;
    if (isLast) degree = nearestChordDegree(plan.tonic, scale, [chord.root, pcs[1]], degree);
    else if (strong || noteIndex === 0) degree = nearestChordDegree(plan.tonic, scale, pcs, degree);
    if (noteIndex === 0) first = degree;
    events.push({
      step: bar * plan.stepsPerBar + cell.step,
      length: cell.length,
      body: pitchesToBody([degreeToMidi(plan.tonic, scale, degree)]),
    });
    noteIndex++;
  }
  return { events, first, last: degree };
}

/**
 * Mélodie par sections de deux mesures : A, A' (même rythme et contour sur d'autres accords), B
 * (contraste, plus aigu), puis A avec une cadence. Le motif revient pour que l'oreille s'y accroche.
 */
export function composeMelody(rng: Rng, plan: SongPlan, density: Density, center: number): TokenEvent[] {
  const unitBars = plan.bars >= 4 ? 2 : 1;
  // Registre : environ une octave et demie centrée sur la hauteur MIDI `center`.
  const centerDegree = Math.round(((center - plan.tonic) * 7) / 12);
  const range: [number, number] = [centerDegree - 5, centerDegree + 5];
  const motifA = makeMotif(rng, density, plan, unitBars);
  const motifB = makeMotif(rng, density === 'sparse' ? 'medium' : density, plan, unitBars);
  const motifC = makeMotif(rng, density, plan, unitBars);
  const events: TokenEvent[] = [];
  let startA = centerDegree + rng.pick([-2, 0, 0, 2]);
  const units = Math.ceil(plan.bars / unitBars);
  for (let u = 0; u < units; u++) {
    const bar = u * unitBars;
    const isFinal = u === units - 1;
    const role = isFinal ? 'end' : ['A', "A'", u % 8 < 4 ? 'B' : 'C', 'end'][u % 4];
    let result: Realized;
    if (role === 'B' || role === 'C') {
      const motif = role === 'B' ? motifB : motifC;
      result = realize(plan, motif.cells, motif.moves, bar, startA + 2, range, false);
    } else if (role === 'end') {
      const firstBar = motifA.cells.filter((c) => c.step < plan.stepsPerBar);
      const cells = unitBars === 2 ? [...firstBar, ...cadenceRhythm(rng, plan.beatsPerBar, plan.stepsPerBar)] : firstBar;
      const moves = cells.map((_, i) => (i < firstBar.length ? motifA.moves[i] : -Math.sign(motifA.moves[i] || 1)));
      result = realize(plan, cells, moves, bar, startA, range, true);
    } else {
      result = realize(plan, motifA.cells, motifA.moves, bar, startA, range, false);
      if (role === 'A') startA = result.first;
    }
    events.push(...result.events);
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Basse
// ---------------------------------------------------------------------------------------------

const BASS_LOW = 40;

/** Ligne de basse selon le style, une mesure à la fois. */
export function composeBass(plan: SongPlan, style: BassStyle): TokenEvent[] {
  const events: TokenEvent[] = [];
  const spb = plan.stepsPerBar;
  const beat = plan.stepsPerBeat;
  for (let bar = 0; bar < plan.bars; bar++) {
    const chord = plan.chords[bar];
    const next = plan.chords[(bar + 1) % plan.bars];
    const root = placeInRange(plan.tonic, chord.root, BASS_LOW);
    const fifth = root + (chord.intervals.includes(6) ? 6 : 7);
    const third = root + chord.intervals[1];
    const at = bar * spb;
    const note = (step: number, length: number, midi: number) =>
      events.push({ step: at + step, length, body: pitchesToBody([midi]) });
    switch (style) {
      case 'long':
        note(0, spb, root);
        break;
      case 'rootFifth':
        if (plan.beatsPerBar === 3) {
          note(0, beat * 2, root);
          note(beat * 2, beat, fifth);
        } else {
          note(0, beat * 2, root);
          note(beat * 2, beat * 2, bar % 2 ? fifth - 12 : fifth);
        }
        break;
      case 'waltz':
        note(0, beat, bar % 2 ? fifth - 12 : root);
        break;
      case 'eighths':
        for (let s = 0; s < spb; s += 2) note(s, 2, s >= spb - 4 && bar % 2 ? fifth : root);
        break;
      case 'octaves':
        for (let s = 0; s < spb; s += 2) note(s, 2, (s / 2) % 2 ? root + 12 : root);
        break;
      case 'walk': {
        const nextRoot = placeInRange(plan.tonic, next.root, BASS_LOW);
        const approach = nextRoot + (nextRoot > root ? -1 : 1) * (bar % 2 ? 1 : 2);
        const line = plan.beatsPerBar === 3 ? [root, third, approach] : [root, third, fifth, approach];
        line.forEach((m, i) => note(i * beat, beat, m));
        break;
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Harmonie
// ---------------------------------------------------------------------------------------------

const ARP_PATTERNS = [
  [0, 1, 2, 3],
  [0, 1, 2, 3, 2, 1],
  [0, 2, 1, 2],
  [0, 1, 2, 1, 3, 1, 2, 1],
];

/** Couche harmonique : nappe tenue, arpèges, accords en contretemps ou accompagnement de valse. */
export function composeHarmony(rng: Rng, plan: SongPlan, style: HarmonyStyle): TokenEvent[] {
  const events: TokenEvent[] = [];
  const spb = plan.stepsPerBar;
  const beat = plan.stepsPerBeat;
  const pattern = rng.pick(ARP_PATTERNS);
  let previous: number[] | null = null;
  let arpIndex = 0;
  for (let bar = 0; bar < plan.bars; bar++) {
    const pcs = chordPitchClasses(plan.chords[bar]);
    const at = bar * spb;
    if (style === 'pad') {
      previous = voiceChord(plan.tonic, pcs, previous, 55, 72, 62);
      events.push({ step: at, length: spb, body: pitchesToBody(previous) });
      continue;
    }
    if (style === 'stabs' || style === 'waltz') {
      previous = voiceChord(plan.tonic, pcs.slice(0, 3), previous, 57, 74, 65);
      const body = pitchesToBody(previous);
      const hits = style === 'waltz' ? [beat, beat * 2] : range(0, plan.beatsPerBar).map((b) => b * beat + beat / 2);
      for (const s of hits) events.push({ step: at + s, length: style === 'waltz' ? beat - 1 : beat / 2, body });
      continue;
    }
    // Arpèges : notes de l'accord + octave de la plus grave.
    previous = voiceChord(plan.tonic, pcs.slice(0, 3), previous, 60, 76, 67);
    const tones = [...previous, previous[0] + 12];
    const length = style === 'fastArp' ? 1 : 2;
    for (let s = 0; s < spb; s += length) {
      events.push({ step: at + s, length, body: pitchesToBody([tones[pattern[arpIndex++ % pattern.length]]]) });
    }
    if (style === 'broken') arpIndex = 0;
  }
  return events;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

// ---------------------------------------------------------------------------------------------
// Batterie
// ---------------------------------------------------------------------------------------------

type DrumGrid = Map<number, DrumHit[]>;

function add(grid: DrumGrid, step: number, ...hits: DrumHit[]): void {
  const list = grid.get(step) ?? [];
  for (const h of hits) if (!list.includes(h)) list.push(h);
  grid.set(step, list);
}

/** Motif d'une mesure 4/4 (16 pas) ou 3/4 (12 pas), avec breaks en fin de phrase de 4 mesures. */
function drumBar(style: DrumStyle, bar: number, plan: SongPlan): DrumGrid {
  const grid: DrumGrid = new Map();
  const spb = plan.stepsPerBar;
  const fill = bar % 4 === 3 || bar === plan.bars - 1;
  const phraseStart = bar % 4 === 0;
  if (plan.beatsPerBar === 3) {
    add(grid, 0, 'K');
    add(grid, 4, 'H');
    add(grid, 8, bar % 2 ? 'S' : 'H');
    if (style !== 'light' && fill) add(grid, 10, 'H');
    return grid;
  }
  const every = (n: number, hit: DrumHit, offset = 0) => {
    for (let s = offset; s < spb; s += n) add(grid, s, hit);
  };
  switch (style) {
    case 'pop':
      every(2, 'H');
      [0, 8].forEach((s) => add(grid, s, 'K'));
      if (bar % 2) add(grid, 10, 'K');
      [4, 12].forEach((s) => add(grid, s, 'S'));
      if (fill) add(grid, 14, 'S');
      break;
    case 'driving':
      every(2, 'H');
      [0, 6, 8].forEach((s) => add(grid, s, 'K'));
      [4, 12].forEach((s) => add(grid, s, 'S'));
      if (phraseStart) add(grid, 0, 'C');
      if (fill) [13, 14, 15].forEach((s) => add(grid, s, 'T'));
      break;
    case 'battle':
      every(1, 'H');
      add(grid, 14, 'O');
      [0, 2, 8, 10].forEach((s) => add(grid, s, 'K'));
      [4, 12].forEach((s) => add(grid, s, 'S'));
      if (phraseStart) add(grid, 0, 'C');
      if (fill) [12, 13, 14, 15].forEach((s) => add(grid, s, 'S'));
      break;
    case 'tense':
      every(2, 'H', 2);
      [0, 10].forEach((s) => add(grid, s, 'K'));
      if (bar % 2) add(grid, 14, 'T');
      if (fill) [12, 14].forEach((s) => add(grid, s, 'T'));
      break;
    case 'village':
      [0, 8].forEach((s) => add(grid, s, 'K'));
      [4, 12].forEach((s) => add(grid, s, 'S'));
      [2, 6, 10, 14].forEach((s) => add(grid, s, 'H'));
      if (fill) add(grid, 14, 'O');
      break;
    case 'light':
      [2, 6, 10, 14].forEach((s) => add(grid, s, 'H'));
      if (bar % 2) add(grid, 8, 'O');
      break;
  }
  return grid;
}

/** Piste de batterie complète (évènements de jetons `K+H`). */
export function composeDrums(plan: SongPlan, style: DrumStyle): TokenEvent[] {
  const events: TokenEvent[] = [];
  const order: DrumHit[] = ['K', 'S', 'T', 'H', 'O', 'C'];
  for (let bar = 0; bar < plan.bars; bar++) {
    const grid = drumBar(style, bar, plan);
    const steps = [...grid.keys()].sort((a, b) => a - b);
    steps.forEach((s, i) => {
      const next = i + 1 < steps.length ? steps[i + 1] : plan.stepsPerBar;
      const hits = order.filter((h) => grid.get(s)?.includes(h));
      events.push({ step: bar * plan.stepsPerBar + s, length: next - s, body: hits.join('+') });
    });
  }
  return events;
}

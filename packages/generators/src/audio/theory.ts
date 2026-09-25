/** Outils de théorie musicale pour la composition procédurale : gammes, accords, voicings. */

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const satisfies Record<string, readonly number[]>;
export type ScaleName = keyof typeof SCALES;

export const SCALE_LABELS: Record<ScaleName, string> = {
  major: 'major',
  minor: 'minor',
  dorian: 'dorian',
  harmonicMinor: 'harmonic minor',
  mixolydian: 'mixolydian',
  lydian: 'lydian',
  phrygian: 'phrygian',
};

/** Noms de tonalités usuels (bémols pour Db, Eb, Ab, Bb). */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface Chord {
  symbol: string;
  /** Fondamentale en demi-tons au-dessus de la tonique (0–11). */
  root: number;
  /** Intervalles depuis la fondamentale. */
  intervals: number[];
}

const DEGREES: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

/**
 * Analyse un chiffrage romain relatif à la gamme majeure : `I`, `vi`, `bVII`, `ii°`, `V7`,
 * `IVmaj7`, `Isus4`… Majuscule = majeur, minuscule = mineur.
 */
export function parseRoman(symbol: string): Chord {
  const m = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|\+)?(maj7|7|sus2|sus4)?$/.exec(symbol);
  if (!m) throw new Error(`Chiffrage d'accord inconnu : ${symbol}`);
  const [, accidental, numeral, quality, extension] = m;
  const upper = numeral === numeral.toUpperCase();
  const root = (DEGREES[numeral.toUpperCase()] + (accidental === 'b' ? -1 : accidental === '#' ? 1 : 0) + 12) % 12;
  let intervals = quality === '°' ? [0, 3, 6] : quality === '+' ? [0, 4, 8] : upper ? [0, 4, 7] : [0, 3, 7];
  if (extension === 'sus2') intervals = [0, 2, 7];
  if (extension === 'sus4') intervals = [0, 5, 7];
  if (extension === '7') intervals = [...intervals, 10];
  if (extension === 'maj7') intervals = [...intervals, 11];
  return { symbol, root, intervals };
}

/** Classes de hauteur (0–11, relatives à la tonique) d'un accord. */
export function chordPitchClasses(chord: Chord): number[] {
  return chord.intervals.map((i) => (chord.root + i) % 12);
}

/**
 * Gamme adaptée à l'accord : chaque note de l'accord absente de la gamme remplace sa voisine à un
 * demi-ton (ex. sensible haussée sur l'accord de V en mineur). Si les deux voisines existent, un
 * accord bémolisé (`bII`, `bVI`…) abaisse la voisine supérieure, sinon la voisine inférieure est
 * haussée. L'ordre des degrés est conservé.
 */
export function adaptScale(scale: readonly number[], chord: Chord): number[] {
  const pcs = chordPitchClasses(chord);
  const flat = chord.symbol.startsWith('b');
  const out = [...scale];
  for (const pc of pcs) {
    if (out.includes(pc)) continue;
    const above = out.indexOf((pc + 1) % 12);
    const below = out.indexOf((pc + 11) % 12);
    const usable = (i: number) => i > 0 && !pcs.includes(out[i]); // jamais la tonique
    const idx = usable(above) && usable(below) ? (flat ? above : below) : usable(above) ? above : below;
    if (usable(idx)) out[idx] = pc;
  }
  return out;
}

/** Hauteur MIDI du degré `degree` (0 = tonique, 7 = octave…) d'une gamme posée sur `tonic`. */
export function degreeToMidi(tonic: number, scale: readonly number[], degree: number): number {
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return tonic + 12 * octave + scale[index];
}

/** Degré le plus proche de `degree` dont la note appartient à l'accord (préférence : immobile, puis bas). */
export function nearestChordDegree(
  tonic: number,
  scale: readonly number[],
  chordPcs: number[],
  degree: number,
): number {
  for (let delta = 0; delta <= 4; delta++) {
    for (const d of delta === 0 ? [degree] : [degree - delta, degree + delta]) {
      const pc = (((degreeToMidi(tonic, scale, d) - tonic) % 12) + 12) % 12;
      if (chordPcs.includes(pc)) return d;
    }
  }
  return degree;
}

/**
 * Voicing serré d'un accord dans [low, high], choisi pour bouger le moins possible depuis le voicing
 * précédent (conduite des voix), ou centré autour de `center` pour le premier.
 */
export function voiceChord(
  tonic: number,
  chordPcs: number[],
  previous: number[] | null,
  low: number,
  high: number,
  center = (low + high) / 2,
): number[] {
  const options = chordPcs.map((pc) => {
    const list: number[] = [];
    for (let m = low; m <= high; m++) if ((((m - tonic) % 12) + 12) % 12 === pc) list.push(m);
    return list;
  });
  let best: number[] = [];
  let bestCost = Infinity;
  const visit = (i: number, acc: number[]) => {
    if (i === options.length) {
      const sorted = [...acc].sort((a, b) => a - b);
      if (sorted[sorted.length - 1] - sorted[0] > 14) return;
      if (new Set(sorted).size !== sorted.length) return;
      const cost = voicingCost(sorted, previous, center);
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
      return;
    }
    for (const m of options[i]) visit(i + 1, [...acc, m]);
  };
  visit(0, []);
  return best.length ? best : chordPcs.map((pc) => low + pc);
}

function voicingCost(notes: number[], previous: number[] | null, center: number): number {
  const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
  if (!previous || previous.length === 0) return Math.abs(mean - center);
  if (previous.length === notes.length) {
    return notes.reduce((sum, n, i) => sum + Math.abs(n - previous[i]), 0) + 0.1 * Math.abs(mean - center);
  }
  const prevMean = previous.reduce((a, b) => a + b, 0) / previous.length;
  return Math.abs(mean - prevMean) * notes.length + 0.1 * Math.abs(mean - center);
}

/** Place une classe de hauteur (relative à la tonique) dans l'intervalle [low, low + 11]. */
export function placeInRange(tonic: number, pc: number, low: number): number {
  const base = tonic + pc;
  return base + 12 * Math.ceil((low - base) / 12);
}

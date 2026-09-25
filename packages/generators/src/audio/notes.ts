/**
 * Notation compacte des pistes musicales : jetons séparés par des espaces.
 *
 * - Piste mélodique : `C4:2` (do4 pendant 2 pas), `F#3`, `Bb2:4`, accord `C4+E4+G4:4`, silence `R:4`.
 *   La durée par défaut vaut 1 pas.
 * - Piste `drums` : `K` grosse caisse, `S` caisse claire, `H` charleston fermé, `O` charleston ouvert,
 *   `C` cymbale crash, `T` tom, `R` silence ; combinables (`K+H:2`).
 * - `|` est ignoré (séparateur de mesures facultatif, pour la lisibilité).
 */

export const DRUM_HITS = ['K', 'S', 'H', 'O', 'C', 'T'] as const;
export type DrumHit = (typeof DRUM_HITS)[number];

export interface PitchedEvent {
  step: number;
  length: number;
  /** Hauteurs MIDI (60 = C4). */
  pitches: number[];
}

export interface DrumEvent {
  step: number;
  length: number;
  hits: DrumHit[];
}

export interface ParsedTrack<E> {
  events: E[];
  /** Longueur totale de la piste en pas (silences compris). */
  totalSteps: number;
  errors: string[];
}

export const MAX_TOKEN_STEPS = 256;
const MAX_ERRORS = 5;
const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DRUM_HELP =
  'utilisez K (grosse caisse), S (caisse claire), H (charleston fermé), O (charleston ouvert), ' +
  'C (cymbale), T (tom) ou R (silence), combinables avec + (ex. K+H:2)';
const NOTE_HELP =
  'attendu une note comme C4, F#3 ou Bb2, un accord C4+E4+G4, ou un silence R, avec une durée facultative :2';

/** Hauteur MIDI d'un nom de note (`C4` → 60, `F#3`, `Bb2`), ou `null` si invalide. */
export function parseNoteName(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(\d)$/.exec(name);
  if (!m) return null;
  const pc = NOTE_OFFSETS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + pc;
}

/** Nom de note (dièses) d'une hauteur MIDI : 60 → `C4`. */
export function midiToNoteName(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Découpe la chaîne en jetons (espaces), en ignorant les barres de mesure `|`. */
export function tokenize(notes: string): string[] {
  return notes.split(/\s+/).filter((t) => t && t !== '|');
}

/** Sépare `corps:durée` ; renvoie une erreur lisible si la durée est invalide. */
function splitDuration(token: string): { body: string; length: number } | { error: string } {
  const parts = token.split(':');
  if (parts.length > 2) return { error: `jeton « ${token} » invalide : un seul « : » autorisé` };
  if (parts.length === 1) return { body: token, length: 1 };
  const [body, dur] = parts;
  if (!/^\d+$/.test(dur) || Number(dur) < 1 || Number(dur) > MAX_TOKEN_STEPS) {
    return {
      error:
        `jeton « ${token} » invalide : la durée après « : » doit être un entier ` +
        `de 1 à ${MAX_TOKEN_STEPS} (en pas)`,
    };
  }
  return { body, length: Number(dur) };
}

function parseTrack<E>(notes: string, parseBody: (body: string, token: string) => E | string | null) {
  const out: ParsedTrack<{ step: number; length: number; value: E }> = { events: [], totalSteps: 0, errors: [] };
  const tokens = tokenize(notes);
  if (!tokens.length) out.errors.push('la piste est vide (écrivez au moins un jeton, ex. R:16)');
  for (const token of tokens) {
    const split = splitDuration(token);
    if ('error' in split) {
      if (out.errors.length < MAX_ERRORS) out.errors.push(split.error);
      continue;
    }
    const value = /^[Rr]$/.test(split.body) ? null : parseBody(split.body, token);
    if (typeof value === 'string') {
      if (out.errors.length < MAX_ERRORS) out.errors.push(value);
      continue;
    }
    if (value !== null) out.events.push({ step: out.totalSteps, length: split.length, value });
    out.totalSteps += split.length;
  }
  return out;
}

/** Analyse une piste mélodique. */
export function parsePitchedTrack(notes: string): ParsedTrack<PitchedEvent> {
  const parsed = parseTrack<number[]>(notes, (body, token) => {
    const pitches: number[] = [];
    for (const part of body.split('+')) {
      const midi = parseNoteName(part);
      if (midi === null) {
        if (/^[KSHOCT]$/.test(part)) {
          return (
            `jeton « ${token} » invalide : « ${part} » est un son de batterie, ` +
            `réservé aux pistes drums (${NOTE_HELP})`
          );
        }
        return `jeton « ${token} » invalide : note « ${part} » inconnue (${NOTE_HELP})`;
      }
      pitches.push(midi);
    }
    return pitches;
  });
  return {
    events: parsed.events.map((e) => ({ step: e.step, length: e.length, pitches: e.value })),
    totalSteps: parsed.totalSteps,
    errors: parsed.errors,
  };
}

/** Analyse une piste de batterie. */
export function parseDrumTrack(notes: string): ParsedTrack<DrumEvent> {
  const parsed = parseTrack<DrumHit[]>(notes, (body, token) => {
    const hits: DrumHit[] = [];
    for (const part of body.split('+')) {
      const hit = part.toUpperCase();
      if (!(DRUM_HITS as readonly string[]).includes(hit)) {
        const hint = parseNoteName(part) !== null ? ' (les notes sont interdites dans une piste drums)' : '';
        return `jeton « ${token} » invalide pour une piste drums : « ${part} » inconnu${hint} ; ${DRUM_HELP}`;
      }
      if (!hits.includes(hit as DrumHit)) hits.push(hit as DrumHit);
    }
    return hits;
  });
  return {
    events: parsed.events.map((e) => ({ step: e.step, length: e.length, hits: e.value })),
    totalSteps: parsed.totalSteps,
    errors: parsed.errors,
  };
}

/** Évènement générique pour la sérialisation : `body` est le jeton sans durée (`C4+E4`, `K+H`). */
export interface TokenEvent {
  step: number;
  length: number;
  body: string;
}

/**
 * Sérialise des évènements (triés, sans chevauchement) en chaîne de jetons, en comblant les trous par
 * des silences, jusqu'à `totalSteps` pas.
 */
export function formatTokens(events: TokenEvent[], totalSteps: number): string {
  const tokens: string[] = [];
  let cursor = 0;
  const push = (body: string, length: number) => tokens.push(length === 1 ? body : `${body}:${length}`);
  const rest = (length: number) => {
    for (let left = length; left > 0; left -= MAX_TOKEN_STEPS) push('R', Math.min(left, MAX_TOKEN_STEPS));
  };
  for (const ev of [...events].sort((a, b) => a.step - b.step)) {
    if (ev.step < cursor || ev.step >= totalSteps) continue;
    if (ev.step > cursor) rest(ev.step - cursor);
    const length = Math.min(ev.length, totalSteps - ev.step, MAX_TOKEN_STEPS);
    push(ev.body, length);
    cursor = ev.step + length;
  }
  if (cursor < totalSteps) rest(totalSteps - cursor);
  return tokens.join(' ');
}

/** Corps de jeton d'un accord ou d'une note : `[60, 64, 67]` → `C4+E4+G4`. */
export function pitchesToBody(pitches: number[]): string {
  return pitches.map(midiToNoteName).join('+');
}

import { matchKeyword, normalizeText } from './keywords';

/** Palettes soignées partagées par les générateurs de personnages (portraits, charsets…). */

export const SKIN_TONES = ['#fbe0cc', '#f6d0b1', '#eab88f', '#d69e74', '#b77c52', '#8e5a3a', '#6a4028'] as const;

export const HAIR_COLORS = [
  '#3b2a26', // brun foncé
  '#6b3e26', // châtain
  '#26222e', // noir bleuté
  '#e2b95a', // blond
  '#c2562c', // roux
  '#d9d6e4', // argenté
  '#8c5a3c', // noisette
  '#e58fb0', // rose
  '#4a6fc8', // bleu
] as const;

export const OUTFIT_COLORS = [
  '#3a6ea5',
  '#b03a48',
  '#2f7a4a',
  '#6a4a9a',
  '#c08030',
  '#44566a',
  '#2e8a8a',
  '#8a3a6a',
  '#e2e0d8',
] as const;

export const EYE_COLORS = ['#3a6ec8', '#2f8a5a', '#7a4a2a', '#8a4ad0', '#c0402a', '#3a3a4a', '#d09a2a'] as const;

/** Couleurs nommées reconnues dans les descriptions (français / anglais). */
export const NAMED_COLORS = {
  red: { hex: '#c0343e', words: ['rouge', 'red', 'ecarlate', 'scarlet', 'carmin', 'crimson'] },
  blue: { hex: '#3a66c0', words: ['bleu', 'blue', 'azur', 'marine', 'navy'] },
  cyan: { hex: '#2ea3b8', words: ['cyan', 'turquoise', 'teal'] },
  green: { hex: '#2f8a4a', words: ['vert', 'verte', 'green', 'emeraude', 'emerald'] },
  yellow: { hex: '#e2b83a', words: ['jaune', 'yellow', 'dore', 'doree', 'gold', 'golden'] },
  orange: { hex: '#e07a2a', words: ['orange'] },
  purple: { hex: '#7a4ab0', words: ['violet', 'violette', 'purple', 'mauve', 'lavande', 'lavender'] },
  pink: { hex: '#e07aa6', words: ['rose', 'pink'] },
  brown: { hex: '#7a4e30', words: ['marron', 'brun', 'brune', 'brown'] },
  black: { hex: '#2a2633', words: ['noir', 'noire', 'black', 'sombre'] },
  white: { hex: '#ecebe6', words: ['blanc', 'blanche', 'white'] },
  gray: { hex: '#7a7f8c', words: ['gris', 'grise', 'grey', 'gray', 'argent', 'silver'] },
} as const;

type NamedColor = keyof typeof NAMED_COLORS;

const table = Object.fromEntries(
  Object.entries(NAMED_COLORS).map(([k, v]) => [k, v.words as readonly string[]]),
) as Record<string, readonly string[]> as Record<NamedColor, readonly string[]>;

/** Première couleur nommée dans le texte, en hexadécimal. */
export function colorFromText(text: string): string | undefined {
  const key = matchKeyword(text, table);
  return key ? NAMED_COLORS[key].hex : undefined;
}

const HAIR_WORDS: Record<string, readonly string[]> = {
  '#e2b95a': ['blond', 'blonde', 'blonds', 'blondes'],
  '#c2562c': ['roux', 'rousse', 'ginger', 'redhead', 'red hair', 'red haired'],
  '#3b2a26': ['brun', 'brune', 'brunette', 'brown hair', 'dark hair'],
  '#26222e': ['black hair', 'cheveux noirs', 'jais'],
  '#d9d6e4': ['white hair', 'silver hair', 'cheveux blancs', 'cheveux gris', 'cheveux argentes', 'argente', 'argentee'],
  '#e58fb0': ['pink hair', 'cheveux roses'],
  '#4a6fc8': ['blue hair', 'cheveux bleus'],
  '#6a9a4a': ['green hair', 'cheveux verts'],
  '#8a5ad0': ['purple hair', 'cheveux violets'],
};

/** Couleur de cheveux explicitement décrite (« cheveux roux », « blonde », « black hair »…). */
export function hairColorFromText(text: string): string | undefined {
  const norm = normalizeText(text);
  for (const [hex, words] of Object.entries(HAIR_WORDS)) {
    if (words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(norm))) return hex;
  }
  return undefined;
}

/** Couleur de tenue : couleur nommée qui ne décrit pas les cheveux ni les yeux. */
export function outfitColorFromText(text: string): string | undefined {
  const norm = normalizeText(text)
    .replace(/cheveux\s+[a-z]+/g, ' ')
    .replace(/yeux\s+[a-z]+/g, ' ')
    .replace(/[a-z]+\s+(hair|eyes)/g, ' ');
  return colorFromText(norm);
}

/** Couleur des yeux décrite (« yeux verts », « blue eyes »). */
export function eyeColorFromText(text: string): string | undefined {
  const norm = normalizeText(text);
  const m = /yeux\s+([a-z]+)/.exec(norm) ?? /([a-z]+)\s+eyes/.exec(norm);
  return m?.[1] ? colorFromText(m[1]) : undefined;
}

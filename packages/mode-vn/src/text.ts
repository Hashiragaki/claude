/**
 * Retire les balises de texte Ren'Py (`{b}`, `{/i}`, `{color=#f00}`, `{w}`…).
 * `{{` produit une accolade littérale et `{p}` un saut de ligne.
 */
export function stripTextTags(text: string): string {
  return text.replace(/\{\{|\{\/?[A-Za-z#][^{}]*\}/g, (tag) => {
    if (tag === '{{') return '{';
    if (tag === '{p}') return '\n';
    return '';
  });
}

/** Segment `[expr]` à interpoler dans un texte. */
export interface InterpolationSegment {
  expr: string;
  /** Index (0-based) du `[` ouvrant dans le texte. */
  start: number;
}

/**
 * Extrait les expressions `[expr]` d'un texte (même règle que l'interpolation du core :
 * `[[` échappe un crochet). `unclosed` indique un `[` sans `]` correspondant.
 */
export function extractInterpolations(text: string): { segments: InterpolationSegment[]; unclosed: number | null } {
  const segments: InterpolationSegment[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '[' && text[i + 1] === '[') {
      i += 2;
      continue;
    }
    if (text[i] === '[') {
      const end = closingBracket(text, i);
      if (end < 0) return { segments, unclosed: i };
      segments.push({ expr: text.slice(i + 1, end), start: i });
      i = end + 1;
      continue;
    }
    i++;
  }
  return { segments, unclosed: null };
}

function closingBracket(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Tronque un texte pour un aperçu (libellé de sauvegarde, historique). */
export function excerpt(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

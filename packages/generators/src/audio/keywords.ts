/** Détection de mots-clés (français et anglais) dans une consigne libre. */

/** Minuscules, sans accents, mots séparés par des espaces. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Renvoie la catégorie dont les mots-clés apparaissent le plus dans `text` (égalité : ordre de
 * déclaration). Un mot-clé d'au moins 5 lettres reconnaît aussi les mots qui commencent par lui
 * (« explos » → « explosion », « exploser »). Renvoie `undefined` sans correspondance.
 */
export function matchKeywords<K extends string>(text: string, table: Record<K, readonly string[]>): K | undefined {
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (!words.length) return undefined;
  let best: K | undefined;
  let bestScore = 0;
  for (const key of Object.keys(table) as K[]) {
    let score = 0;
    for (const raw of table[key]) {
      const kw = normalizeText(raw);
      if (words.some((w) => w === kw || (kw.length >= 5 && w.startsWith(kw)))) score++;
    }
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

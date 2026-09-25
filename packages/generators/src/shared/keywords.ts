/** Recherche de mots-clés (français / anglais) dans une description libre. */

/** Minuscules sans accents ni ligatures, pour comparer des mots-clés. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function wordPattern(word: string): RegExp {
  const w = normalizeText(word).replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, ' +');
  return new RegExp(`(^| )${w}(s|x|e|es)?( |$)`);
}

const patternCache = new Map<string, RegExp>();

/**
 * Renvoie la clé dont un mot-clé apparaît le plus tôt dans le texte (mot entier, féminin ou pluriel en
 * « e »/« s »/« x » accepté), ou `undefined`. La comparaison ignore accents et casse : `épées` trouve `epee`.
 */
export function matchKeyword<K extends string>(text: string, table: Record<K, readonly string[]>): K | undefined {
  const norm = normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim();
  let best: { key: K; index: number } | undefined;
  for (const key of Object.keys(table) as K[]) {
    for (const word of table[key]) {
      let re = patternCache.get(word);
      if (!re) {
        re = wordPattern(word);
        patternCache.set(word, re);
      }
      const m = re.exec(norm);
      if (m && (!best || m.index < best.index)) best = { key, index: m.index };
    }
  }
  return best?.key;
}

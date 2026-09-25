import type { Dictionary, I18n } from '@forge/core';

/** Textes propres au mode VN (complètent `ENGINE_STRINGS` sans les écraser). */
export const VN_STRINGS: Record<string, Dictionary> = {
  fr: {
    'vn.slot': 'Emplacement {n}',
    'vn.error': 'Erreur de script',
    'vn.saveFailed': 'Sauvegarde impossible.',
    'vn.loadFailed': 'Chargement impossible.',
  },
  en: {
    'vn.slot': 'Slot {n}',
    'vn.error': 'Script error',
    'vn.saveFailed': 'Could not save.',
    'vn.loadFailed': 'Could not load.',
  },
};

/** Ajoute les textes VN manquants au dictionnaire du jeu. */
export function extendVNStrings(i18n: I18n): void {
  for (const [locale, dict] of Object.entries(VN_STRINGS)) {
    const missing = Object.fromEntries(Object.entries(dict).filter(([key]) => !i18n.has(key, locale)));
    i18n.extend(locale, missing);
  }
}

/** Date courte localisée d'une sauvegarde. */
export function formatSaveDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

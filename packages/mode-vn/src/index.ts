import type { GameModeDefinition } from '@forge/core';
import { VN_TEMPLATES } from './templates';
import { validateBundle } from './validate';

export * from './compiler';
export * from './constants';
export * from './editor';
export * from './interpreter';
export * from './loader';
export * from './parser';
export * from './refs';
export { VN_STRINGS, extendVNStrings } from './strings';
export * from './templates';
export * from './text';
export * from './types';
export * from './validate';

/**
 * Mode Visual Novel. Le runtime (PixiJS) est chargé dynamiquement : importer ce module ne tire
 * pas pixi.js (le serveur l'utilise pour les modèles et la validation).
 */
export const vnMode: GameModeDefinition = {
  id: 'vn',
  name: 'Visual Novel',
  description:
    'Romans visuels à embranchements écrits dans un langage de script inspiré de Ren\'Py : dialogues, '
    + 'personnages, choix, variables, transitions, musique, sauvegardes et retour arrière.',
  templates: VN_TEMPLATES,
  async createRuntime(ctx) {
    const { VNRuntime } = await import('./runtime');
    return new VNRuntime(ctx);
  },
  validate: (bundle) => validateBundle(bundle),
};

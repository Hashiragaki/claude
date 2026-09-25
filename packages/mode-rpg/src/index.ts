import type { GameModeDefinition } from '@forge/core';
import { HeadlessRpgRuntime } from './headless';
import { RPG_TEMPLATES } from './templates';
import { validateProject } from './validate';

// API pure (sans PixiJS) : utilisable par le serveur, l'éditeur, les outils IA et les tests.
export * from './battle';
export * from './character';
export * from './conditions';
export * from './headless';
export * from './interpreter';
export * from './items';
export * from './loader';
export * from './mapBuilder';
export * from './passability';
export * from './schema';
export * from './scope';
export * from './session';
export * from './state';
export * from './strings';
export * from './templates';
export * from './validate';
export * from './walk';
export * from './world';

/**
 * Mode RPG inspiré de RPG Maker : cartes en tuiles, événements scriptés, combats au tour par
 * tour en vue de face. Le rendu PixiJS est chargé dynamiquement (le serveur importe ce module).
 */
export const rpgMode: GameModeDefinition = {
  id: 'rpg',
  name: 'RPG',
  description:
    'Jeu de rôle à la RPG Maker : cartes en tuiles, personnages et événements (dialogues, choix, coffres, ' +
    'téléportations), menu, sauvegardes et combats au tour par tour.',
  templates: RPG_TEMPLATES,
  async createRuntime(ctx) {
    if (!ctx.mount) return new HeadlessRpgRuntime(ctx);
    const { RpgRuntime } = await import('./runtime');
    return new RpgRuntime(ctx);
  },
  validate: validateProject,
};

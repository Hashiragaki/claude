import type { GameModeDefinition } from '@forge/core';
import { HeadlessPlatformerRuntime } from './headless';
import { PLATFORMER_TEMPLATES } from './templates';
import { validatePlatformerProject } from './validate';

/**
 * Mode plateformer 2D : niveaux en tuiles vus de côté, pièces, ennemis, ressorts, points de
 * contrôle et arrivée. Le rendu PixiJS est chargé dynamiquement (le serveur importe ce module).
 */
export * from './grid';
export * from './headless';
export * from './levelBuilder';
export * from './loader';
export * from './physics';
export * from './schema';
export * from './session';
export * from './templates';
export type * from './types';
export * from './validate';
export * from './world';

const AI_GUIDE = `Mode plateformer (vue de côté, tuiles 16×16).
- data/platformer.json : système (title, levels: [ids dans l'ordre], startLevel?, lives, coinsPerLife, zoom, playerCharset,
  physics {runSpeed, jumpSpeed, gravity…}, titleMusic?, levelMusic?, sfx {jump, coin, stomp, hurt, spring, checkpoint, goal}).
- levels/<id>.json : { id, name, width, height, tileset, music?, background?, backgroundColor, playerStart {x,y},
  layers { terrain: number[width*height], decor: number[] }, entities: [...], next?, timeLimit? }.
- Tuiles (index, -1 = vide) : 0 top, 1 fill, 2 top_left, 3 top_right, 4 platform (traversable par-dessous), 5 brick,
  6 stone, 7 crate, 8 spikes (danger), 9 water (danger), 10 bridge, 11 cloud (traversables par-dessous),
  12-15 décor (bush, flower, sign, fence) à mettre dans la couche decor. Ligne y du tableau = y * width + x.
- Entités (x, y en cases, id unique) : coin, enemy {kind: walker|hopper, speed, facing, range?}, spring {power},
  checkpoint, goal (au moins un par niveau), sign {text}.
- Pièges : le départ ne doit pas être dans une tuile pleine ; un saut monte d'environ 4 cases et franchit ~5 cases
  de vide ; vérifier le niveau avec la validation du projet après chaque modification.`;

export const platformerMode: GameModeDefinition = {
  id: 'platformer',
  name: 'Plateformer',
  description:
    'Plateformer 2D : niveaux en tuiles vus de côté, pièces, ennemis à écraser, ressorts, points de contrôle, ' +
    'vies et chronomètre, avec éditeur de niveaux.',
  templates: PLATFORMER_TEMPLATES,
  async createRuntime(ctx) {
    if (!ctx.mount) return new HeadlessPlatformerRuntime(ctx);
    const { PlatformerRuntime } = await import('./runtime');
    return new PlatformerRuntime(ctx);
  },
  validate: validatePlatformerProject,
  aiGuide: AI_GUIDE,
};

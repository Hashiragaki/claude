import type { GameModeDefinition } from '@forge/core';
import { sandbox3dTemplates } from './templates';
import { validateSandbox3d } from './validate';

/** Mode « bac à sable 3D » : exploration à la troisième personne d'une scène de modèles glTF. */
export const sandbox3dMode: GameModeDefinition = {
  id: 'sandbox3d',
  name: 'Bac à sable 3D',
  description:
    'Explorez une scène 3D à la troisième personne : modèles et animations générés, ciel et lumière ' +
    'selon l’heure, objets interactifs, personnages et musique d’ambiance.',
  templates: sandbox3dTemplates,
  async createRuntime(ctx) {
    // Import dynamique : l'index reste utilisable côté serveur (Node) sans charger Three.js.
    const { Sandbox3DRuntime } = await import('./runtime');
    return new Sandbox3DRuntime(ctx);
  },
  validate: validateSandbox3d,
};

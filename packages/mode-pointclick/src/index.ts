import type { GameModeDefinition } from '@forge/core';
import { HeadlessPointClickRuntime } from './headless';
import { POINTCLICK_TEMPLATES } from './templates';
import { validatePointClickProject } from './validate';

/**
 * Mode point & click : scènes illustrées, zones cliquables, inventaire, combinaisons d'objets et
 * dialogues à choix. Le rendu PixiJS est chargé dynamiquement (le serveur importe ce module).
 */
export * from './geometry';
export * from './headless';
export * from './loader';
export * from './schema';
export * from './session';
export * from './templates';
export type * from './types';
export * from './validate';

const AI_GUIDE = `Mode point & click (scènes illustrées, coordonnées en pixels de l'image de fond, 1280×720 par défaut).
- data/pointclick.json : système { title, startScene, scenes: [ids], playerCharset?, playerScale, walkSpeed, playerName,
  variables {nom: valeur}, startItems: [ids], titleMusic?, titleBackground?, sfx {pickup, combine, fail, door}, defaultFail }.
- data/items.json : { items: [{ id, name, icon, description }], combinations: [{ a, b, result?, consume (défaut true),
  condition?, actions? }] }.
- scenes/<id>.json : { id, name, background, width, height, music?, walkArea: [[{x,y}…]] (polygones), playerStart?,
  depthScale? {topY, topScale, bottomY, bottomScale}, hotspots: [...], onEnter: [actions], onFirstEnter: [actions] }.
- Zone (hotspot) : { id, name, kind: object|exit|character, shape: {type:'rect',x,y,w,h} | {type:'polygon',points},
  sprite?, spriteAt?, walkTo?, hidden?, description? (texte de « regarder »), interactions: [{ verb: interact|look,
  item? (objet utilisé dessus), condition?, actions: [...] }] }. La première interaction qui correspond est jouée.
- Actions : say {text, speaker?}, give/remove {item}, set {var, value: expression}, goto {scene, x?, y?},
  hide/show {hotspot, scene?}, sound {asset}, music {asset?}, if {condition, then, else?},
  dialogue {speaker?, prompt?, choices: [{text, condition?, once?, actions}]}, wait {seconds}, end {text?}.
- Expressions (conditions, set) : variables du jeu, has("objet"), visited("scène"), opérateurs and/or/not, == != < >.
  Booléens : True / False. Les textes acceptent {expression}, ex. « {pieces} pièces ».
- Pièges : chaque objet donné doit exister dans items.json ; une sortie (kind exit) a une interaction avec goto ;
  garder le jeu gagnable (vérifier qu'aucun objet indispensable n'est consommé trop tôt) ; valider le projet après
  chaque modification.`;

export const pointclickMode: GameModeDefinition = {
  id: 'pointclick',
  name: 'Point & click',
  description:
    "Aventure point & click : scènes illustrées, zones cliquables, inventaire, combinaisons d'objets, " +
    'dialogues à choix et énigmes.',
  templates: POINTCLICK_TEMPLATES,
  async createRuntime(ctx) {
    if (!ctx.mount) return new HeadlessPointClickRuntime(ctx);
    const { PointClickRuntime } = await import('./runtime');
    return new PointClickRuntime(ctx);
  },
  validate: validatePointClickProject,
  aiGuide: AI_GUIDE,
};

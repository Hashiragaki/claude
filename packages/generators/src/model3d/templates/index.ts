import type { Rng } from '@forge/core';
import { matchKeywords } from '../../audio/keywords';
import { character } from './character';
import { chest } from './chest';
import { crate } from './crate';
import { fence } from './fence';
import { house } from './house';
import { lamp } from './lamp';
import { mushroom } from './mushroom';
import { rock } from './rock';
import { sword } from './sword';
import { tower } from './tower';
import { tree } from './tree';
import type { TemplateFn } from './types';
import { well } from './well';

export type { TemplateContext, TemplateFn, TemplateModel } from './types';

export const MODEL_TEMPLATES = {
  tree,
  rock,
  house,
  crate,
  character,
  chest,
  lamp,
  tower,
  fence,
  mushroom,
  sword,
  well,
} satisfies Record<string, TemplateFn>;

export type ModelTemplate = keyof typeof MODEL_TEMPLATES;
export const MODEL_TEMPLATE_NAMES = Object.keys(MODEL_TEMPLATES) as ModelTemplate[];

/**
 * Mots-clés (FR / EN) de chaque modèle ; en cas d'égalité, l'ordre de déclaration l'emporte : les objets
 * précis passent avant les mots qui décrivent souvent une matière (« pierre », « bois »).
 */
const TEMPLATE_KEYWORDS: Record<ModelTemplate, readonly string[]> = {
  chest: ['coffre', 'chest', 'tresor', 'treasure'],
  character: [
    'personnage',
    'heros',
    'hero',
    'heroine',
    'character',
    'villageois',
    'villager',
    'humain',
    'human',
    'pnj',
    'npc',
    'guerrier',
    'warrior',
    'chevalier',
    'knight',
    'garcon',
    'fille',
    'homme',
    'femme',
    'joueur',
    'player',
  ],
  mushroom: ['champignon', 'champignons', 'mushroom', 'amanite', 'toadstool'],
  well: ['puits', 'well'],
  sword: ['epee', 'sword', 'lame', 'blade', 'glaive', 'dague', 'dagger'],
  lamp: ['lampe', 'lampadaire', 'lamp', 'lanterne', 'lantern', 'reverbere', 'streetlight'],
  tower: ['tour', 'tower', 'donjon', 'keep', 'chateau', 'castle', 'phare'],
  fence: ['barriere', 'fence', 'cloture', 'palissade', 'enclos'],
  house: ['maison', 'house', 'cabane', 'chaumiere', 'hut', 'cottage', 'batiment', 'building', 'home'],
  crate: ['caisse', 'crate', 'boite', 'box', 'carton'],
  tree: ['arbre', 'arbres', 'tree', 'sapin', 'pin', 'pine', 'chene', 'oak', 'bouleau'],
  rock: ['rocher', 'rochers', 'rock', 'pierre', 'stone', 'caillou', 'roche', 'boulder'],
};

/** Modèle procédural déduit d'une description libre, ou `undefined`. */
export function detectTemplate(prompt: string): ModelTemplate | undefined {
  return matchKeywords(prompt, TEMPLATE_KEYWORDS);
}

/** Modèle explicite, sinon d'après la description, sinon d'après la graine. */
export function resolveTemplate(template: ModelTemplate | 'auto', prompt: string, rng: Rng): ModelTemplate {
  if (template !== 'auto') return template;
  return detectTemplate(prompt) ?? rng.pick(MODEL_TEMPLATE_NAMES);
}

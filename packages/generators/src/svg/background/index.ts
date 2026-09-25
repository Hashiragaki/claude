import type { Rng } from '@forge/core';
import { matchKeyword } from '../../shared/keywords';
import { SvgBuilder, type SvgStyle } from '../builder';
import { H, TIMES, W, lighting, type Scene, type TimeOfDay } from './common';
import { bedroom, cafe, classroom } from './indoor';
import { beach, castle, forest, generic, park, space, street } from './outdoor';

export { TIMES, type TimeOfDay } from './common';

export const SCENES = ['cafe', 'street', 'park', 'bedroom', 'classroom', 'forest', 'beach', 'castle', 'space', 'generic'] as const;
export type SceneName = (typeof SCENES)[number];

const DRAW: Record<SceneName, (s: Scene) => void> = { cafe, street, park, bedroom, classroom, forest, beach, castle, space, generic };

const SCENE_WORDS: Record<Exclude<SceneName, 'generic'>, readonly string[]> = {
  cafe: ['cafe', 'coffee', 'salon de the', 'bar', 'restaurant', 'boulangerie', 'bakery', 'taverne', 'tavern'],
  street: ['rue', 'street', 'ville', 'city', 'centre ville', 'quartier', 'avenue', 'boutique', 'magasin', 'town'],
  park: ['parc', 'park', 'jardin', 'garden', 'square'],
  bedroom: ['chambre', 'bedroom', 'room', 'maison', 'home', 'appartement', 'apartment', 'salon'],
  classroom: ['classe', 'classroom', 'ecole', 'school', 'salle de cours', 'lycee', 'college', 'universite'],
  forest: ['foret', 'forest', 'bois', 'woods', 'jungle', 'sous bois'],
  beach: ['plage', 'beach', 'mer', 'sea', 'ocean', 'cote', 'ile', 'island', 'bord de mer'],
  castle: ['chateau', 'castle', 'royaume', 'kingdom', 'forteresse', 'fortress', 'palais', 'palace', 'donjon'],
  space: ['espace', 'space', 'galaxie', 'galaxy', 'planete', 'planet', 'cosmos', 'vaisseau', 'spaceship'],
};

const TIME_WORDS: Record<TimeOfDay, readonly string[]> = {
  night: ['nuit', 'night', 'soir', 'soiree', 'evening', 'nocturne', 'minuit', 'midnight'],
  sunset: ['coucher', 'couchant', 'crepuscule', 'sunset', 'dusk', 'aube', 'dawn', 'aurore', 'lever du soleil', 'sunrise'],
  day: ['jour', 'day', 'matin', 'morning', 'midi', 'noon', 'apres midi', 'afternoon', 'ensoleille', 'sunny'],
};

export function sceneFromText(text: string): SceneName | undefined {
  return matchKeyword(text, SCENE_WORDS);
}

export function timeFromText(text: string): TimeOfDay | undefined {
  return matchKeyword(text, TIME_WORDS);
}

export interface BackgroundOptions {
  scene: SceneName;
  time: TimeOfDay;
  style: SvgStyle;
  width: number;
  height: number;
  accent?: string;
}

/** Décor en couches (1280 × 720 de conception, recadré pour remplir la taille demandée). */
export function drawBackground(opts: BackgroundOptions, rng: Rng): string {
  const b = new SvgBuilder(opts.style, '#2a2234', 'b');
  const scene: Scene = { b, rng, time: opts.time, L: lighting(opts.time), accent: opts.accent };
  DRAW[opts.scene](scene);
  return b.toSvg(opts.width, opts.height, [0, 0, W, H], true);
}

export function isTime(value: string): value is TimeOfDay {
  return (TIMES as readonly string[]).includes(value);
}

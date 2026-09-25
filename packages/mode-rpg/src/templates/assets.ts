import type { AssetKind, TemplateAssetRequest } from '@forge/core';

/**
 * Demandes d'assets générés procéduralement par le serveur à la création du projet
 * (graines fixes → résultat reproductible). Les cartes et scripts les référencent par alias.
 */

export type TilesetTheme = 'village' | 'forest' | 'dungeon' | 'interior' | 'desert' | 'snow' | 'cave';

export interface CharsetParams {
  skinTone: string;
  hairColor: string;
  hairStyle: 'short' | 'long' | 'spiky' | 'bald' | 'ponytail' | 'hood';
  outfitColor: string;
  outfitStyle: 'tunic' | 'robe' | 'armor' | 'dress';
  accessory: 'none' | 'hat' | 'helmet' | 'crown' | 'glasses';
  prompt: string;
}

export type BattlerCreature = 'slime' | 'bat' | 'golem' | 'wolf' | 'ghost' | 'plant';
export type MusicMood = 'village' | 'battle' | 'calm' | 'epic' | 'happy' | 'tense' | 'sad' | 'mysterious';
export type SfxPreset =
  | 'blip' | 'select' | 'cancel' | 'hit' | 'coin' | 'door' | 'magic' | 'powerup' | 'jump' | 'explosion';

export function tilesetAsset(alias: string, name: string, theme: TilesetTheme, seed: number, prompt: string) {
  return {
    alias,
    name,
    generator: 'tileset',
    params: { theme, tileSize: 16, prompt },
    seed,
    tags: ['rpg', 'tileset'],
  } satisfies TemplateAssetRequest;
}

export function charsetAsset(alias: string, name: string, params: CharsetParams, seed: number) {
  return {
    alias,
    name,
    generator: 'charset',
    params: { ...params },
    seed,
    tags: ['rpg', 'charset'],
  } satisfies TemplateAssetRequest;
}

export function battlerAsset(
  alias: string,
  name: string,
  creature: BattlerCreature,
  color: string,
  seed: number,
  prompt: string,
) {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'battler', creature, color, width: 256, height: 256, prompt },
    seed,
    tags: ['rpg', 'battler'],
  } satisfies TemplateAssetRequest;
}

export type BackgroundScene =
  | 'cafe' | 'street' | 'park' | 'bedroom' | 'classroom' | 'forest' | 'beach' | 'castle' | 'space' | 'generic';

/** Décor plein écran (fond de combat, écran titre…). */
export function backgroundAsset(
  alias: string,
  name: string,
  scene: BackgroundScene,
  seed: number,
  prompt: string,
  timeOfDay: 'day' | 'sunset' | 'night' = 'day',
) {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'background', scene, timeOfDay, width: 960, height: 540, prompt },
    seed,
    tags: ['rpg', 'décor'],
  } satisfies TemplateAssetRequest;
}

export function musicAsset(alias: string, name: string, mood: MusicMood, seed: number, prompt: string) {
  return {
    alias,
    name,
    generator: 'music',
    params: { mood, bars: 8, prompt },
    seed,
    tags: ['rpg', 'musique'],
  } satisfies TemplateAssetRequest;
}

export function sfxAsset(alias: string, name: string, preset: SfxPreset, seed: number, prompt: string) {
  return {
    alias,
    name,
    generator: 'sfx',
    params: { preset, prompt },
    seed,
    tags: ['rpg', 'son'],
  } satisfies TemplateAssetRequest;
}

/** Type d'asset produit par chaque générateur (utile aux tests et outils hors serveur). */
export const GENERATOR_KINDS: Record<string, AssetKind> = {
  tileset: 'tileset',
  charset: 'charset',
  'image.svg': 'image',
  music: 'music',
  sfx: 'sfx',
};

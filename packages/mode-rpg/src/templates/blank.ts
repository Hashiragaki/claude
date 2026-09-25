import { TILE, type ProjectTemplate } from '@forge/core';
import { MapBuilder } from '../mapBuilder';
import type { RpgDatabaseInput, RpgSystemInput } from '../schema';
import { battlerAsset, charsetAsset, tilesetAsset } from './assets';

/** Carte unique : prairie 20×15 bordée de buissons, avec un panneau d'accueil. */
export function buildBlankMap() {
  return new MapBuilder('carte1', { name: 'Prairie', width: 20, height: 15, tileset: 'tiles village' })
    .scatter('ground', TILE.ground_alt, 25, 3)
    .border('decor', TILE.bush)
    .scatter('decor', TILE.flowers, 8, 4, { area: { x: 1, y: 1, w: 18, h: 13 } })
    .sign(
      'panneau',
      10,
      5,
      'Bienvenue dans votre nouveau RPG ! Modifiez les cartes dans « maps/ » et la base de données dans ' +
        '« data/database.json ».',
    )
    .build();
}

export const BLANK_SYSTEM: RpgSystemInput = {
  title: 'Mon RPG',
  startMap: 'carte1',
  startX: 10,
  startY: 8,
  startDirection: 'up',
  party: ['heros'],
  startGold: 0,
  zoom: 3,
  sfx: {},
};

export const BLANK_DATABASE: RpgDatabaseInput = {
  actors: [
    {
      id: 'heros',
      name: 'Héros',
      charset: 'chara heros',
      level: 1,
      maxHp: 50,
      maxMp: 10,
      atk: 12,
      def: 8,
      mag: 6,
      agi: 8,
      skills: [],
    },
  ],
  items: [
    {
      id: 'potion',
      name: 'Potion',
      description: 'Rend 50 PV à un allié.',
      price: 20,
      consumable: true,
      effect: { type: 'heal', value: 50 },
    },
  ],
  skills: [],
  enemies: [
    {
      id: 'slime',
      name: 'Slime',
      battler: 'battler slime',
      maxHp: 20,
      atk: 9,
      def: 4,
      mag: 2,
      agi: 5,
      exp: 6,
      gold: 5,
      drops: [{ item: 'potion', chance: 0.2 }],
      skills: [],
    },
  ],
  troops: [{ id: 'slime', name: 'Slime', members: ['slime'] }],
};

export const blankTemplate: ProjectTemplate = {
  id: 'rpg-blank',
  name: 'RPG vide',
  description: 'Une carte de prairie, un héros et une base de données minimale pour démarrer.',
  manifest: {
    resolution: { width: 960, height: 540 },
    pixelArt: true,
    entry: 'data/system.json',
    description: 'Un nouveau RPG.',
  },
  files: [
    { path: 'data/system.json', content: BLANK_SYSTEM },
    { path: 'data/database.json', content: BLANK_DATABASE },
    { path: 'maps/carte1.json', content: buildBlankMap() },
  ],
  assets: [
    tilesetAsset('tiles village', 'Tuiles : village', 'village', 1001, 'Village paisible : herbe, chemins, maisons'),
    charsetAsset(
      'chara heros',
      'Héros',
      {
        skinTone: '#f1c7a3',
        hairColor: '#6b3e26',
        hairStyle: 'short',
        outfitColor: '#2f6fd1',
        outfitStyle: 'tunic',
        accessory: 'none',
        prompt: 'Jeune héros en tunique bleue',
      },
      1002,
    ),
    battlerAsset('battler slime', 'Slime', 'slime', '#57c46a', 1003, 'Petit slime vert souriant'),
  ],
};

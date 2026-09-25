import type { ProjectTemplate, TemplateAssetRequest } from '@forge/core';
import type { SceneInput, SceneObjectInput } from './schema';

export const SCENE_ENTRY = 'scenes/main.json';

export type Model3dTemplate =
  | 'tree'
  | 'rock'
  | 'house'
  | 'crate'
  | 'character'
  | 'chest'
  | 'lamp'
  | 'tower'
  | 'fence'
  | 'mushroom'
  | 'sword'
  | 'well';

interface ModelRequestOptions {
  alias: string;
  name: string;
  template: Model3dTemplate;
  seed: number;
  prompt: string;
  color?: string;
  animations?: string[];
  tags?: string[];
}

/** Demande de génération procédurale d'un modèle 3D (générateur `model3d`). */
function model3d(options: ModelRequestOptions): TemplateAssetRequest {
  return {
    alias: options.alias,
    name: options.name,
    generator: 'model3d',
    params: {
      template: options.template,
      animations: options.animations ?? [],
      ...(options.color ? { color: options.color } : {}),
      prompt: options.prompt,
    },
    seed: options.seed,
    tags: ['3d', ...(options.tags ?? [])],
  };
}

const MANIFEST = { resolution: { width: 1280, height: 720 }, pixelArt: false, entry: SCENE_ENTRY };

// ---------------------------------------------------------------------------
// Scène vide
// ---------------------------------------------------------------------------

const blankScene: SceneInput = {
  name: 'Nouvelle scène',
  sky: { top: '#6fb7ff', bottom: '#e6f4ff' },
  timeOfDay: 'day',
  ground: { size: 30, color: '#6aa84f' },
  spawn: { x: 0, z: 5, rotation: 180 },
  player: { speed: 3 },
  camera: { distance: 6, height: 2.5 },
  objects: [
    { id: 'arbre', model: 'arbre', position: [0, 0, -3], animation: 'sway', collider: { radius: 0.5 } },
  ],
};

export const blankTemplate: ProjectTemplate = {
  id: 'sandbox3d-blank',
  name: 'Scène 3D vide',
  description: 'Un sol, un ciel, un arbre et un personnage-capsule : le point de départ pour composer votre scène.',
  manifest: MANIFEST,
  files: [{ path: SCENE_ENTRY, content: blankScene }],
  assets: [
    model3d({
      alias: 'arbre',
      name: 'Arbre',
      template: 'tree',
      seed: 101,
      color: '#4f8f3a',
      animations: ['sway'],
      prompt: 'Un arbre feuillu au tronc brun, feuillage vert arrondi, style low-poly doux',
      tags: ['nature'],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Démo : La Clairière
// ---------------------------------------------------------------------------

const demoAssets: TemplateAssetRequest[] = [
  model3d({
    alias: 'chêne',
    name: 'Chêne',
    template: 'tree',
    seed: 1101,
    color: '#4f8f3a',
    animations: ['sway'],
    prompt: 'Un grand chêne au feuillage généreux et arrondi, tronc épais',
    tags: ['nature'],
  }),
  model3d({
    alias: 'sapin',
    name: 'Sapin',
    template: 'tree',
    seed: 1102,
    color: '#2f6b45',
    animations: ['sway'],
    prompt: 'Un sapin élancé aux branches vert sombre étagées',
    tags: ['nature'],
  }),
  model3d({
    alias: 'bouleau',
    name: 'Bouleau',
    template: 'tree',
    seed: 1103,
    color: '#8dbb4c',
    animations: ['sway'],
    prompt: 'Un bouleau au tronc clair et au feuillage vert tendre',
    tags: ['nature'],
  }),
  model3d({
    alias: 'rocher',
    name: 'Rocher',
    template: 'rock',
    seed: 1201,
    color: '#8a8d91',
    prompt: 'Un rocher gris aux arêtes adoucies',
    tags: ['nature'],
  }),
  model3d({
    alias: 'rocher moussu',
    name: 'Rocher moussu',
    template: 'rock',
    seed: 1202,
    color: '#6f8a5e',
    prompt: 'Un rocher couvert de mousse verte',
    tags: ['nature'],
  }),
  model3d({
    alias: 'champignon',
    name: 'Champignon',
    template: 'mushroom',
    seed: 1301,
    color: '#d8453b',
    prompt: 'Un champignon rouge à pois blancs, style conte de fées',
    tags: ['nature'],
  }),
  model3d({
    alias: 'maison',
    name: 'Chaumière',
    template: 'house',
    seed: 1401,
    color: '#c98f5a',
    prompt: 'Une petite chaumière aux murs crème et au toit de chaume, porte en bois',
    tags: ['bâtiment'],
  }),
  model3d({
    alias: 'puits',
    name: 'Puits',
    template: 'well',
    seed: 1501,
    color: '#9a8f84',
    prompt: 'Un vieux puits en pierre avec un petit toit de bois et un seau',
    tags: ['décor'],
  }),
  model3d({
    alias: 'lanterne',
    name: 'Lanterne',
    template: 'lamp',
    seed: 1601,
    color: '#f2c14e',
    prompt: 'Un lampadaire de jardin en fer forgé avec une lanterne dorée',
    tags: ['décor'],
  }),
  model3d({
    alias: 'barrière',
    name: 'Barrière',
    template: 'fence',
    seed: 1701,
    color: '#9b6b43',
    prompt: 'Une section de barrière en bois rustique',
    tags: ['décor'],
  }),
  model3d({
    alias: 'caisse',
    name: 'Caisse',
    template: 'crate',
    seed: 1801,
    color: '#a0703f',
    prompt: 'Une caisse en bois cerclée de métal',
    tags: ['décor'],
  }),
  model3d({
    alias: 'coffre',
    name: 'Coffre au trésor',
    template: 'chest',
    seed: 1901,
    color: '#b5652b',
    animations: ['open'],
    prompt: 'Un coffre au trésor en bois aux ferrures dorées',
    tags: ['objet'],
  }),
  model3d({
    alias: 'villageoise',
    name: 'Villageoise',
    template: 'character',
    seed: 2001,
    color: '#d86a8f',
    animations: ['idle', 'wave'],
    prompt: 'Une villageoise souriante en robe rose et tablier blanc',
    tags: ['personnage'],
  }),
  model3d({
    alias: 'voyageur',
    name: 'Voyageur',
    template: 'character',
    seed: 2002,
    color: '#3f7fc4',
    animations: ['idle', 'walk'],
    prompt: 'Un jeune voyageur en tunique bleue avec une cape et des bottes',
    tags: ['personnage', 'joueur'],
  }),
  {
    alias: 'musique clairière',
    name: 'Musique de la clairière',
    generator: 'music',
    params: { mood: 'calm', bars: 8, prompt: 'Mélodie paisible de clairière ensoleillée, flûte et harpe' },
    seed: 3001,
    tags: ['musique'],
  },
];

/** Décor posé au sol : rotation (degrés) autour de Y, échelle, rayon de collision (`false` = traversable). */
const prop = (
  id: string,
  model: string,
  x: number,
  z: number,
  options: { rotation?: number; scale?: number; radius: number | false },
): SceneObjectInput => ({
  id,
  model,
  position: [x, 0, z],
  ...(options.rotation ? { rotation: [0, options.rotation, 0] as [number, number, number] } : {}),
  ...(options.scale ? { scale: options.scale } : {}),
  collider: options.radius === false ? false : { radius: options.radius },
});

const tree = (id: string, model: string, x: number, z: number, scale = 1, rotation = 0): SceneObjectInput => ({
  id,
  model,
  position: [x, 0, z],
  rotation: [0, rotation, 0],
  scale,
  animation: 'sway',
  collider: { radius: 0.55 },
});

const demoScene: SceneInput = {
  name: 'La Clairière',
  sky: { top: '#5b9fe0', bottom: '#f4ead2' },
  timeOfDay: 'day',
  fog: { color: '#eef0de', near: 24, far: 75 },
  ground: { size: 36, color: '#6fae4f' },
  spawn: { x: 0, z: 7, rotation: 180 },
  player: { model: 'voyageur', idle: 'idle', walk: 'walk', speed: 3.2, scale: 1 },
  camera: { distance: 6, height: 2.6 },
  music: 'musique clairière',
  objects: [
    // Le hameau
    { id: 'maison', model: 'maison', position: [-6, 0, -8], rotation: [0, 25, 0], collider: { radius: 3 } },
    prop('caisse', 'caisse', -2.4, -9, { rotation: 15, scale: 0.9, radius: 0.5 }),
    { id: 'barriere-1', model: 'barrière', position: [-9, 0, -12.5], collider: { radius: 0.8 } },
    { id: 'barriere-2', model: 'barrière', position: [-7, 0, -12.5], collider: { radius: 0.8 } },
    { id: 'barriere-3', model: 'barrière', position: [-5, 0, -12.5], collider: { radius: 0.8 } },
    { id: 'barriere-4', model: 'barrière', position: [-3, 0, -12.5], collider: { radius: 0.8 } },
    { id: 'lanterne-1', model: 'lanterne', position: [-2, 0, 4], collider: { radius: 0.25 } },
    { id: 'lanterne-2', model: 'lanterne', position: [2, 0, 1], collider: { radius: 0.25 } },
    { id: 'lanterne-3', model: 'lanterne', position: [-3.5, 0, -5.5], collider: { radius: 0.25 } },
    {
      id: 'villageoise',
      model: 'villageoise',
      position: [-1.5, 0, -3.5],
      rotation: [0, 8, 0],
      animation: 'idle',
      collider: { radius: 0.4 },
      interact: {
        text:
          '« Oh, un visiteur ! Bienvenue dans la clairière. Si tu ouvres le vieux coffre près des rochers, ' +
          'garde bien ce que tu y trouves ! »',
        animation: 'wave',
      },
    },
    {
      id: 'puits',
      model: 'puits',
      position: [3.5, 0, -2.5],
      collider: { radius: 0.9 },
      interact: {
        text: 'Un vieux puits couvert de mousse. Tout au fond, l’eau scintille… On dit qu’il exauce les vœux.',
      },
    },
    {
      id: 'coffre',
      model: 'coffre',
      position: [6.5, 0, 3],
      rotation: [0, -115, 0],
      collider: { radius: 0.6 },
      interact: {
        text: 'Le coffre s’ouvre en grinçant… Tu y trouves une carte de la forêt et trois pièces d’or !',
        animation: 'open',
        once: true,
      },
    },
    // Rochers et champignons
    prop('rocher-1', 'rocher', 8, 4.5, { rotation: 30, scale: 1.3, radius: 0.9 }),
    prop('rocher-2', 'rocher moussu', 7.5, 1, { scale: 0.9, radius: 0.6 }),
    prop('rocher-3', 'rocher', -8.5, 5, { rotation: 40, scale: 1.1, radius: 0.8 }),
    {
      id: 'champignon-1',
      model: 'champignon',
      position: [-11, 0, 3.4],
      scale: 0.8,
      collider: false,
      interact: { text: 'Un champignon rouge à pois blancs. Joli… mais sûrement pas comestible.' },
    },
    prop('champignon-2', 'champignon', -10.4, 3.9, { rotation: 60, scale: 0.6, radius: false }),
    prop('champignon-3', 'champignon', -3.2, 12.2, { rotation: 120, scale: 0.7, radius: false }),
    // Lisière de la forêt
    tree('chene-1', 'chêne', -12, 2, 1.1),
    tree('chene-2', 'chêne', 11, -9, 1.2, 70),
    tree('chene-3', 'chêne', -4, 13, 1, 200),
    tree('sapin-1', 'sapin', 13, 8, 1.1, 20),
    tree('sapin-2', 'sapin', -14, -9, 1.2, 140),
    tree('bouleau-1', 'bouleau', -9, 10, 1, 90),
    tree('bouleau-2', 'bouleau', 13, -1, 0.9, 300),
  ],
};

export const demoTemplate: ProjectTemplate = {
  id: 'sandbox3d-demo',
  name: 'Démo : La Clairière',
  description:
    'Une clairière paisible à explorer : chaumière, puits, lanternes, coffre au trésor et une villageoise ' +
    'qui vous salue. Modèles et animations générés, musique douce.',
  manifest: MANIFEST,
  files: [{ path: SCENE_ENTRY, content: demoScene }],
  assets: demoAssets,
};

export const sandbox3dTemplates: ProjectTemplate[] = [blankTemplate, demoTemplate];

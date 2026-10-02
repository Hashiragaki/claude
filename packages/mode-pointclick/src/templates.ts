import type { ProjectTemplate, TemplateAssetRequest } from '@forge/core';
import {
  POINTCLICK_ITEMS_PATH,
  POINTCLICK_SYSTEM_PATH,
  scenePath,
  type ItemsFileInput,
  type PointClickSystemInput,
  type SceneInput,
} from './schema';

/**
 * Modèles de projet du mode point & click : une scène vide (« pointclick-empty ») et une démo
 * jouable complète (« pointclick-demo », « Le Phare oublié »). Les assets sont générés de façon
 * procédurale (graines fixes) à la création du projet.
 */

// ---------------------------------------------------------------------------
// Demandes d'assets procéduraux
// ---------------------------------------------------------------------------

/** Décor 1280 × 720 (les coordonnées des scènes sont en pixels de l'image). */
function backgroundAsset(
  alias: string,
  name: string,
  scene: string,
  timeOfDay: 'day' | 'sunset' | 'night',
  seed: number,
  prompt: string,
): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'background', scene, timeOfDay, width: 1280, height: 720, prompt },
    seed,
    tags: ['pointclick', 'décor'],
  };
}

/** Icône d'inventaire ou objet posé sur la scène (le mot-clé anglais du prompt choisit le dessin). */
function objectAsset(
  alias: string,
  name: string,
  subject: 'icon' | 'object',
  seed: number,
  prompt: string,
): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject, prompt },
    seed,
    tags: ['pointclick', subject === 'icon' ? 'icône' : 'objet'],
  };
}

function portraitAsset(alias: string, name: string, seed: number, prompt: string): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'portrait', character: name, hairStyle: 'short', prompt },
    seed,
    tags: ['pointclick', 'personnage'],
  };
}

function charsetAsset(alias: string, name: string, seed: number, prompt: string): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'charset',
    params: {
      skinTone: '#f1c7a3',
      hairColor: '#4a2f1d',
      hairStyle: 'ponytail',
      outfitColor: '#2f7fb8',
      outfitStyle: 'tunic',
      accessory: 'none',
      prompt,
    },
    seed,
    tags: ['pointclick', 'charset'],
  };
}

type MusicMood = 'calm' | 'happy' | 'tense' | 'sad' | 'epic' | 'mysterious' | 'battle' | 'village';

function musicAsset(alias: string, name: string, mood: MusicMood, seed: number, prompt: string): TemplateAssetRequest {
  return { alias, name, generator: 'music', params: { mood, bars: 8, prompt }, seed, tags: ['pointclick', 'musique'] };
}

type SfxPreset = 'coin' | 'powerup' | 'cancel' | 'door';

function sfxAsset(alias: string, name: string, preset: SfxPreset, seed: number, prompt: string): TemplateAssetRequest {
  return { alias, name, generator: 'sfx', params: { preset, prompt }, seed, tags: ['pointclick', 'son'] };
}

/** Zone de marche rectangulaire occupant la partie basse de l'image. */
const floor = (topY: number) => [
  [
    { x: 0, y: topY },
    { x: 1280, y: topY },
    { x: 1280, y: 720 },
    { x: 0, y: 720 },
  ],
];

// ---------------------------------------------------------------------------
// Modèle « vide »
// ---------------------------------------------------------------------------

const EMPTY_SYSTEM: PointClickSystemInput = {
  title: 'Mon point & click',
  startScene: 'scene1',
  scenes: ['scene1'],
  playerCharset: 'charset-heroine',
  playerName: 'Héroïne',
};

const EMPTY_SCENE: SceneInput = {
  id: 'scene1',
  name: 'Première scène',
  background: 'fond-scene1',
  walkArea: floor(540),
  playerStart: { x: 640, y: 640 },
  depthScale: { topY: 540, topScale: 0.7, bottomY: 720, bottomScale: 1.1 },
  hotspots: [
    {
      id: 'panneau',
      name: 'Panneau',
      shape: { type: 'rect', x: 560, y: 300, w: 160, h: 160 },
      walkTo: { x: 640, y: 580 },
      description: 'Un panneau. Cliquez dessus pour interagir, clic droit pour regarder.',
      interactions: [
        {
          actions: [
            {
              type: 'say',
              text: 'Bienvenue ! Modifiez les scènes dans « scenes/ » et les objets dans « data/items.json ».',
            },
          ],
        },
      ],
    },
  ],
};

export const pointClickEmptyTemplate: ProjectTemplate = {
  id: 'pointclick-empty',
  name: 'Point & click vide',
  description: 'Une scène illustrée avec une zone cliquable d’exemple, pour démarrer.',
  manifest: {
    resolution: { width: 1280, height: 720 },
    pixelArt: false,
    entry: POINTCLICK_SYSTEM_PATH,
    description: 'Un nouveau jeu d’aventure point & click.',
  },
  files: [
    { path: POINTCLICK_SYSTEM_PATH, content: EMPTY_SYSTEM },
    { path: scenePath('scene1'), content: EMPTY_SCENE },
  ],
  assets: [
    backgroundAsset('fond-scene1', 'Fond : première scène', 'park', 'day', 6001, 'Parc ensoleillé, parc'),
    charsetAsset('charset-heroine', 'Héroïne', 6002, 'Jeune aventurière en tunique bleue'),
  ],
};

// ---------------------------------------------------------------------------
// Modèle « démo » : Le Phare oublié
// ---------------------------------------------------------------------------

const DEMO_SYSTEM: PointClickSystemInput = {
  title: 'Le Phare oublié',
  startScene: 'plage',
  scenes: ['plage', 'cabane', 'phare', 'falaise'],
  playerCharset: 'charset-mila',
  playerName: 'Mila',
  walkSpeed: 260,
  variables: { porte_ouverte: false, gardien_parle: false, lentille_posee: false },
  titleMusic: 'musique-plage',
  sfx: { pickup: 'sfx-ramasser', combine: 'sfx-combiner', fail: 'sfx-echec', door: 'sfx-porte' },
  defaultFail: 'Ça ne donne rien.',
};

const DEMO_ITEMS: ItemsFileInput = {
  items: [
    {
      id: 'huile',
      name: 'Fiole d’huile',
      icon: 'icone-huile',
      description: 'De l’huile de lampe, presque pleine. Elle sent la mer.',
    },
    {
      id: 'lentille',
      name: 'Éclat de verre poli',
      icon: 'icone-lentille',
      description: 'Un morceau de verre épais, poli par les vagues. Il concentre la lumière comme une lentille.',
    },
    {
      id: 'meche',
      name: 'Mèche de lin',
      icon: 'icone-meche',
      description: 'Une longue mèche de lin tressé, sèche et souple.',
    },
    {
      id: 'cle',
      name: 'Vieille clé',
      icon: 'icone-cle',
      description: 'Une grosse clé de fer rouillée. Elle ouvre le phare.',
    },
    {
      id: 'torche',
      name: 'Torche improvisée',
      icon: 'icone-torche',
      description: 'Un bâton, une mèche et de l’huile. Il ne manque qu’une flamme… et le fanal en a une.',
    },
  ],
  combinations: [
    {
      a: 'meche',
      b: 'huile',
      result: 'torche',
      actions: [
        {
          type: 'say',
          speaker: 'Mila',
          text: 'Je trempe la mèche dans l’huile et je l’enroule autour d’un bâton : une torche !',
        },
      ],
    },
  ],
};

const PLAGE: SceneInput = {
  id: 'plage',
  name: 'La plage',
  background: 'fond-plage',
  music: 'musique-plage',
  walkArea: floor(530),
  playerStart: { x: 640, y: 640 },
  depthScale: { topY: 530, topScale: 0.7, bottomY: 720, bottomScale: 1.1 },
  onFirstEnter: [
    {
      type: 'say',
      speaker: 'Mila',
      text: 'Le phare du cap est éteint depuis des années. Si je le rallumais, les bateaux retrouveraient leur chemin.',
    },
    { type: 'say', speaker: 'Mila', text: 'Allons voir si quelqu’un sait ce qu’il lui faut.' },
  ],
  hotspots: [
    {
      id: 'parasol',
      name: 'Parasol',
      shape: { type: 'rect', x: 180, y: 420, w: 250, h: 190 },
      walkTo: { x: 300, y: 650 },
      description: 'Un vieux parasol rouge, décoloré par le soleil.',
    },
    {
      id: 'serviette',
      name: 'Serviette de plage',
      shape: { type: 'rect', x: 230, y: 620, w: 210, h: 80 },
      walkTo: { x: 330, y: 705 },
      description: 'Une serviette rayée. Quelque chose dépasse en dessous.',
      interactions: [
        {
          actions: [
            { type: 'say', speaker: 'Mila', text: 'Une fiole était coincée sous la serviette !' },
            { type: 'show', hotspot: 'fiole' },
            { type: 'hide', hotspot: 'serviette' },
          ],
        },
      ],
    },
    {
      id: 'fiole',
      name: 'Fiole',
      shape: { type: 'rect', x: 340, y: 618, w: 56, h: 66 },
      sprite: 'sprite-fiole',
      walkTo: { x: 370, y: 705 },
      hidden: true,
      description: 'Une petite fiole remplie d’un liquide huileux.',
      interactions: [
        {
          actions: [
            { type: 'give', item: 'huile' },
            { type: 'hide', hotspot: 'fiole' },
            { type: 'say', speaker: 'Mila', text: 'De l’huile de lampe ! Ça pourrait servir.' },
          ],
        },
      ],
    },
    {
      id: 'etoile',
      name: 'Étoile de mer',
      shape: { type: 'rect', x: 595, y: 622, w: 50, h: 44 },
      walkTo: { x: 620, y: 690 },
      description: 'Une étoile de mer orange. Quelque chose brille en dessous.',
      interactions: [
        {
          actions: [
            { type: 'say', speaker: 'Mila', text: 'Sous l’étoile de mer, un éclat de verre poli brille au soleil.' },
            { type: 'give', item: 'lentille' },
            { type: 'hide', hotspot: 'etoile' },
          ],
        },
      ],
    },
    {
      id: 'palmier',
      name: 'Palmier',
      shape: { type: 'rect', x: 930, y: 240, w: 240, h: 460 },
      walkTo: { x: 1010, y: 690 },
      description: 'Un palmier penché par des années de vent.',
    },
    {
      id: 'vers-cabane',
      name: 'Cabane du gardien',
      kind: 'exit',
      shape: { type: 'rect', x: 0, y: 500, w: 110, h: 220 },
      walkTo: { x: 60, y: 640 },
      description: 'Un sentier mène à la cabane du gardien du phare.',
      interactions: [{ actions: [{ type: 'goto', scene: 'cabane', x: 1180, y: 690 }] }],
    },
    {
      id: 'vers-phare',
      name: 'Le phare',
      kind: 'exit',
      shape: { type: 'rect', x: 1190, y: 500, w: 90, h: 220 },
      walkTo: { x: 1235, y: 640 },
      description: 'Le chemin du phare, sur la falaise.',
      interactions: [{ actions: [{ type: 'goto', scene: 'phare', x: 640, y: 690 }] }],
    },
  ],
};

const CABANE: SceneInput = {
  id: 'cabane',
  name: 'La cabane du gardien',
  background: 'fond-cabane',
  music: 'musique-cabane',
  walkArea: [
    [
      { x: 0, y: 570 },
      { x: 760, y: 570 },
      { x: 780, y: 640 },
      { x: 1280, y: 640 },
      { x: 1280, y: 720 },
      { x: 0, y: 720 },
    ],
  ],
  playerStart: { x: 1180, y: 690 },
  depthScale: { topY: 570, topScale: 0.8, bottomY: 720, bottomScale: 1.1 },
  hotspots: [
    {
      id: 'fenetre',
      name: 'Fenêtre',
      shape: { type: 'rect', x: 180, y: 90, w: 260, h: 290 },
      walkTo: { x: 310, y: 600 },
      description: 'Par la fenêtre, on aperçoit les collines. Le phare est trop loin pour être visible.',
    },
    {
      id: 'tableau',
      name: 'Tableau',
      shape: { type: 'rect', x: 616, y: 126, w: 128, h: 158 },
      walkTo: { x: 680, y: 600 },
      description: 'Une peinture de montagnes. Le gardien l’a signée « pour ne pas oublier le large ».',
    },
    {
      id: 'livres',
      name: 'Livres',
      shape: { type: 'rect', x: 178, y: 388, w: 76, h: 62 },
      walkTo: { x: 215, y: 600 },
      description: 'Des livres sur les phares, les marées et les nœuds marins.',
    },
    {
      id: 'tiroir',
      name: 'Tiroir du bureau',
      shape: { type: 'rect', x: 300, y: 472, w: 120, h: 100 },
      walkTo: { x: 360, y: 600 },
      description: 'Un tiroir légèrement entrouvert.',
      interactions: [
        {
          actions: [
            { type: 'say', speaker: 'Mila', text: 'Dans le tiroir, une longue mèche de lin tressé.' },
            { type: 'give', item: 'meche' },
            { type: 'hide', hotspot: 'tiroir' },
          ],
        },
      ],
    },
    {
      id: 'lit',
      name: 'Lit',
      shape: { type: 'rect', x: 760, y: 300, w: 500, h: 330 },
      walkTo: { x: 700, y: 600 },
      description: 'Un lit étroit, très bien fait. Le gardien est un homme ordonné.',
    },
    {
      id: 'gardien',
      name: 'Gardien',
      kind: 'character',
      shape: { type: 'rect', x: 520, y: 380, w: 200, h: 300 },
      sprite: 'sprite-gardien',
      spriteAt: { x: 520, y: 380, w: 200, h: 300 },
      walkTo: { x: 620, y: 700 },
      description: 'Le vieux gardien du phare. Il a l’air fatigué, mais son regard est vif.',
      interactions: [
        {
          actions: [
            {
              type: 'dialogue',
              speaker: 'Gardien',
              prompt: 'Alors, jeune voyageuse ?',
              choices: [
                {
                  text: 'Qui êtes-vous ?',
                  once: true,
                  actions: [
                    {
                      type: 'say',
                      speaker: 'Gardien',
                      text: 'Je gardais le phare du cap. Depuis qu’il s’est éteint, je garde surtout ma cabane.',
                    },
                  ],
                },
                {
                  text: 'Pourquoi le phare est-il éteint ?',
                  once: true,
                  actions: [
                    {
                      type: 'say',
                      speaker: 'Gardien',
                      text: 'Plus d’huile, plus de mèche, et la lentille du fanal s’est brisée dans la tempête.',
                    },
                    { type: 'set', var: 'gardien_parle', value: 'True' },
                  ],
                },
                {
                  text: 'Pourriez-vous m’ouvrir le phare ?',
                  once: true,
                  condition: 'gardien_parle',
                  actions: [
                    {
                      type: 'say',
                      speaker: 'Gardien',
                      text: 'Si tu veux le rallumer, prends ma clé. Sur la falaise, pose une lentille puis approche une flamme du fanal.',
                    },
                    { type: 'give', item: 'cle' },
                  ],
                },
                { text: 'À bientôt.', actions: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sortie',
      name: 'Sortie vers la plage',
      kind: 'exit',
      shape: { type: 'rect', x: 1100, y: 655, w: 180, h: 65 },
      walkTo: { x: 1180, y: 690 },
      interactions: [{ actions: [{ type: 'goto', scene: 'plage', x: 130, y: 650 }] }],
    },
  ],
};

const PHARE: SceneInput = {
  id: 'phare',
  name: 'Au pied du phare',
  background: 'fond-phare',
  music: 'musique-phare',
  walkArea: floor(570),
  playerStart: { x: 640, y: 690 },
  depthScale: { topY: 570, topScale: 0.75, bottomY: 720, bottomScale: 1.1 },
  hotspots: [
    {
      id: 'tour',
      name: 'Tour du phare',
      shape: { type: 'rect', x: 640, y: 50, w: 100, h: 330 },
      walkTo: { x: 690, y: 590 },
      description: 'La haute tour du phare. Son fanal est éteint depuis des années.',
    },
    {
      id: 'arbre-gauche',
      name: 'Vieux chêne',
      shape: { type: 'rect', x: 0, y: 200, w: 310, h: 460 },
      walkTo: { x: 200, y: 680 },
      description: 'Un chêne immense, tordu par le vent du large.',
    },
    {
      id: 'arbre-droit',
      name: 'Chêne noueux',
      shape: { type: 'rect', x: 1000, y: 270, w: 280, h: 420 },
      walkTo: { x: 1120, y: 700 },
      description: 'Les branches de ce chêne grincent dans la nuit.',
    },
    {
      id: 'porte',
      name: 'Porte du phare',
      kind: 'exit',
      shape: { type: 'rect', x: 655, y: 385, w: 70, h: 85 },
      walkTo: { x: 690, y: 590 },
      description: 'Une lourde porte de bois cerclée de fer.',
      interactions: [
        {
          condition: 'porte_ouverte',
          actions: [
            { type: 'sound', asset: 'sfx-porte' },
            { type: 'goto', scene: 'falaise', x: 600, y: 690 },
          ],
        },
        {
          item: 'cle',
          actions: [
            { type: 'sound', asset: 'sfx-porte' },
            { type: 'set', var: 'porte_ouverte', value: 'True' },
            {
              type: 'say',
              speaker: 'Mila',
              text: 'La clé tourne dans un grincement. La porte s’ouvre sur l’escalier !',
            },
            { type: 'goto', scene: 'falaise', x: 600, y: 690 },
          ],
        },
        {
          actions: [{ type: 'say', speaker: 'Mila', text: 'La porte est verrouillée. Il me faut une clé.' }],
        },
      ],
    },
    {
      id: 'retour-plage',
      name: 'Retour à la plage',
      kind: 'exit',
      shape: { type: 'rect', x: 560, y: 672, w: 200, h: 48 },
      walkTo: { x: 660, y: 700 },
      interactions: [{ actions: [{ type: 'goto', scene: 'plage', x: 1150, y: 650 }] }],
    },
  ],
};

const FALAISE: SceneInput = {
  id: 'falaise',
  name: 'Le sommet du phare',
  background: 'fond-falaise',
  music: 'musique-falaise',
  walkArea: floor(600),
  playerStart: { x: 600, y: 690 },
  depthScale: { topY: 600, topScale: 0.8, bottomY: 720, bottomScale: 1.1 },
  onFirstEnter: [
    {
      type: 'say',
      speaker: 'Mila',
      text: 'Le sommet ! Le fanal est là, sous le vieux chêne, froid et sombre.',
    },
  ],
  hotspots: [
    {
      id: 'chene',
      name: 'Chêne du sommet',
      shape: { type: 'rect', x: 830, y: 220, w: 300, h: 160 },
      walkTo: { x: 960, y: 640 },
      description: 'Le chêne du sommet, battu par les vents.',
    },
    {
      id: 'fanal',
      name: 'Fanal du phare',
      shape: { type: 'rect', x: 905, y: 380, w: 150, h: 110 },
      walkTo: { x: 960, y: 640 },
      description: 'Le grand fanal de cuivre. Il lui faut une lentille et une flamme.',
      interactions: [
        {
          item: 'lentille',
          condition: 'not lentille_posee',
          actions: [
            { type: 'remove', item: 'lentille' },
            { type: 'set', var: 'lentille_posee', value: 'True' },
            {
              type: 'say',
              speaker: 'Mila',
              text: 'J’enchâsse l’éclat de verre dans le fanal. Il accroche déjà le dernier rayon du soleil.',
            },
          ],
        },
        {
          item: 'torche',
          condition: 'lentille_posee',
          actions: [
            { type: 'remove', item: 'torche' },
            { type: 'sound', asset: 'sfx-combiner' },
            {
              type: 'say',
              speaker: 'Mila',
              text: 'La mèche prend. La lentille amplifie la flamme : le faisceau balaie la mer !',
            },
            {
              type: 'end',
              text: 'Le phare brille de nouveau. Au large, un cargo répond d’un coup de sirène : les bateaux ont retrouvé leur chemin.',
            },
          ],
        },
        {
          item: 'torche',
          actions: [
            {
              type: 'say',
              speaker: 'Mila',
              text: 'Sans lentille, la flamme se perdrait dans le vide. Il me faut d’abord de quoi concentrer la lumière.',
            },
          ],
        },
        {
          actions: [
            {
              type: 'say',
              speaker: 'Mila',
              text: 'Le fanal est éteint. Il lui faut une lentille et une flamme.',
            },
          ],
        },
      ],
    },
    {
      id: 'retour-phare',
      name: 'Descendre',
      kind: 'exit',
      shape: { type: 'rect', x: 520, y: 650, w: 160, h: 70 },
      walkTo: { x: 600, y: 690 },
      interactions: [{ actions: [{ type: 'goto', scene: 'phare', x: 690, y: 600 }] }],
    },
  ],
};

export const pointClickDemoTemplate: ProjectTemplate = {
  id: 'pointclick-demo',
  name: 'Démo : Le Phare oublié',
  description:
    'Aventure en quatre scènes : trouvez de l’huile, une mèche, une lentille et la clé du gardien pour rallumer le phare.',
  manifest: {
    resolution: { width: 1280, height: 720 },
    pixelArt: false,
    entry: POINTCLICK_SYSTEM_PATH,
    description: 'Une petite aventure point & click : rallumez le phare oublié.',
  },
  files: [
    { path: POINTCLICK_SYSTEM_PATH, content: DEMO_SYSTEM },
    { path: POINTCLICK_ITEMS_PATH, content: DEMO_ITEMS },
    { path: scenePath('plage'), content: PLAGE },
    { path: scenePath('cabane'), content: CABANE },
    { path: scenePath('phare'), content: PHARE },
    { path: scenePath('falaise'), content: FALAISE },
  ],
  assets: [
    backgroundAsset('fond-plage', 'Fond : plage', 'beach', 'sunset', 6101, 'Plage au coucher du soleil, plage'),
    backgroundAsset('fond-cabane', 'Fond : cabane', 'bedroom', 'day', 6102, 'Intérieur de la cabane du gardien'),
    backgroundAsset('fond-phare', 'Fond : pied du phare', 'castle', 'night', 6103, 'Tour du phare la nuit'),
    backgroundAsset('fond-falaise', 'Fond : sommet', 'generic', 'sunset', 6104, 'Sommet de la falaise au crépuscule'),
    objectAsset('icone-huile', 'Icône : huile', 'icon', 6105, 'potion, fiole d’huile'),
    objectAsset('icone-lentille', 'Icône : lentille', 'icon', 6106, 'gem, éclat de verre poli'),
    objectAsset('icone-meche', 'Icône : mèche', 'icon', 6107, 'scroll, mèche de lin enroulée'),
    objectAsset('icone-cle', 'Icône : clé', 'icon', 6108, 'key, vieille clé de fer'),
    objectAsset('icone-torche', 'Icône : torche', 'icon', 6109, 'staff, torche improvisée'),
    objectAsset('sprite-fiole', 'Objet : fiole', 'object', 6110, 'potion, petite fiole'),
    portraitAsset('sprite-gardien', 'Gardien', 6111, 'Vieux gardien de phare barbu en ciré'),
    charsetAsset('charset-mila', 'Mila', 6112, 'Jeune fille curieuse en tunique bleue'),
    musicAsset('musique-plage', 'Musique : plage', 'calm', 6113, 'Bord de mer apaisant, clapotis'),
    musicAsset('musique-cabane', 'Musique : cabane', 'village', 6114, 'Chaleureux, intérieur de cabane'),
    musicAsset('musique-phare', 'Musique : phare', 'mysterious', 6115, 'Nuit mystérieuse au pied du phare'),
    musicAsset('musique-falaise', 'Musique : sommet', 'epic', 6116, 'Sommet venteux, souffle épique'),
    sfxAsset('sfx-ramasser', 'Son : ramasser', 'coin', 6117, 'Objet ramassé'),
    sfxAsset('sfx-combiner', 'Son : combiner', 'powerup', 6118, 'Objets assemblés'),
    sfxAsset('sfx-echec', 'Son : échec', 'cancel', 6119, 'Action sans effet'),
    sfxAsset('sfx-porte', 'Son : porte', 'door', 6120, 'Porte qui grince'),
  ],
};

/** Modèles de projet du mode point & click : vide et démo. */
export const POINTCLICK_TEMPLATES: ProjectTemplate[] = [pointClickEmptyTemplate, pointClickDemoTemplate];

import type { ProjectTemplate, TemplateAssetRequest } from '@forge/core';
import { LevelBuilder } from './levelBuilder';
import { PLATFORMER_SYSTEM_PATH, levelPath, type PlatformerSystemInput } from './schema';

/**
 * Modèles de projet du mode plateformer : un niveau minimal (« plateformer-empty ») et une
 * démo jouable de deux niveaux (« plateformer-demo »). Voir `packages/mode-rpg/src/templates.ts`
 * pour le modèle imité.
 */

// ---------------------------------------------------------------------------
// Demandes d'assets procéduraux (graines fixes → résultat reproductible)
// ---------------------------------------------------------------------------

type PlatformTilesetTheme = 'grassland' | 'cave' | 'castle' | 'snow' | 'desert';

/** Tileset « vue de côté » (générateur `tileset.side`, écrit séparément). */
function tilesetSideAsset(
  alias: string,
  name: string,
  theme: PlatformTilesetTheme,
  seed: number,
  prompt: string,
): TemplateAssetRequest {
  return { alias, name, generator: 'tileset.side', params: { theme, prompt }, seed, tags: ['platformer', 'tileset'] };
}

interface PlayerCharsetParams {
  prompt: string;
  skinTone?: string;
  hairColor?: string;
  outfitColor?: string;
  hairStyle?: 'short' | 'long' | 'spiky' | 'bald' | 'ponytail' | 'hood';
  outfitStyle?: 'tunic' | 'robe' | 'armor' | 'dress';
  accessory?: 'none' | 'hat' | 'helmet' | 'crown' | 'glasses';
}

/** Charset du joueur (disposition RPG standard, réutilisée telle quelle par le mode plateformer). */
function charsetAsset(alias: string, name: string, params: PlayerCharsetParams, seed: number): TemplateAssetRequest {
  return { alias, name, generator: 'charset', params: { ...params }, seed, tags: ['platformer', 'charset'] };
}

/** Fond plein écran (défilement parallaxe), à la résolution du mode (480 × 270). */
function backgroundAsset(alias: string, name: string, seed: number, prompt: string): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'background', width: 480, height: 270, prompt },
    seed,
    tags: ['platformer', 'décor'],
  };
}

type PlatformMusicMood = 'calm' | 'happy' | 'tense' | 'sad' | 'epic' | 'mysterious' | 'battle' | 'village';

function musicAsset(
  alias: string,
  name: string,
  mood: PlatformMusicMood,
  seed: number,
  prompt: string,
): TemplateAssetRequest {
  return { alias, name, generator: 'music', params: { mood, bars: 8, prompt }, seed, tags: ['platformer', 'musique'] };
}

/** Effets sonores utilisés par `PlatformerSfxSchema` (`jump`, `coin`, `hurt`, `spring`). */
type PlatformSfxPreset = 'jump' | 'coin' | 'hit' | 'powerup';

function sfxAsset(
  alias: string,
  name: string,
  preset: PlatformSfxPreset,
  seed: number,
  prompt: string,
): TemplateAssetRequest {
  return { alias, name, generator: 'sfx', params: { preset, prompt }, seed, tags: ['platformer', 'son'] };
}

// ---------------------------------------------------------------------------
// Modèle « vide » : un petit niveau jouable
// ---------------------------------------------------------------------------

function buildEmptyLevel() {
  return new LevelBuilder('niveau1', 30, 15, 'tileset-prairie')
    .name('Prairie')
    .background('fond-prairie')
    .backgroundColor('#79c5f2')
    .music('musique-prairie')
    .ground(0, 29, 12)
    .pit(14, 16)
    .platform(12, 18, 8)
    .coins(4, 8, 10)
    .spring(20, 11)
    .sign(4, 11, 'Bienvenue dans votre nouveau plateformer ! Modifiez les niveaux dans « levels/ ».')
    .start(2, 11)
    .goal(26, 11)
    .build();
}

const EMPTY_SYSTEM: PlatformerSystemInput = {
  title: 'Mon plateformer',
  levels: ['niveau1'],
  playerCharset: 'charset-joueur',
  levelMusic: 'musique-prairie',
  sfx: { jump: 'sfx-saut', coin: 'sfx-piece', hurt: 'sfx-coup', spring: 'sfx-bonus' },
};

export const platformerEmptyTemplate: ProjectTemplate = {
  id: 'platformer-empty',
  name: 'Plateformer vide',
  description: 'Un petit niveau de prairie avec un trou, une plateforme et un ressort pour démarrer.',
  manifest: {
    resolution: { width: 480, height: 270 },
    pixelArt: true,
    entry: PLATFORMER_SYSTEM_PATH,
    description: 'Un nouveau plateformer 2D.',
  },
  files: [
    { path: PLATFORMER_SYSTEM_PATH, content: EMPTY_SYSTEM },
    { path: levelPath('niveau1'), content: buildEmptyLevel() },
  ],
  assets: [
    tilesetSideAsset('tileset-prairie', 'Tuiles : prairie', 'grassland', 4001, 'Prairie ensoleillée, herbe et terre'),
    charsetAsset(
      'charset-joueur',
      'Joueur',
      {
        skinTone: '#f1c7a3',
        hairColor: '#6b3e26',
        hairStyle: 'short',
        outfitColor: '#d1452f',
        outfitStyle: 'tunic',
        accessory: 'none',
        prompt: 'Aventurier agile en tunique rouge',
      },
      4002,
    ),
    backgroundAsset('fond-prairie', 'Fond : prairie', 4003, 'Collines vertes et ciel bleu, vue lointaine'),
    musicAsset('musique-prairie', 'Musique : prairie', 'happy', 4004, 'Thème guilleret de prairie ensoleillée'),
    sfxAsset('sfx-saut', 'Son : saut', 'jump', 4005, 'Petit saut sautillant'),
    sfxAsset('sfx-piece', 'Son : pièce', 'coin', 4006, 'Pièce ramassée, joyeuse'),
    sfxAsset('sfx-coup', 'Son : coup', 'hit', 4007, 'Le joueur est touché'),
    sfxAsset('sfx-bonus', 'Son : bonus', 'powerup', 4008, 'Ressort qui propulse le joueur'),
  ],
};

// ---------------------------------------------------------------------------
// Modèle « démo » : deux niveaux (prairie puis grotte)
// ---------------------------------------------------------------------------

/** Prairie (120 × 15) : pièces, ennemis marcheurs, ressort, plateformes, point de contrôle, panneau, trous. */
function buildPrairieLevel() {
  return (
    new LevelBuilder('prairie', 120, 15, 'tileset-prairie')
      .name('Prairie')
      .background('fond-prairie')
      .backgroundColor('#79c5f2')
      .music('musique-prairie')
      .next('grotte')
      // Plateau de départ
      .ground(0, 13, 12)
      // Premier trou, franchissable en sautant
      .pit(14, 16)
      // Deuxième plateau avec une plateforme flottante et des pièces
      .ground(17, 40, 12)
      .platform(25, 29, 8)
      .coins(26, 28, 7)
      .enemy(34, 11, { kind: 'walker', range: 4 })
      // Deuxième trou
      .pit(41, 43)
      // Troisième plateau : ressort vers des blocs flottants, point de contrôle
      .ground(44, 70, 12)
      .spring(46, 11)
      .blocks(50, 54, 6, 'brick')
      .coins(51, 53, 5)
      .checkpoint(65, 11)
      // Troisième trou
      .pit(71, 73)
      // Quatrième plateau : ennemi et pièces
      .ground(74, 95, 12)
      .enemy(80, 11, { kind: 'walker', range: 5 })
      .coins(85, 89, 10)
      // Quatrième trou
      .pit(96, 98)
      // Plateau final : panneau d'aide et arrivée
      .ground(99, 119, 12)
      .sign(101, 11, 'Sautez par-dessus les trous et évitez les ennemis. Bonne chance !')
      .goal(117, 11)
      .start(2, 11)
      .build()
  );
}

/** Grotte (100 × 15) : pics, eau, ennemis sauteurs, plateformes à sens unique, temps limité. */
function buildGrotteLevel() {
  return (
    new LevelBuilder('grotte', 100, 15, 'tileset-grotte')
      .name('Grotte')
      .background('fond-grotte')
      .backgroundColor('#1c2333')
      .music('musique-grotte')
      .timeLimit(180)
      // Premier plateau : pics et eau à éviter, ennemi sauteur
      .ground(0, 40, 12)
      .spikes(11, 14, 12)
      .water(20, 26, 12)
      .enemy(30, 11, { kind: 'hopper', range: 4 })
      // Premier gouffre, franchi par une plateforme à sens unique
      .pit(41, 45)
      .platform(41, 45, 10)
      // Deuxième plateau : point de contrôle et nouveaux pics
      .ground(46, 70, 12)
      .checkpoint(50, 11)
      .spikes(60, 63, 12)
      // Deuxième gouffre, franchi par une plateforme à sens unique
      .pit(71, 74)
      .platform(71, 74, 9)
      // Plateau final : ennemi sauteur, pièces et arrivée
      .ground(75, 99, 12)
      .enemy(85, 11, { kind: 'hopper', range: 5 })
      .coins(90, 94, 10)
      .goal(97, 11)
      .start(2, 11)
      .build()
  );
}

const DEMO_SYSTEM: PlatformerSystemInput = {
  title: 'Les Cavernes de Lumen',
  levels: ['prairie', 'grotte'],
  startLevel: 'prairie',
  playerCharset: 'charset-joueur',
  sfx: { jump: 'sfx-saut', coin: 'sfx-piece', hurt: 'sfx-coup', spring: 'sfx-bonus' },
};

export const platformerDemoTemplate: ProjectTemplate = {
  id: 'platformer-demo',
  name: 'Plateformer démo',
  description: 'Deux niveaux jouables : une prairie à ciel ouvert puis une grotte chronométrée.',
  manifest: {
    resolution: { width: 480, height: 270 },
    pixelArt: true,
    entry: PLATFORMER_SYSTEM_PATH,
    description: 'Une courte aventure de plateforme : la prairie, puis la grotte.',
  },
  files: [
    { path: PLATFORMER_SYSTEM_PATH, content: DEMO_SYSTEM },
    { path: levelPath('prairie'), content: buildPrairieLevel() },
    { path: levelPath('grotte'), content: buildGrotteLevel() },
  ],
  assets: [
    tilesetSideAsset('tileset-prairie', 'Tuiles : prairie', 'grassland', 5001, 'Prairie ensoleillée, herbe et terre'),
    tilesetSideAsset('tileset-grotte', 'Tuiles : grotte', 'cave', 5002, 'Grotte sombre, pierre et stalactites'),
    charsetAsset(
      'charset-joueur',
      'Joueur',
      {
        skinTone: '#e8b48a',
        hairColor: '#3d2b1f',
        hairStyle: 'spiky',
        outfitColor: '#2f6fd1',
        outfitStyle: 'tunic',
        accessory: 'none',
        prompt: 'Aventurier intrépide en tunique bleue',
      },
      5003,
    ),
    backgroundAsset('fond-prairie', 'Fond : prairie', 5004, 'Collines vertes et ciel bleu, vue lointaine'),
    backgroundAsset('fond-grotte', 'Fond : grotte', 5005, 'Parois de roche sombres, lueurs bleutées lointaines'),
    musicAsset('musique-prairie', 'Musique : prairie', 'happy', 5006, 'Thème guilleret de prairie ensoleillée'),
    musicAsset('musique-grotte', 'Musique : grotte', 'mysterious', 5007, 'Thème mystérieux et feutré de grotte'),
    sfxAsset('sfx-saut', 'Son : saut', 'jump', 5008, 'Petit saut sautillant'),
    sfxAsset('sfx-piece', 'Son : pièce', 'coin', 5009, 'Pièce ramassée, joyeuse'),
    sfxAsset('sfx-coup', 'Son : coup', 'hit', 5010, 'Le joueur est touché'),
    sfxAsset('sfx-bonus', 'Son : bonus', 'powerup', 5011, 'Ressort qui propulse le joueur'),
  ],
};

/** Modèles de projet du mode plateformer : vide et démo. */
export const PLATFORMER_TEMPLATES: ProjectTemplate[] = [platformerEmptyTemplate, platformerDemoTemplate];

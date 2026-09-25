import { z } from 'zod';

/**
 * Formats de données du mode plateformer (fichiers JSON du projet) :
 * - `data/platformer.json` : réglages généraux (entrée du manifeste) ;
 * - `levels/<id>.json` : niveaux en tuiles vus de côté avec leurs entités.
 *
 * Unités : les positions des niveaux et des entités sont en **cases** (tuiles de 16 px, origine en
 * haut à gauche, `y` vers le bas) ; les vitesses et forces sont en **pixels monde** par seconde
 * (avant le zoom d'affichage). Les tuiles suivent `PLATFORM_TILE_ROLES` de `@forge/core` : l'index
 * d'une tuile donne sa collision (`solid`, `oneway`, `hazard`, `none`), quel que soit le thème.
 */

const AssetRefSchema = z.string().min(1);
const TileCoordSchema = z.number().int().min(0);

// ---------------------------------------------------------------------------
// Réglages généraux
// ---------------------------------------------------------------------------

/** Physique du joueur (pixels monde par seconde). */
export const PlayerPhysicsSchema = z.object({
  /** Vitesse horizontale maximale. */
  runSpeed: z.number().positive().default(90),
  /** Accélération horizontale au sol ; en l'air elle est multipliée par `airControl`. */
  acceleration: z.number().positive().default(900),
  airControl: z.number().min(0).max(1).default(0.65),
  /** Vitesse verticale donnée par un saut (vers le haut). */
  jumpSpeed: z.number().positive().default(235),
  gravity: z.number().positive().default(640),
  maxFallSpeed: z.number().positive().default(380),
  /** Relâcher le saut tôt multiplie la vitesse montante par ce facteur (saut court). */
  jumpCutFactor: z.number().min(0).max(1).default(0.45),
  /** Délai de grâce (s) pour sauter juste après avoir quitté un rebord. */
  coyoteTime: z.number().min(0).max(0.5).default(0.1),
  /** Un appui sur saut un peu avant d'atterrir est mémorisé pendant ce délai (s). */
  jumpBuffer: z.number().min(0).max(0.5).default(0.12),
  /** Invulnérabilité (s) après un coup. */
  invincibleTime: z.number().min(0).default(1.2),
});
export type PlayerPhysics = z.infer<typeof PlayerPhysicsSchema>;

export const PlatformerSfxSchema = z.object({
  jump: AssetRefSchema.optional(),
  coin: AssetRefSchema.optional(),
  stomp: AssetRefSchema.optional(),
  hurt: AssetRefSchema.optional(),
  spring: AssetRefSchema.optional(),
  checkpoint: AssetRefSchema.optional(),
  goal: AssetRefSchema.optional(),
  gameOver: AssetRefSchema.optional(),
});
export type PlatformerSfx = z.infer<typeof PlatformerSfxSchema>;

export const PlatformerSystemSchema = z.object({
  title: z.string().default('Mon plateformer'),
  /** Niveaux dans l'ordre de jeu (identifiants des fichiers `levels/<id>.json`). */
  levels: z.array(z.string().min(1)).min(1),
  /** Niveau de départ (par défaut, le premier de `levels`). */
  startLevel: z.string().min(1).optional(),
  lives: z.number().int().min(1).max(99).default(3),
  /** Pièces nécessaires pour gagner une vie (0 = jamais). */
  coinsPerLife: z.number().int().min(0).default(50),
  /** Facteur d'agrandissement (pixel-art). */
  zoom: z.number().positive().default(3),
  /**
   * Charset du joueur (disposition des charsets Forge : 3 colonnes × 4 lignes de 16×24 ;
   * ligne 2 = marche vers la droite, la gauche est obtenue en miroir).
   */
  playerCharset: AssetRefSchema,
  physics: PlayerPhysicsSchema.prefault({}),
  titleMusic: AssetRefSchema.optional(),
  /** Musique par défaut des niveaux qui n'en définissent pas. */
  levelMusic: AssetRefSchema.optional(),
  sfx: PlatformerSfxSchema.default({}),
});
export type PlatformerSystem = z.infer<typeof PlatformerSystemSchema>;
export type PlatformerSystemInput = z.input<typeof PlatformerSystemSchema>;

// ---------------------------------------------------------------------------
// Entités
// ---------------------------------------------------------------------------

export const FACINGS = ['left', 'right'] as const;
export const FacingSchema = z.enum(FACINGS);
export type Facing = z.infer<typeof FacingSchema>;

/** Champs communs : `id` unique dans le niveau (sert aux sauvegardes), case `x`, `y`. */
const entityBase = {
  id: z.string().min(1),
  x: TileCoordSchema,
  y: TileCoordSchema,
};

/** Pièce à ramasser (une seule fois par partie). */
export const CoinEntitySchema = z.object({ ...entityBase, type: z.literal('coin') });

export const ENEMY_KINDS = ['walker', 'hopper'] as const;
export const EnemyKindSchema = z.enum(ENEMY_KINDS);
export type EnemyKind = z.infer<typeof EnemyKindSchema>;

/**
 * Ennemi. `walker` patrouille et fait demi-tour contre un mur ou au bord du vide ; `hopper` fait
 * de petits sauts réguliers en patrouillant. Sauter dessus l'élimine, le toucher blesse le joueur.
 */
export const EnemyEntitySchema = z.object({
  ...entityBase,
  type: z.literal('enemy'),
  kind: EnemyKindSchema.default('walker'),
  /** Charset facultatif (sinon forme dessinée par défaut). */
  sprite: AssetRefSchema.optional(),
  speed: z.number().positive().default(30),
  facing: FacingSchema.default('left'),
  /** Distance maximale de patrouille (cases) de part et d'autre du départ ; absent = illimitée. */
  range: z.number().int().positive().optional(),
});

/** Ressort : propulse le joueur vers le haut à `power` px/s. */
export const SpringEntitySchema = z.object({
  ...entityBase,
  type: z.literal('spring'),
  power: z.number().positive().default(380),
});

/** Point de contrôle : le joueur y réapparaît après une perte de vie. */
export const CheckpointEntitySchema = z.object({ ...entityBase, type: z.literal('checkpoint') });

/** Arrivée : termine le niveau. */
export const GoalEntitySchema = z.object({ ...entityBase, type: z.literal('goal') });

/** Panneau : affiche `text` quand le joueur est devant. */
export const SignEntitySchema = z.object({
  ...entityBase,
  type: z.literal('sign'),
  text: z.string().min(1),
});

export const PlatformerEntitySchema = z.discriminatedUnion('type', [
  CoinEntitySchema,
  EnemyEntitySchema,
  SpringEntitySchema,
  CheckpointEntitySchema,
  GoalEntitySchema,
  SignEntitySchema,
]);
export type PlatformerEntity = z.infer<typeof PlatformerEntitySchema>;
export type PlatformerEntityInput = z.input<typeof PlatformerEntitySchema>;
export type PlatformerEntityType = PlatformerEntity['type'];
export type EnemyEntity = z.infer<typeof EnemyEntitySchema>;
export type SpringEntity = z.infer<typeof SpringEntitySchema>;
export type SignEntity = z.infer<typeof SignEntitySchema>;

export const ENTITY_TYPES: readonly PlatformerEntityType[] = [
  'coin', 'enemy', 'spring', 'checkpoint', 'goal', 'sign',
];

// ---------------------------------------------------------------------------
// Niveaux
// ---------------------------------------------------------------------------

/**
 * Couches de tuiles (tableaux `width × height`, ligne par ligne, `-1` = vide) :
 * `terrain` porte les collisions (rôles `PLATFORM_TILE_ROLES`), `decor` est purement visuel et
 * dessiné derrière le joueur.
 */
export const LevelLayersSchema = z.object({
  terrain: z.array(z.number().int()),
  decor: z.array(z.number().int()).default([]),
});
export type LevelLayers = z.infer<typeof LevelLayersSchema>;
export type LevelLayerName = keyof LevelLayers;
export const LEVEL_LAYER_NAMES: readonly LevelLayerName[] = ['terrain', 'decor'];

export const PlatformerLevelSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  width: z.number().int().positive().max(1024),
  height: z.number().int().positive().max(256),
  /** Tileset « vue de côté » (générateur `tileset.side`). */
  tileset: AssetRefSchema,
  music: AssetRefSchema.optional(),
  /** Image de fond (défilement parallaxe) ; sinon `backgroundColor`. */
  background: AssetRefSchema.optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#79c5f2'),
  layers: LevelLayersSchema,
  /** Case de départ du joueur (pieds posés sur le bas de la case). */
  playerStart: z.object({ x: TileCoordSchema, y: TileCoordSchema }),
  entities: z.array(PlatformerEntitySchema).default([]),
  /** Niveau suivant ; absent = suivant dans `levels` du système (ou fin du jeu). */
  next: z.string().min(1).optional(),
  /** Temps limite (s) ; absent = pas de limite. */
  timeLimit: z.number().positive().optional(),
});
export type PlatformerLevel = z.infer<typeof PlatformerLevelSchema>;
export type PlatformerLevelInput = z.input<typeof PlatformerLevelSchema>;

// ---------------------------------------------------------------------------
// État de partie (sauvegardes)
// ---------------------------------------------------------------------------

export const PlatformerStateSchema = z.object({
  level: z.string().min(1),
  lives: z.number().int().min(0),
  coins: z.number().int().min(0),
  score: z.number().int().min(0),
  /** Pièces déjà ramassées et ennemis éliminés, par niveau (identifiants d'entités). */
  collected: z.record(z.string(), z.array(z.string())).default({}),
  /** Dernier point de contrôle activé dans le niveau courant. */
  checkpoint: z.string().optional(),
  /** Niveaux terminés. */
  completed: z.array(z.string()).default([]),
});
export type PlatformerState = z.infer<typeof PlatformerStateSchema>;

/** Chemins des fichiers du mode dans un projet. */
export const PLATFORMER_SYSTEM_PATH = 'data/platformer.json';
export const levelPath = (id: string): string => `levels/${id}.json`;

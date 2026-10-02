import { z } from 'zod';

/**
 * Formats de données du mode point & click (fichiers JSON du projet) :
 * - `data/pointclick.json` : réglages généraux (entrée du manifeste) ;
 * - `data/items.json` : objets d'inventaire et combinaisons ;
 * - `scenes/<id>.json` : scènes illustrées (image de fond, zone de marche, zones cliquables).
 *
 * Unités : les coordonnées des scènes sont en **pixels de l'image de fond** (origine en haut à
 * gauche) ; la scène est mise à l'échelle pour remplir la résolution du projet.
 *
 * Interactions : clic gauche (ou toucher) = « interagir » (marcher jusqu'à la zone puis exécuter
 * ses actions), clic droit (ou appui long) = « regarder ». Un objet d'inventaire sélectionné puis
 * utilisé sur une zone déclenche l'interaction de cette zone dont `item` correspond.
 * Les conditions et les affectations utilisent le langage d'expressions sûr de `@forge/core`
 * (variables du jeu, `has("objet")` pour tester l'inventaire, `visited("scène")`).
 */

const AssetRefSchema = z.string().min(1);
const IdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'identifiant : lettres, chiffres, « _ » et « - » uniquement');
/** Expression du langage sûr de `@forge/core` (condition ou valeur). */
const ExprSchema = z.string().min(1);

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

/** Polygone (au moins 3 sommets, ordre quelconque). */
export const PolygonSchema = z.array(PointSchema).min(3);
export type Polygon = z.infer<typeof PolygonSchema>;

/** Forme d'une zone cliquable : rectangle ou polygone. */
export const ShapeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rect'),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  z.object({ type: z.literal('polygon'), points: PolygonSchema }),
]);
export type Shape = z.infer<typeof ShapeSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Choix d'un dialogue : visible si `condition` est vraie ; `once` le retire après usage. */
export interface DialogueChoice {
  text: string;
  condition?: string;
  once?: boolean;
  actions: PointClickAction[];
}

/**
 * Action exécutée en séquence. Les textes acceptent l'interpolation `{variable}` de `@forge/core`.
 * - `say` : bulle de texte (le joueur clique pour continuer) ; `speaker` = nom affiché ;
 * - `give` / `remove` : ajoute / retire un objet de l'inventaire ;
 * - `set` : affectation (`var` = nom de variable, `value` = expression) ;
 * - `goto` : change de scène (position d'arrivée facultative, sinon `playerStart` de la scène) ;
 * - `hide` / `show` : masque / affiche une zone (de la scène courante, ou de `scene`) ;
 * - `sound` : joue un effet sonore ; `music` : change la musique (absent = arrêt) ;
 * - `if` : branche selon une condition ;
 * - `dialogue` : propose des choix au joueur ;
 * - `wait` : pause (secondes) ;
 * - `end` : fin du jeu avec un texte facultatif.
 */
export type PointClickAction =
  | { type: 'say'; text: string; speaker?: string }
  | { type: 'give'; item: string }
  | { type: 'remove'; item: string }
  | { type: 'set'; var: string; value: string }
  | { type: 'goto'; scene: string; x?: number; y?: number }
  | { type: 'hide'; hotspot: string; scene?: string }
  | { type: 'show'; hotspot: string; scene?: string }
  | { type: 'sound'; asset: string }
  | { type: 'music'; asset?: string }
  | { type: 'if'; condition: string; then: PointClickAction[]; else?: PointClickAction[] }
  | { type: 'dialogue'; speaker?: string; prompt?: string; choices: DialogueChoice[] }
  | { type: 'wait'; seconds: number }
  | { type: 'end'; text?: string };

export const DialogueChoiceSchema: z.ZodType<DialogueChoice> = z.lazy(() =>
  z.object({
    text: z.string().min(1),
    condition: ExprSchema.optional(),
    once: z.boolean().optional(),
    actions: z.array(PointClickActionSchema),
  }),
);

export const PointClickActionSchema: z.ZodType<PointClickAction> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('say'), text: z.string().min(1), speaker: z.string().optional() }),
    z.object({ type: z.literal('give'), item: IdSchema }),
    z.object({ type: z.literal('remove'), item: IdSchema }),
    z.object({ type: z.literal('set'), var: z.string().min(1), value: ExprSchema }),
    z.object({ type: z.literal('goto'), scene: IdSchema, x: z.number().optional(), y: z.number().optional() }),
    z.object({ type: z.literal('hide'), hotspot: IdSchema, scene: IdSchema.optional() }),
    z.object({ type: z.literal('show'), hotspot: IdSchema, scene: IdSchema.optional() }),
    z.object({ type: z.literal('sound'), asset: AssetRefSchema }),
    z.object({ type: z.literal('music'), asset: AssetRefSchema.optional() }),
    z.object({
      type: z.literal('if'),
      condition: ExprSchema,
      then: z.array(PointClickActionSchema),
      else: z.array(PointClickActionSchema).optional(),
    }),
    z.object({
      type: z.literal('dialogue'),
      speaker: z.string().optional(),
      prompt: z.string().optional(),
      choices: z.array(DialogueChoiceSchema).min(1),
    }),
    z.object({ type: z.literal('wait'), seconds: z.number().min(0).max(30) }),
    z.object({ type: z.literal('end'), text: z.string().optional() }),
  ]),
);

export type PointClickActionType = PointClickAction['type'];
export const ACTION_TYPES: readonly PointClickActionType[] = [
  'say',
  'give',
  'remove',
  'set',
  'goto',
  'hide',
  'show',
  'sound',
  'music',
  'if',
  'dialogue',
  'wait',
  'end',
];

// ---------------------------------------------------------------------------
// Zones cliquables
// ---------------------------------------------------------------------------

export const VERBS = ['interact', 'look'] as const;
export const VerbSchema = z.enum(VERBS);
export type Verb = z.infer<typeof VerbSchema>;

/**
 * Réaction d'une zone. La première interaction dont `verb`, `item` et `condition` correspondent est
 * exécutée. `item` absent = interaction à mains nues ; présent = objet utilisé sur la zone.
 */
export const InteractionSchema = z.object({
  verb: VerbSchema.default('interact'),
  item: IdSchema.optional(),
  condition: ExprSchema.optional(),
  actions: z.array(PointClickActionSchema).min(1),
});
export type Interaction = z.infer<typeof InteractionSchema>;
export type InteractionInput = z.input<typeof InteractionSchema>;

export const HOTSPOT_KINDS = ['object', 'exit', 'character'] as const;
export const HotspotKindSchema = z.enum(HOTSPOT_KINDS);
export type HotspotKind = z.infer<typeof HotspotKindSchema>;

export const HotspotSchema = z.object({
  id: IdSchema,
  /** Nom affiché au survol. */
  name: z.string().min(1),
  /** `exit` change le curseur (flèche) ; `character` le curseur de dialogue. */
  kind: HotspotKindSchema.default('object'),
  shape: ShapeSchema,
  /** Image dessinée sur la scène (objet ramassable, personnage…) en haut à gauche de `spriteAt`. */
  sprite: AssetRefSchema.optional(),
  /** Position et taille du sprite (défaut : boîte englobante de la forme). */
  spriteAt: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
  /** Point où le joueur se rend avant d'agir (défaut : point de la zone de marche le plus proche). */
  walkTo: PointSchema.optional(),
  /** Masquée au début (révélée par l'action `show`). */
  hidden: z.boolean().default(false),
  /** Texte par défaut de « regarder » si aucune interaction `look` ne correspond. */
  description: z.string().optional(),
  interactions: z.array(InteractionSchema).default([]),
});
export type Hotspot = z.infer<typeof HotspotSchema>;
export type HotspotInput = z.input<typeof HotspotSchema>;

// ---------------------------------------------------------------------------
// Scènes
// ---------------------------------------------------------------------------

/** Mise à l'échelle du personnage selon la profondeur (y) : interpolation linéaire. */
export const DepthScaleSchema = z.object({
  topY: z.number(),
  topScale: z.number().positive(),
  bottomY: z.number(),
  bottomScale: z.number().positive(),
});
export type DepthScale = z.infer<typeof DepthScaleSchema>;

export const SceneSchema = z.object({
  id: IdSchema,
  name: z.string().default(''),
  /** Image de fond (taille de référence des coordonnées : `width × height`). */
  background: AssetRefSchema,
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
  music: AssetRefSchema.optional(),
  /** Zone où le personnage peut marcher (union des polygones) ; absente = pas de personnage affiché. */
  walkArea: z.array(PolygonSchema).default([]),
  playerStart: PointSchema.optional(),
  depthScale: DepthScaleSchema.optional(),
  hotspots: z.array(HotspotSchema).default([]),
  /** Actions exécutées à chaque entrée dans la scène (après le changement de scène). */
  onEnter: z.array(PointClickActionSchema).default([]),
  /** Actions exécutées à la première entrée seulement (avant `onEnter`). */
  onFirstEnter: z.array(PointClickActionSchema).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;

// ---------------------------------------------------------------------------
// Objets d'inventaire
// ---------------------------------------------------------------------------

/** Combinaison de deux objets de l'inventaire (dans un sens ou dans l'autre). */
export const CombinationSchema = z.object({
  a: IdSchema,
  b: IdSchema,
  condition: ExprSchema.optional(),
  /** Par défaut : retire `a` et `b`, donne `result` (si présent) puis exécute `actions`. */
  consume: z.boolean().default(true),
  result: IdSchema.optional(),
  actions: z.array(PointClickActionSchema).default([]),
});
export type Combination = z.infer<typeof CombinationSchema>;

export const ItemSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Icône (image carrée, ex. générateur `image.svg` sujet `icon` ou `object`). */
  icon: AssetRefSchema,
  description: z.string().default(''),
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemsFileSchema = z.object({
  items: z.array(ItemSchema).default([]),
  combinations: z.array(CombinationSchema).default([]),
});
export type ItemsFile = z.infer<typeof ItemsFileSchema>;
export type ItemsFileInput = z.input<typeof ItemsFileSchema>;

// ---------------------------------------------------------------------------
// Réglages généraux
// ---------------------------------------------------------------------------

export const PointClickSfxSchema = z.object({
  pickup: AssetRefSchema.optional(),
  combine: AssetRefSchema.optional(),
  fail: AssetRefSchema.optional(),
  door: AssetRefSchema.optional(),
});
export type PointClickSfx = z.infer<typeof PointClickSfxSchema>;

export const PointClickSystemSchema = z.object({
  title: z.string().default('Mon point & click'),
  /** Scène de départ. */
  startScene: IdSchema,
  /** Scènes du jeu (identifiants des fichiers `scenes/<id>.json`). */
  scenes: z.array(IdSchema).min(1),
  /** Personnage jouable (charset Forge : 3 colonnes × 4 lignes de 16×24) ; absent = pas d'avatar. */
  playerCharset: AssetRefSchema.optional(),
  /** Taille d'affichage du personnage (multiplie le charset, avant `depthScale`). */
  playerScale: z.number().positive().default(4),
  /** Vitesse de marche (pixels de scène par seconde). */
  walkSpeed: z.number().positive().default(220),
  /** Nom affiché dans les bulles du personnage. */
  playerName: z.string().default(''),
  /** Variables initiales. */
  variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  /** Objets présents dans l'inventaire au départ. */
  startItems: z.array(IdSchema).default([]),
  titleMusic: AssetRefSchema.optional(),
  /** Image de l'écran titre (sinon le fond de la scène de départ). */
  titleBackground: AssetRefSchema.optional(),
  sfx: PointClickSfxSchema.default({}),
  /** Réplique par défaut quand rien ne se passe. */
  defaultFail: z.string().default('Ça ne donne rien.'),
});
export type PointClickSystem = z.infer<typeof PointClickSystemSchema>;
export type PointClickSystemInput = z.input<typeof PointClickSystemSchema>;

// ---------------------------------------------------------------------------
// État de partie (sauvegardes)
// ---------------------------------------------------------------------------

export const PointClickStateSchema = z.object({
  scene: IdSchema,
  player: PointSchema.optional(),
  inventory: z.array(IdSchema).default([]),
  variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).default({}),
  /** Visibilité modifiée des zones, par scène : `{ scene: { hotspot: visible } }`. */
  hotspots: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
  /** Scènes déjà visitées (pour `onFirstEnter` et `visited()`). */
  visited: z.array(IdSchema).default([]),
  /** Choix de dialogue `once` déjà utilisés (clé : chemin stable du choix). */
  usedChoices: z.array(z.string()).default([]),
});
export type PointClickState = z.infer<typeof PointClickStateSchema>;

/** Chemins des fichiers du mode dans un projet. */
export const POINTCLICK_SYSTEM_PATH = 'data/pointclick.json';
export const POINTCLICK_ITEMS_PATH = 'data/items.json';
export const scenePath = (id: string): string => `scenes/${id}.json`;

import { z } from 'zod';

/**
 * Formats de données du mode RPG (fichiers JSON du projet) :
 * - `data/system.json` : réglages généraux (entrée du manifeste) ;
 * - `data/database.json` : acteurs, objets, compétences, ennemis, groupes ;
 * - `maps/<id>.json` : cartes en tuiles avec leurs événements.
 *
 * Les commandes d'événements sont typées à la main (types récursifs) ; tout le reste est déduit
 * des schémas zod. Les types `…Input` acceptent les champs facultatifs (valeurs par défaut).
 */

// ---------------------------------------------------------------------------
// Énumérations communes
// ---------------------------------------------------------------------------

export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export const DirectionSchema = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof DirectionSchema>;

export const COMPARE_OPS = ['>=', '<=', '==', '>', '<', '!='] as const;
export const CompareOpSchema = z.enum(COMPARE_OPS);
export type CompareOp = z.infer<typeof CompareOpSchema>;

export const SELF_SWITCHES = ['A', 'B', 'C', 'D'] as const;
export const SelfSwitchSchema = z.enum(SELF_SWITCHES);
export type SelfSwitchLetter = z.infer<typeof SelfSwitchSchema>;

export const MOVE_STEPS = [
  'up', 'down', 'left', 'right', 'turnUp', 'turnDown', 'turnLeft', 'turnRight', 'wait',
] as const;
export const MoveStepSchema = z.enum(MOVE_STEPS);
export type MoveStep = z.infer<typeof MoveStepSchema>;

/** `random` tire un entier entre `value` et `max` (inclus). `div` est une division entière. */
export const VARIABLE_OPS = ['set', 'add', 'sub', 'mul', 'div', 'mod', 'random'] as const;
export const VariableOpSchema = z.enum(VARIABLE_OPS);
export type VariableOp = z.infer<typeof VariableOpSchema>;

/** Drapeaux de jeu modifiables par la commande `setFlag`. */
export const PLAY_FLAGS = ['encounters', 'menu', 'save', 'dash'] as const;
export const PlayFlagSchema = z.enum(PLAY_FLAGS);
export type PlayFlag = z.infer<typeof PlayFlagSchema>;

export const TRIGGERS = ['action', 'touch', 'autorun', 'parallel'] as const;
export const TriggerSchema = z.enum(TRIGGERS);
export type EventTrigger = z.infer<typeof TriggerSchema>;

export const PRIORITIES = ['below', 'same', 'above'] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type EventPriority = z.infer<typeof PrioritySchema>;

export const MOVEMENTS = ['fixed', 'random', 'approach'] as const;
export const MovementSchema = z.enum(MOVEMENTS);
export type EventMovement = z.infer<typeof MovementSchema>;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const VariableConditionSchema = z.object({
  name: z.string().min(1),
  op: CompareOpSchema,
  value: z.number(),
});
export type VariableCondition = z.infer<typeof VariableConditionSchema>;

/**
 * Condition d'un bloc `if` (une seule clé significative) :
 * - `{ switch, value? }` : interrupteur ON (ou égal à `value`) ;
 * - `{ variable: { name, op, value } }` : comparaison numérique ;
 * - `{ item, count? }` : possède au moins `count` (1) exemplaires ;
 * - `{ gold }` : possède au moins `gold` pièces ;
 * - `{ selfSwitch, value? }` : interrupteur local de l'événement ON (ou égal à `value`) ;
 * - `{ script }` : expression du langage de script (vraie / fausse).
 */
export type Condition =
  | { switch: string; value?: boolean }
  | { variable: VariableCondition }
  | { item: string; count?: number }
  | { gold: number }
  | { selfSwitch: SelfSwitchLetter; value?: boolean }
  | { script: string };

export const ConditionSchema: z.ZodType<Condition, Condition> = z.union([
  z.object({ switch: z.string().min(1), value: z.boolean().optional() }),
  z.object({ variable: VariableConditionSchema }),
  z.object({ item: z.string().min(1), count: z.number().int().optional() }),
  z.object({ gold: z.number() }),
  z.object({ selfSwitch: SelfSwitchSchema, value: z.boolean().optional() }),
  z.object({ script: z.string().min(1) }),
]);

/** Conditions d'une page d'événement : toutes celles présentes doivent être vraies. */
export const PageConditionsSchema = z.object({
  switch: z.string().min(1).optional(),
  variable: VariableConditionSchema.optional(),
  item: z.string().min(1).optional(),
  selfSwitch: SelfSwitchSchema.optional(),
});
export type PageConditions = z.infer<typeof PageConditionsSchema>;

// ---------------------------------------------------------------------------
// Commandes d'événements
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  label: string;
  commands: Command[];
}

/**
 * Commandes exécutées par l'interpréteur d'événements. Les textes (`text`, `speaker`, libellés de
 * choix) acceptent l'interpolation `[expr]` sur les variables et interrupteurs.
 */
export type Command =
  /** Affiche un message (attend la validation du joueur). */
  | { type: 'text'; speaker?: string; text: string }
  /** Propose un choix ; `cancel` = index de l'option exécutée si le joueur annule (sinon non annulable). */
  | { type: 'choice'; options: ChoiceOption[]; cancel?: number }
  /** Branche conditionnelle. */
  | { type: 'if'; condition: Condition; then: Command[]; else?: Command[] }
  /** Interrupteur global (ON par défaut). */
  | { type: 'setSwitch'; name: string; value?: boolean }
  /** Interrupteur local A–D de cet événement (ou de l'événement `event` de la même carte). */
  | { type: 'setSelfSwitch'; letter: SelfSwitchLetter; value?: boolean; event?: string }
  /** Opération sur une variable numérique (`set` par défaut). */
  | { type: 'setVariable'; name: string; op?: VariableOp; value: number; max?: number }
  /** Donne (ou retire si `count` < 0) des objets. */
  | { type: 'giveItem'; item: string; count?: number }
  /** Donne (ou retire si négatif) de l'or. */
  | { type: 'giveGold'; amount: number }
  /** Transfère le joueur sur une carte. */
  | { type: 'teleport'; map: string; x: number; y: number; direction?: Direction }
  /** Lance un combat contre un groupe d'ennemis, avec des branches selon l'issue. */
  | {
      type: 'battle';
      troop: string;
      canEscape?: boolean;
      canLose?: boolean;
      onWin?: Command[];
      onLose?: Command[];
      onEscape?: Command[];
    }
  /** Pause en secondes. */
  | { type: 'wait'; seconds: number }
  | { type: 'playSfx'; ref: string }
  | { type: 'playMusic'; ref: string }
  | { type: 'stopMusic' }
  /** Trajet : `target` = `player`, `this` ou l'identifiant d'un événement de la carte. */
  | { type: 'moveRoute'; target: string; steps: MoveStep[]; wait?: boolean }
  /** Soigne entièrement l'équipe (PV, PM, résurrection). */
  | { type: 'healParty' }
  /** Efface cet événement jusqu'au prochain chargement de la carte. */
  | { type: 'erase' }
  /** Active / désactive un drapeau de jeu (rencontres, menu, sauvegarde, course). */
  | { type: 'setFlag'; flag: PlayFlag; value: boolean }
  | { type: 'gameOver' }
  | { type: 'returnToTitle' }
  /** Instruction du langage de script (`quete += 1`, `gold -= 5`…). */
  | { type: 'script'; code: string }
  /** Commentaire sans effet. */
  | { type: 'comment'; text: string };

export type CommandType = Command['type'];

const CommandListSchema = z.array(z.lazy(() => CommandSchema));

export const CommandSchema: z.ZodType<Command, Command> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), speaker: z.string().optional(), text: z.string() }),
  z.object({
    type: z.literal('choice'),
    options: z.array(z.object({ label: z.string(), commands: CommandListSchema })).min(1),
    cancel: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('if'),
    condition: ConditionSchema,
    then: CommandListSchema,
    else: CommandListSchema.optional(),
  }),
  z.object({ type: z.literal('setSwitch'), name: z.string().min(1), value: z.boolean().optional() }),
  z.object({
    type: z.literal('setSelfSwitch'),
    letter: SelfSwitchSchema,
    value: z.boolean().optional(),
    event: z.string().optional(),
  }),
  z.object({
    type: z.literal('setVariable'),
    name: z.string().min(1),
    op: VariableOpSchema.optional(),
    value: z.number(),
    max: z.number().optional(),
  }),
  z.object({ type: z.literal('giveItem'), item: z.string().min(1), count: z.number().int().optional() }),
  z.object({ type: z.literal('giveGold'), amount: z.number().int() }),
  z.object({
    type: z.literal('teleport'),
    map: z.string().min(1),
    x: z.number().int(),
    y: z.number().int(),
    direction: DirectionSchema.optional(),
  }),
  z.object({
    type: z.literal('battle'),
    troop: z.string().min(1),
    canEscape: z.boolean().optional(),
    canLose: z.boolean().optional(),
    onWin: CommandListSchema.optional(),
    onLose: CommandListSchema.optional(),
    onEscape: CommandListSchema.optional(),
  }),
  z.object({ type: z.literal('wait'), seconds: z.number().min(0) }),
  z.object({ type: z.literal('playSfx'), ref: z.string().min(1) }),
  z.object({ type: z.literal('playMusic'), ref: z.string().min(1) }),
  z.object({ type: z.literal('stopMusic') }),
  z.object({
    type: z.literal('moveRoute'),
    target: z.string().min(1),
    steps: z.array(MoveStepSchema),
    wait: z.boolean().optional(),
  }),
  z.object({ type: z.literal('healParty') }),
  z.object({ type: z.literal('erase') }),
  z.object({ type: z.literal('setFlag'), flag: PlayFlagSchema, value: z.boolean() }),
  z.object({ type: z.literal('gameOver') }),
  z.object({ type: z.literal('returnToTitle') }),
  z.object({ type: z.literal('script'), code: z.string() }),
  z.object({ type: z.literal('comment'), text: z.string() }),
]);

/** Documentation courte de chaque commande (éditeur, outils IA). */
export const COMMAND_DESCRIPTIONS: Record<CommandType, string> = {
  text: 'Affiche un message { speaker?, text } ; `[expr]` insère une variable ou un calcul.',
  choice: 'Propose des options { options: [{ label, commands }], cancel? (index exécuté si annulation) }.',
  if: 'Condition { condition, then, else? } : switch, variable, item, gold, selfSwitch ou script.',
  setSwitch: 'Interrupteur global { name, value? (ON par défaut) }.',
  setSelfSwitch: 'Interrupteur local A–D { letter, value?, event? (cet événement par défaut) }.',
  setVariable: 'Variable { name, op?: set|add|sub|mul|div|mod|random, value, max? (pour random) }.',
  giveItem: 'Donne des objets { item, count? (négatif = retire) }.',
  giveGold: 'Donne de l\'or { amount (négatif = retire) }.',
  teleport: 'Transfère le joueur { map, x, y, direction? }.',
  battle: 'Combat { troop, canEscape?, canLose?, onWin?, onLose?, onEscape? } ; défaite sans canLose = game over.',
  wait: 'Pause { seconds }.',
  playSfx: 'Joue un effet sonore { ref }.',
  playMusic: 'Change la musique { ref }.',
  stopMusic: 'Arrête la musique.',
  moveRoute: 'Trajet { target: player|this|id, steps: [up, down, left, right, turnUp…, wait], wait? (défaut vrai) }.',
  healParty: 'Soigne entièrement l\'équipe (PV, PM, K.O.).',
  erase: 'Efface cet événement jusqu\'au prochain chargement de la carte.',
  setFlag: 'Drapeau de jeu { flag: encounters|menu|save|dash, value }.',
  gameOver: 'Fin de partie (écran de game over).',
  returnToTitle: 'Retour à l\'écran titre.',
  script: 'Instruction de script { code } (ex. `quete += 1`, `gold -= 10`).',
  comment: 'Commentaire sans effet { text }.',
};

export const COMMAND_TYPES = Object.keys(COMMAND_DESCRIPTIONS) as CommandType[];

// ---------------------------------------------------------------------------
// Événements et cartes
// ---------------------------------------------------------------------------

/** Apparence d'une page : personnage (charset), tuile du tileset, ou rien (invisible). */
export const EventGraphicSchema = z.union([
  z.object({ charset: z.string().min(1), direction: DirectionSchema.optional() }),
  z.object({ tile: z.number().int().min(0) }),
  z.null(),
]);
export type EventGraphic = z.infer<typeof EventGraphicSchema>;

export const EventPageSchema = z.object({
  conditions: PageConditionsSchema.optional(),
  graphic: EventGraphicSchema.optional(),
  trigger: TriggerSchema.default('action'),
  /** `same` (défaut) : bloque le passage ; `below` / `above` : traversable, dessiné sous / sur les personnages. */
  priority: PrioritySchema.default('same'),
  movement: MovementSchema.default('fixed'),
  /** Vitesse de déplacement en cases par seconde. */
  speed: z.number().positive().optional(),
  commands: CommandListSchema.default([]),
});
export type EventPage = z.infer<typeof EventPageSchema>;
export type EventPageInput = z.input<typeof EventPageSchema>;

export const RpgEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  x: z.number().int(),
  y: z.number().int(),
  /** La page active est la DERNIÈRE dont toutes les conditions sont vraies. */
  pages: z.array(EventPageSchema).min(1),
});
export type RpgEvent = z.infer<typeof RpgEventSchema>;
export type RpgEventInput = z.input<typeof RpgEventSchema>;

export const EncountersSchema = z.object({
  troops: z.array(z.string().min(1)).default([]),
  /** Nombre moyen de pas entre deux rencontres. */
  rate: z.number().positive().default(20),
  /** Rôle de tuile requis (ex. `ground_detail` = hautes herbes). */
  onlyOnRole: z.string().optional(),
});
export type Encounters = z.infer<typeof EncountersSchema>;
export type EncountersInput = z.input<typeof EncountersSchema>;

/** Couches en ordre ligne par ligne (`width * height`), `-1` = vide. Une couche vide `[]` est permise. */
export const MapLayersSchema = z.object({
  ground: z.array(z.number().int()),
  decor: z.array(z.number().int()).default([]),
  overhead: z.array(z.number().int()).default([]),
});
export type MapLayers = z.infer<typeof MapLayersSchema>;
export type LayerName = keyof MapLayers;
export const LAYER_NAMES: readonly LayerName[] = ['ground', 'decor', 'overhead'];

/** Surcharge de collision par case. */
export const COLLISION_AUTO = 0;
export const COLLISION_BLOCK = 1;
export const COLLISION_PASS = 2;

export const RpgMapSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Référence d'asset du tileset (alias, id ou chemin). */
  tileset: z.string().min(1),
  music: z.string().optional(),
  layers: MapLayersSchema,
  /** 0 = selon les tuiles, 1 = bloqué, 2 = passage forcé. */
  collision: z.array(z.number().int().min(0).max(2)).optional(),
  encounters: EncountersSchema.optional(),
  events: z.array(RpgEventSchema).default([]),
});
export type RpgMap = z.infer<typeof RpgMapSchema>;
export type RpgMapInput = z.input<typeof RpgMapSchema>;

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------

export const ActorDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Asset charset (marche sur la carte). */
  charset: z.string().min(1),
  /** Image de combat facultative. */
  battler: z.string().optional(),
  level: z.number().int().min(1).max(99).default(1),
  maxHp: z.number().int().positive().default(40),
  maxMp: z.number().int().min(0).default(10),
  atk: z.number().int().min(0).default(10),
  def: z.number().int().min(0).default(8),
  mag: z.number().int().min(0).default(8),
  agi: z.number().int().min(0).default(8),
  skills: z.array(z.string()).default([]),
});
export type ActorDef = z.infer<typeof ActorDefSchema>;

export const ITEM_EFFECTS = ['heal', 'mp', 'revive', 'damage', 'none'] as const;
export const ItemEffectSchema = z.object({
  type: z.enum(ITEM_EFFECTS),
  value: z.number().default(0),
});
export type ItemEffect = z.infer<typeof ItemEffectSchema>;

export const ItemDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(''),
  price: z.number().int().min(0).default(0),
  consumable: z.boolean().default(true),
  /** Objet clé (ne peut pas être utilisé ni vendu). */
  key: z.boolean().default(false),
  effect: ItemEffectSchema.default({ type: 'none', value: 0 }),
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const SKILL_TARGETS = ['enemy', 'allEnemies', 'ally', 'allAllies', 'self'] as const;
export const SkillTargetSchema = z.enum(SKILL_TARGETS);
export type SkillTarget = z.infer<typeof SkillTargetSchema>;

export const SkillDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(''),
  mpCost: z.number().int().min(0).default(0),
  power: z.number().min(0).default(10),
  type: z.enum(['damage', 'heal']).default('damage'),
  target: SkillTargetSchema.default('enemy'),
  sfx: z.string().optional(),
});
export type SkillDef = z.infer<typeof SkillDefSchema>;

export const EnemyDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  battler: z.string().min(1),
  maxHp: z.number().int().positive().default(20),
  maxMp: z.number().int().min(0).default(0),
  atk: z.number().int().min(0).default(8),
  def: z.number().int().min(0).default(4),
  mag: z.number().int().min(0).default(4),
  agi: z.number().int().min(0).default(6),
  exp: z.number().int().min(0).default(0),
  gold: z.number().int().min(0).default(0),
  drops: z.array(z.object({ item: z.string().min(1), chance: z.number().min(0).max(1) })).default([]),
  skills: z.array(z.string()).default([]),
});
export type EnemyDef = z.infer<typeof EnemyDefSchema>;

export const TroopDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  members: z.array(z.string().min(1)).min(1),
});
export type TroopDef = z.infer<typeof TroopDefSchema>;

export const RpgDatabaseSchema = z.object({
  actors: z.array(ActorDefSchema).default([]),
  items: z.array(ItemDefSchema).default([]),
  skills: z.array(SkillDefSchema).default([]),
  enemies: z.array(EnemyDefSchema).default([]),
  troops: z.array(TroopDefSchema).default([]),
});
export type RpgDatabase = z.infer<typeof RpgDatabaseSchema>;
export type RpgDatabaseInput = z.input<typeof RpgDatabaseSchema>;

// ---------------------------------------------------------------------------
// Système
// ---------------------------------------------------------------------------

export const SYSTEM_SFX = ['cursor', 'confirm', 'cancel', 'hit', 'heal', 'coin', 'door'] as const;
export type SystemSfx = (typeof SYSTEM_SFX)[number];

export const SystemSfxSchema = z.object({
  cursor: z.string().optional(),
  confirm: z.string().optional(),
  cancel: z.string().optional(),
  hit: z.string().optional(),
  heal: z.string().optional(),
  coin: z.string().optional(),
  door: z.string().optional(),
});

export const RpgSystemSchema = z.object({
  title: z.string().default('Mon RPG'),
  startMap: z.string().min(1),
  startX: z.number().int().default(0),
  startY: z.number().int().default(0),
  startDirection: DirectionSchema.default('down'),
  /** Identifiants des acteurs de l'équipe de départ. */
  party: z.array(z.string().min(1)).default([]),
  startGold: z.number().int().min(0).default(0),
  /** Facteur d'agrandissement de la carte (pixel-art). */
  zoom: z.number().positive().default(3),
  titleMusic: z.string().optional(),
  mapMusic: z.string().optional(),
  battleMusic: z.string().optional(),
  victoryMusic: z.string().optional(),
  sfx: SystemSfxSchema.default({}),
  /** Image de fond des combats (sinon dégradé). */
  battleback: z.string().optional(),
});
export type RpgSystem = z.infer<typeof RpgSystemSchema>;
export type RpgSystemInput = z.input<typeof RpgSystemSchema>;

/** Base de données vide (valeurs par défaut). */
export function emptyDatabase(): RpgDatabase {
  return { actors: [], items: [], skills: [], enemies: [], troops: [] };
}

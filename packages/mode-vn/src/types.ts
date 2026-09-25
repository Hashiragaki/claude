import type { Value } from '@forge/core';

/** Canaux audio du langage de script. */
export type AudioChannelName = 'music' | 'sound' | 'voice';

// ---------------------------------------------------------------------------
// AST (sortie de l'analyseur)
// ---------------------------------------------------------------------------

/** Position dans le source (1-based). */
export interface SourcePos {
  line: number;
  column: number;
}

/** Définition de personnage issue de `Character("Nom", color="#hex", image="alias")`. */
export interface CharacterDef {
  name: string | null;
  color: string | null;
  image: string | null;
}

export interface DefineNode extends SourcePos {
  kind: 'define';
  name: string;
  expr: string;
  character: CharacterDef | null;
}

export interface DefaultNode extends SourcePos {
  kind: 'default';
  name: string;
  expr: string;
}

export interface ImageNode extends SourcePos {
  kind: 'image';
  tag: string;
  attrs: string[];
  ref: string;
}

export interface IncludeNode extends SourcePos {
  kind: 'include';
  path: string;
}

export interface LabelNode extends SourcePos {
  kind: 'label';
  name: string;
  body: VNNode[];
}

export interface SceneNode extends SourcePos {
  kind: 'scene';
  /** Mots de l'image (`bg cafe` → `['bg', 'cafe']`), `null` pour un écran noir. */
  image: string[] | null;
  transition: string | null;
}

export interface ShowNode extends SourcePos {
  kind: 'show';
  tag: string;
  attrs: string[];
  at: string | null;
  transition: string | null;
}

export interface HideNode extends SourcePos {
  kind: 'hide';
  tag: string;
  transition: string | null;
}

export interface WithNode extends SourcePos {
  kind: 'with';
  transition: string;
}

export interface SayNode extends SourcePos {
  kind: 'say';
  /** Variable du personnage (`mina "…"`), `null` pour le narrateur ou un nom littéral. */
  who: string | null;
  /** Nom littéral (`"Nom" "texte"`). */
  whoName: string | null;
  /** Attributs d'image (`mina happy "…"`). */
  attrs: string[];
  text: string;
  transition: string | null;
}

export interface MenuChoiceNode extends SourcePos {
  text: string;
  cond: string | null;
  body: VNNode[];
}

export interface MenuNode extends SourcePos {
  kind: 'menu';
  /** Nom optionnel (`menu choix_cafe:`) utilisable comme label. */
  label: string | null;
  caption: SayNode | null;
  choices: MenuChoiceNode[];
}

export interface IfBranch extends SourcePos {
  /** `null` pour `else`. */
  cond: string | null;
  body: VNNode[];
}

export interface IfNode extends SourcePos {
  kind: 'if';
  branches: IfBranch[];
}

export interface ExecNode extends SourcePos {
  kind: 'exec';
  code: string;
}

export interface JumpNode extends SourcePos {
  kind: 'jump' | 'call';
  label: string;
}

export interface ReturnNode extends SourcePos {
  kind: 'return';
}

export interface PauseNode extends SourcePos {
  kind: 'pause';
  seconds: number | null;
}

export interface PlayNode extends SourcePos {
  kind: 'play';
  channel: AudioChannelName;
  ref: string;
  fadein: number | null;
  loop: boolean | null;
}

export interface StopNode extends SourcePos {
  kind: 'stop';
  channel: AudioChannelName;
  fadeout: number | null;
}

export interface WindowNode extends SourcePos {
  kind: 'window';
  shown: boolean;
}

export interface PassNode extends SourcePos {
  kind: 'pass';
}

export interface CenteredNode extends SourcePos {
  kind: 'centered';
  text: string;
}

export type VNNode =
  | DefineNode
  | DefaultNode
  | ImageNode
  | IncludeNode
  | LabelNode
  | SceneNode
  | ShowNode
  | HideNode
  | WithNode
  | SayNode
  | MenuNode
  | IfNode
  | ExecNode
  | JumpNode
  | ReturnNode
  | PauseNode
  | PlayNode
  | StopNode
  | WindowNode
  | PassNode
  | CenteredNode;

/** Script analysé. */
export interface ScriptAst {
  file: string;
  nodes: VNNode[];
}

// ---------------------------------------------------------------------------
// Programme compilé (tableau plat d'instructions)
// ---------------------------------------------------------------------------

interface InstrBase {
  file: string;
  line: number;
}

export interface SayData {
  who: string | null;
  whoName: string | null;
  attrs: string[];
  text: string;
}

export type Instruction = InstrBase &
  (
    | ({ op: 'say'; transition: string | null } & SayData)
    | { op: 'centered'; text: string }
    | { op: 'menu'; caption: SayData | null; choices: { text: string; cond: string | null; target: number }[] }
    | { op: 'goto'; target: number }
    | { op: 'gotoIfNot'; cond: string; target: number }
    | { op: 'jump'; label: string }
    | { op: 'call'; label: string }
    | { op: 'return' }
    | { op: 'exec'; code: string }
    | { op: 'scene'; image: string[] | null; transition: string | null }
    | { op: 'show'; tag: string; attrs: string[]; at: string | null; transition: string | null }
    | { op: 'hide'; tag: string; transition: string | null }
    | { op: 'with'; transition: string }
    | { op: 'pause'; seconds: number | null }
    | { op: 'play'; channel: AudioChannelName; ref: string; fadein: number | null; loop: boolean | null }
    | { op: 'stop'; channel: AudioChannelName; fadeout: number | null }
    | { op: 'window'; shown: boolean }
  );

export type InstructionOf<K extends Instruction['op']> = Extract<Instruction, { op: K }>;

export interface ProgramDefine {
  name: string;
  expr: string;
  character: CharacterDef | null;
  file: string;
  line: number;
}

export interface Program {
  instructions: Instruction[];
  /** Label → index de la première instruction. */
  labels: Record<string, number>;
  defines: ProgramDefine[];
  defaults: { name: string; expr: string; file: string; line: number }[];
  /** Instructions `image` : « tag attrs » normalisé → alias d'asset ou chemin. */
  images: Record<string, string>;
  files: string[];
  /** Empreinte du programme (détecte un script modifié depuis une sauvegarde). */
  hash: string;
}

// ---------------------------------------------------------------------------
// État d'exécution (sérialisable)
// ---------------------------------------------------------------------------

/** Valeur stockée dans les variables pour un personnage. */
export interface CharacterValue {
  [key: string]: Value;
  __character: true;
  name: string | null;
  color: string | null;
  image: string | null;
}

export interface ShownImage {
  tag: string;
  attrs: string[];
  position: string;
  /** Référence résolue (alias d'asset ou chemin) à charger. */
  ref: string;
}

export interface SceneState {
  background: string | null;
  images: ShownImage[];
}

export interface VNState {
  pc: number;
  callStack: number[];
  vars: Record<string, Value>;
  scene: SceneState;
  /** Pistes en boucle en cours (canal → référence). */
  audio: Partial<Record<AudioChannelName, string>>;
  windowShown: boolean;
  scriptHash: string;
}

/** Position symbolique (label + décalage) pour survivre à une modification du script. */
export interface Anchor {
  label: string;
  offset: number;
}

export type Speaker = { name: string; color: string | null } | null;

export interface HistoryEntry {
  speaker: Speaker;
  text: string;
  /** Vrai pour un choix de menu sélectionné. */
  choice?: boolean;
}

/** Sauvegarde complète : état + historique + ancres. */
export interface VNSaveState extends VNState {
  anchors?: (Anchor | null)[];
  history?: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Étapes renvoyées par l'interpréteur
// ---------------------------------------------------------------------------

export type VNEffect =
  | { type: 'scene'; background: string | null; transition: string | null }
  | { type: 'show'; image: ShownImage; transition: string | null }
  | { type: 'hide'; tag: string; transition: string | null }
  | { type: 'with'; transition: string }
  | { type: 'play'; channel: AudioChannelName; ref: string; fadein: number | null; loop: boolean }
  | { type: 'stop'; channel: AudioChannelName; fadeout: number | null }
  | { type: 'window'; shown: boolean };

export interface SayStep {
  kind: 'say';
  speaker: Speaker;
  text: string;
  /** Narration centrée sans boîte de dialogue (`centered`). */
  centered: boolean;
  effects: VNEffect[];
}

export interface MenuStep {
  kind: 'menu';
  caption: { speaker: Speaker; text: string } | null;
  choices: { text: string; enabled: boolean }[];
  effects: VNEffect[];
}

export interface PauseStep {
  kind: 'pause';
  seconds: number | null;
  effects: VNEffect[];
}

export interface EndStep {
  kind: 'end';
  effects: VNEffect[];
}

export type VNStep = SayStep | MenuStep | PauseStep | EndStep;

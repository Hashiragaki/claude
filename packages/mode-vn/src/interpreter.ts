import { ObjectScope, evalExpression, execute, interpolate, isTruthy } from '@forge/core';
import type { EvalOptions, Value } from '@forge/core';
import { resolveImageRef } from './compiler';
import { DEFAULT_POSITION } from './constants';
import { VNSaveStateSchema } from './state-schema';
import { stripTextTags } from './text';
import type {
  Anchor,
  CharacterDef,
  CharacterValue,
  HistoryEntry,
  Instruction,
  InstructionOf,
  Program,
  SayData,
  SceneState,
  ShownImage,
  Speaker,
  VNEffect,
  VNSaveState,
  VNState,
  VNStep,
} from './types';

export interface VNInterpreterOptions {
  /** Source de hasard pour `random()`, `randint()`, `choice()` (tests déterministes). */
  random?: () => number;
  /** Fonctions supplémentaires exposées aux expressions. */
  functions?: Record<string, (...args: Value[]) => Value>;
  /** Garde-fou contre les boucles sans interaction (10 000 par défaut). */
  maxInstructions?: number;
  /** Profondeur maximale du retour arrière (200 par défaut). */
  maxRollback?: number;
  /** Nombre maximal d'entrées d'historique conservées (250 par défaut). */
  maxHistory?: number;
  /** Erreurs non bloquantes (interpolation, `define`…). */
  log?: (level: 'warn' | 'error', message: string) => void;
}

/** Erreur d'exécution localisée dans le script. */
export class VNRuntimeError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly line: number,
  ) {
    super(`${file}, ligne ${line} : ${message}`);
    this.name = 'VNRuntimeError';
  }
}

export function isCharacter(value: Value | undefined): value is CharacterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.__character === true;
}

export function characterValue(def: CharacterDef): CharacterValue {
  return { __character: true, name: def.name, color: def.color, image: def.image };
}

const MAX_CALL_DEPTH = 1000;
const clone = <T>(value: T): T => structuredClone(value);

interface Checkpoint {
  state: VNState;
  history: HistoryEntry[];
}

/**
 * Exécute un programme VN jusqu'à la prochaine interaction (réplique, menu, pause, fin).
 * Les instructions non interactives produisent des « effets » attachés à l'étape renvoyée.
 */
export class VNInterpreter {
  private st: VNState;
  private hist: HistoryEntry[] = [];
  private checkpoints: Checkpoint[] = [];
  /** L'étape affichée correspond au dernier point de retour arrière. */
  private atCheckpoint = false;
  /** Interaction en attente (index de l'instruction), `null` pendant l'exécution ou après une erreur. */
  private waiting: { kind: VNStep['kind']; index: number } | null = null;
  /** Entrées d'historique ajoutées par l'interaction affichée (réajoutées lors d'une restauration). */
  private shownEntries = 0;
  private effects: VNEffect[] = [];
  private last: VNStep | null = null;
  private started = false;
  private readonly labelStarts: [string, number][];
  private readonly evalOptions: EvalOptions;

  constructor(
    readonly program: Program,
    private readonly options: VNInterpreterOptions = {},
  ) {
    this.st = this.emptyState();
    this.labelStarts = Object.entries(program.labels).sort((a, b) => a[1] - b[1]);
    this.evalOptions = { random: options.random, functions: options.functions };
  }

  // -------------------------------------------------------------------------
  // Accesseurs
  // -------------------------------------------------------------------------

  /** Copie de l'état courant. */
  get state(): VNState {
    return clone(this.st);
  }

  get scene(): SceneState {
    return clone(this.st.scene);
  }

  /** Répliques affichées jusqu'ici (restaurées par le retour arrière). */
  get history(): HistoryEntry[] {
    return this.hist.slice();
  }

  get canRollback(): boolean {
    return this.started && this.checkpoints.length >= (this.atCheckpoint ? 2 : 1);
  }

  get isStarted(): boolean {
    return this.started;
  }

  get ended(): boolean {
    return this.waiting?.kind === 'end';
  }

  /** Dernière étape renvoyée. */
  get currentStep(): VNStep | null {
    return this.last;
  }

  private get index(): number {
    return this.waiting?.index ?? this.st.pc;
  }

  get currentLine(): number {
    return this.program.instructions[this.index]?.line ?? 0;
  }

  get currentFile(): string {
    return this.program.instructions[this.index]?.file ?? this.program.files[0] ?? '';
  }

  get currentLabel(): string | null {
    return this.labelAt(this.index);
  }

  hasLabel(name: string): boolean {
    return Object.hasOwn(this.program.labels, name);
  }

  /** Label contenant l'instruction `index` (le plus proche qui la précède). */
  labelAt(index: number): string | null {
    let found: string | null = null;
    for (const [name, start] of this.labelStarts) {
      if (start > index) break;
      found = name;
    }
    return found;
  }

  getVariables(): Record<string, Value> {
    return clone(this.st.vars);
  }

  setVariable(name: string, value: Value): void {
    this.scope().set(name, clone(value));
  }

  // -------------------------------------------------------------------------
  // Déroulement
  // -------------------------------------------------------------------------

  start(label = 'start'): VNStep {
    if (!this.hasLabel(label)) throw new Error(`Label « ${label} » introuvable`);
    this.st = this.emptyState();
    this.hist = [];
    this.checkpoints = [];
    this.effects = [];
    this.last = null;
    this.initVariables();
    this.st.pc = this.program.labels[label] as number;
    this.started = true;
    return this.resume();
  }

  /** Passe à l'interaction suivante (sans effet sur un menu ou à la fin). */
  advance(): VNStep {
    if (!this.started) throw new Error('Partie non démarrée : appelez start()');
    const w = this.waiting;
    if (w && (w.kind === 'menu' || w.kind === 'end') && this.last) return this.last;
    if (w) this.st.pc = w.index + 1;
    return this.resume();
  }

  choose(index: number): VNStep {
    const w = this.waiting;
    const step = this.last;
    if (!w || w.kind !== 'menu' || step?.kind !== 'menu') throw new Error('Aucun menu en attente de choix');
    const ins = this.program.instructions[w.index] as InstructionOf<'menu'>;
    const choice = step.choices[index];
    const target = ins.choices[index]?.target;
    if (!choice || target === undefined) throw new RangeError(`Choix inexistant : ${index}`);
    if (!choice.enabled) throw new Error(`Choix indisponible : « ${choice.text} »`);
    this.pushHistory({ speaker: null, text: choice.text, choice: true });
    this.st.pc = target;
    return this.resume();
  }

  /** Revient à l'interaction précédente (variables, scène et historique compris). */
  rollback(): VNStep | null {
    if (!this.canRollback) return null;
    if (this.atCheckpoint) this.checkpoints.pop();
    const cp = this.checkpoints.pop() as Checkpoint;
    this.st = cp.state;
    this.hist = cp.history;
    this.effects = [];
    return this.resume();
  }

  serialize(): VNSaveState {
    const positions = [this.st.pc, ...this.st.callStack];
    const history = this.hist.slice(0, this.hist.length - (this.waiting ? this.shownEntries : 0));
    return {
      ...clone(this.st),
      anchors: positions.map((pc) => this.anchorOf(pc)),
      history: clone(history.slice(-100)),
    };
  }

  /**
   * Restaure une sauvegarde et renvoie l'interaction à réafficher. Si le script a changé depuis,
   * les positions sont recalées grâce aux ancres (label + décalage).
   */
  restore(raw: unknown): VNStep {
    const parsed = VNSaveStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Sauvegarde invalide : ${parsed.error.issues[0]?.message ?? 'format inconnu'}`);
    }
    const data = parsed.data as VNSaveState;
    const { labels, instructions } = this.program;
    const changed = data.scriptHash !== this.program.hash;
    const remap = (pc: number, i: number): number => {
      const anchor = changed ? data.anchors?.[i] : null;
      const moved =
        anchor && Object.hasOwn(labels, anchor.label) ? (labels[anchor.label] as number) + anchor.offset : pc;
      return Math.max(0, Math.min(moved, instructions.length));
    };
    this.st = {
      pc: remap(data.pc, 0),
      callStack: data.callStack.map((pc, i) => remap(pc, i + 1)),
      vars: clone(data.vars),
      scene: clone(data.scene),
      audio: clone(data.audio),
      windowShown: data.windowShown,
      scriptHash: this.program.hash,
    };
    this.hist = clone(data.history ?? []);
    this.checkpoints = [];
    this.effects = [];
    this.last = null;
    this.initVariables();
    this.started = true;
    return this.resume();
  }

  // -------------------------------------------------------------------------
  // Exécution
  // -------------------------------------------------------------------------

  private emptyState(): VNState {
    return {
      pc: 0,
      callStack: [],
      vars: {},
      scene: { background: null, images: [] },
      audio: {},
      windowShown: true,
      scriptHash: this.program.hash,
    };
  }

  private scope(): ObjectScope {
    return new ObjectScope(this.st.vars);
  }

  private log(level: 'warn' | 'error', message: string): void {
    this.options.log?.(level, message);
  }

  /** `define` (toujours réévalués) puis `default` (seulement si absents). */
  private initVariables(): void {
    const scope = this.scope();
    for (const d of this.program.defines) {
      try {
        const value = d.character ? characterValue(d.character) : evalExpression(d.expr, scope, this.evalOptions);
        scope.set(d.name, clone(value));
      } catch (error) {
        this.log('error', `${d.file}, ligne ${d.line} : ${errorMessage(error)}`);
      }
    }
    for (const d of this.program.defaults) {
      if (scope.has(d.name)) continue;
      try {
        scope.set(d.name, clone(evalExpression(d.expr, scope, this.evalOptions)));
      } catch (error) {
        this.log('error', `${d.file}, ligne ${d.line} : ${errorMessage(error)}`);
      }
    }
  }

  private resume(): VNStep {
    this.waiting = null;
    this.shownEntries = 0;
    this.atCheckpoint = false;
    return this.run();
  }

  private run(): VNStep {
    const max = this.options.maxInstructions ?? 10_000;
    const { instructions } = this.program;
    for (let count = 0; ; count++) {
      const pc = this.st.pc;
      const ins = instructions[pc];
      if (!ins) return this.present(pc, { kind: 'end', effects: this.takeEffects() }, null, false);
      if (count >= max) {
        throw new VNRuntimeError(
          `boucle infinie probable (plus de ${max} instructions exécutées sans interaction)`,
          ins.file,
          ins.line,
        );
      }
      try {
        const step = this.exec(ins, pc);
        if (step) return step;
      } catch (error) {
        if (error instanceof VNRuntimeError) throw error;
        // Permet de reprendre après l'instruction fautive (une condition en erreur vaut « faux »).
        if (this.st.pc === pc) this.st.pc = ins.op === 'gotoIfNot' ? ins.target : pc + 1;
        throw new VNRuntimeError(errorMessage(error), ins.file, ins.line);
      }
    }
  }

  private exec(ins: Instruction, pc: number): VNStep | null {
    const st = this.st;
    switch (ins.op) {
      case 'say': {
        this.sayAttributes(ins);
        if (ins.transition) this.effects.push({ type: 'with', transition: ins.transition });
        const speaker = this.speaker(ins, ins);
        const text = this.text(ins.text, ins);
        const step: VNStep = { kind: 'say', speaker, text, centered: false, effects: this.takeEffects() };
        return this.present(pc, step, { speaker, text });
      }
      case 'centered': {
        const text = this.text(ins.text, ins);
        return this.present(pc, { kind: 'say', speaker: null, text, centered: true, effects: this.takeEffects() }, {
          speaker: null,
          text,
        });
      }
      case 'menu': {
        if (ins.caption) this.sayAttributes(ins.caption);
        const caption = ins.caption
          ? { speaker: this.speaker(ins.caption, ins), text: this.text(ins.caption.text, ins) }
          : null;
        const choices = ins.choices.map((c) => ({
          text: this.text(c.text, ins),
          enabled: c.cond === null || this.condition(c.cond, ins),
        }));
        if (choices.length > 0 && choices.every((c) => !c.enabled)) {
          // Comme Ren'Py : un menu sans aucun choix disponible est ignoré (sinon le jeu serait bloqué).
          this.log('warn', `${ins.file}, ligne ${ins.line} : aucun choix disponible, menu ignoré`);
          st.pc = ins.end;
          return null;
        }
        return this.present(pc, { kind: 'menu', caption, choices, effects: this.takeEffects() }, caption);
      }
      case 'pause':
        return this.present(pc, { kind: 'pause', seconds: ins.seconds, effects: this.takeEffects() }, null, false);
      case 'goto':
        st.pc = ins.target;
        return null;
      case 'gotoIfNot':
        st.pc = isTruthy(evalExpression(ins.cond, this.scope(), this.evalOptions)) ? pc + 1 : ins.target;
        return null;
      case 'jump':
        st.pc = this.labelIndex(ins.label);
        return null;
      case 'call': {
        const target = this.labelIndex(ins.label);
        if (st.callStack.length >= MAX_CALL_DEPTH) throw new Error(`pile d'appels trop profonde (${MAX_CALL_DEPTH})`);
        st.callStack.push(pc + 1);
        st.pc = target;
        return null;
      }
      case 'return': {
        const back = st.callStack.pop();
        if (back === undefined) return this.present(pc, { kind: 'end', effects: this.takeEffects() }, null, false);
        st.pc = back;
        return null;
      }
      default:
        st.pc = pc + 1;
        this.execSimple(ins);
        return null;
    }
  }

  /** Instructions sans saut ni interaction. */
  private execSimple(ins: Instruction): void {
    const st = this.st;
    switch (ins.op) {
      case 'exec':
        execute(ins.code, this.scope(), this.evalOptions);
        break;
      case 'scene': {
        const [tag, ...attrs] = ins.image ?? [];
        const background = tag ? resolveImageRef(this.program.images, tag, attrs) : null;
        st.scene = { background, images: [] };
        this.effects.push({ type: 'scene', background, transition: ins.transition });
        break;
      }
      case 'show':
        this.showImage(ins.tag, ins.attrs, ins.at, ins.transition);
        break;
      case 'hide': {
        const before = st.scene.images.length;
        st.scene.images = st.scene.images.filter((i) => i.tag !== ins.tag);
        if (st.scene.images.length !== before) {
          this.effects.push({ type: 'hide', tag: ins.tag, transition: ins.transition });
        }
        break;
      }
      case 'with':
        this.effects.push({ type: 'with', transition: ins.transition });
        break;
      case 'play': {
        const loop = ins.loop ?? ins.channel === 'music';
        if (loop) st.audio[ins.channel] = ins.ref;
        else delete st.audio[ins.channel];
        this.effects.push({ type: 'play', channel: ins.channel, ref: ins.ref, fadein: ins.fadein, loop });
        break;
      }
      case 'stop':
        delete st.audio[ins.channel];
        this.effects.push({ type: 'stop', channel: ins.channel, fadeout: ins.fadeout });
        break;
      case 'window':
        st.windowShown = ins.shown;
        this.effects.push({ type: 'window', shown: ins.shown });
        break;
      default:
        break;
    }
  }

  private present(pc: number, step: VNStep, entry: HistoryEntry | null, checkpoint = true): VNStep {
    this.st.pc = pc;
    this.waiting = { kind: step.kind, index: pc };
    if (checkpoint) {
      this.checkpoints.push({ state: clone(this.st), history: this.hist.slice() });
      if (this.checkpoints.length > (this.options.maxRollback ?? 200)) this.checkpoints.shift();
      this.atCheckpoint = true;
    }
    if (entry) this.pushHistory(entry);
    this.shownEntries = entry ? 1 : 0;
    this.last = step;
    return step;
  }

  private pushHistory(entry: HistoryEntry): void {
    this.hist.push(entry);
    const max = this.options.maxHistory ?? 250;
    if (this.hist.length > max) this.hist.splice(0, this.hist.length - max);
  }

  private takeEffects(): VNEffect[] {
    const effects = this.effects;
    this.effects = [];
    return effects;
  }

  private showImage(tag: string, attrs: string[], at: string | null, transition: string | null): void {
    const images = this.st.scene.images;
    const index = images.findIndex((i) => i.tag === tag);
    const previous = images[index];
    // Comme Ren'Py : `show mina` conserve les attributs et la position déjà affichés.
    const finalAttrs = attrs.length > 0 ? [...attrs] : [...(previous?.attrs ?? [])];
    const image: ShownImage = {
      tag,
      attrs: finalAttrs,
      position: at ?? previous?.position ?? DEFAULT_POSITION,
      ref: resolveImageRef(this.program.images, tag, finalAttrs),
    };
    if (index >= 0) images[index] = image;
    else images.push(image);
    this.effects.push({ type: 'show', image: clone(image), transition });
  }

  /** `mina happy "…"` : change l'expression de l'image liée au personnage si elle est affichée. */
  private sayAttributes(data: SayData): void {
    if (!data.who || data.attrs.length === 0) return;
    const character = this.st.vars[data.who];
    const tag = isCharacter(character) ? (character.image ?? data.who) : data.who;
    if (this.st.scene.images.some((i) => i.tag === tag)) this.showImage(tag, data.attrs, null, null);
  }

  private speaker(data: SayData, ins: Instruction): Speaker {
    if (data.whoName !== null) return { name: this.text(data.whoName, ins), color: null };
    if (data.who === null) return null;
    const value = this.st.vars[data.who];
    if (isCharacter(value)) {
      return value.name === null ? null : { name: this.text(value.name, ins), color: value.color };
    }
    if (typeof value === 'string') return { name: value, color: null };
    return { name: data.who, color: null };
  }

  /** Interpolation `[expr]` puis retrait des balises ; une erreur affiche le texte brut. */
  private text(raw: string, ins: Instruction): string {
    try {
      return stripTextTags(interpolate(raw, this.scope(), this.evalOptions));
    } catch (error) {
      this.log('error', `${ins.file}, ligne ${ins.line} : ${errorMessage(error)}`);
      return stripTextTags(raw);
    }
  }

  /** Condition d'un choix de menu (une erreur rend le choix indisponible). */
  private condition(cond: string, ins: Instruction): boolean {
    try {
      return isTruthy(evalExpression(cond, this.scope(), this.evalOptions));
    } catch (error) {
      this.log('error', `${ins.file}, ligne ${ins.line} : ${errorMessage(error)}`);
      return false;
    }
  }

  private labelIndex(label: string): number {
    if (!this.hasLabel(label)) throw new Error(`label « ${label} » introuvable`);
    return this.program.labels[label] as number;
  }

  private anchorOf(pc: number): Anchor | null {
    const label = this.labelAt(pc);
    return label === null ? null : { label, offset: pc - (this.program.labels[label] as number) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

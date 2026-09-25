import { execute, interpolate, type Rng } from '@forge/core';
import { checkCondition, type ConditionContext } from './conditions';
import type { Command, Direction, MoveStep } from './schema';
import { RpgScope, scriptOptions } from './scope';
import { addGold, addItem, applyVariableOp, healParty, setSelfSwitch, setSwitch, type GameState } from './state';

/**
 * État d'attente de l'interpréteur : l'hôte (monde, vue) traite la demande puis appelle
 * `resume(result)`.
 * - `message` → `resume()` ;
 * - `choice` → `resume(index)` (`-1` = annulation) ;
 * - `wait` → géré par `update(dt)` ;
 * - `battle` → `resume('win' | 'lose' | 'escape')` ;
 * - `teleport` / `moveRoute` → `resume()` une fois l'action terminée ;
 * - `gameOver` / `returnToTitle` → fin de l'exécution.
 */
export type WaitState =
  | { kind: 'message'; speaker?: string; text: string }
  | { kind: 'choice'; options: string[]; cancelIndex: number | null }
  | { kind: 'wait'; seconds: number }
  | { kind: 'battle'; troop: string; canEscape: boolean; canLose: boolean }
  | { kind: 'teleport'; map: string; x: number; y: number; direction?: Direction }
  | { kind: 'moveRoute'; target: string; steps: MoveStep[]; wait: boolean }
  | { kind: 'gameOver' }
  | { kind: 'returnToTitle' };

export type WaitKind = WaitState['kind'];
export type BattleOutcome = 'win' | 'lose' | 'escape';

/** Effets sans attente émis pendant l'exécution. */
export type InterpreterEffect =
  | { type: 'sfx'; ref: string }
  | { type: 'music'; ref: string }
  | { type: 'stopMusic' }
  | { type: 'changed'; reason: string }
  | { type: 'error'; message: string };

export interface InterpreterContext {
  state: GameState;
  rng: Rng;
  onEffect?(effect: InterpreterEffect): void;
}

export interface InterpreterOptions {
  /** Carte de l'événement (clé des interrupteurs locaux) ; carte courante par défaut. */
  mapId?: string;
  /** Événement exécuté (`this`), `null` pour des commandes hors événement. */
  eventId?: string | null;
  /** Nombre maximum de commandes exécutées d'affilée sans attente (garde-fou). */
  maxSteps?: number;
}

interface Frame {
  commands: readonly Command[];
  index: number;
}

/**
 * Exécute une liste de commandes comme une machine à pile reprenable : les blocs imbriqués
 * (`choice`, `if`, branches de combat) empilent un cadre ; les commandes qui ont besoin du joueur
 * ou de la vue placent l'interpréteur en attente.
 */
export class EventInterpreter {
  readonly mapId: string;
  readonly eventId: string | null;
  private readonly maxSteps: number;
  private stack: Frame[] = [];
  private current: WaitState | null = null;
  private pendingCommand: Command | null = null;
  private timer = 0;

  constructor(
    commands: readonly Command[],
    private readonly ctx: InterpreterContext,
    options: InterpreterOptions = {},
  ) {
    this.mapId = options.mapId ?? ctx.state.map;
    this.eventId = options.eventId ?? null;
    this.maxSteps = options.maxSteps ?? 10_000;
    if (commands.length) this.stack.push({ commands, index: 0 });
  }

  /** Attente en cours (ou `null`). */
  get waiting(): WaitState | null {
    return this.current;
  }

  /** Vrai quand toutes les commandes ont été exécutées. */
  get finished(): boolean {
    return this.stack.length === 0 && this.current === null;
  }

  /** Exécute jusqu'à la prochaine attente ou la fin. */
  run(): WaitState | null {
    let steps = 0;
    while (!this.current && this.stack.length > 0) {
      if (++steps > this.maxSteps) {
        this.report(`Exécution interrompue : plus de ${this.maxSteps} commandes sans attente.`);
        this.stack = [];
        break;
      }
      const frame = this.stack[this.stack.length - 1] as Frame;
      if (frame.index >= frame.commands.length) {
        this.stack.pop();
        continue;
      }
      const command = frame.commands[frame.index++] as Command;
      try {
        this.execute(command);
      } catch (error) {
        this.report(`Commande « ${command.type} » : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.current;
  }

  /** Reprend après une attente (`result` selon le type d'attente) et continue l'exécution. */
  resume(result?: unknown): WaitState | null {
    const wait = this.current;
    const command = this.pendingCommand;
    this.current = null;
    this.pendingCommand = null;
    if (wait) {
      switch (wait.kind) {
        case 'choice':
          this.resumeChoice(wait, command, result);
          break;
        case 'battle':
          if (command?.type === 'battle') {
            const outcome: BattleOutcome = result === 'lose' || result === 'escape' ? result : 'win';
            if (outcome === 'lose' && !wait.canLose) {
              this.current = { kind: 'gameOver' };
              return this.current;
            }
            const branch = outcome === 'win' ? command.onWin : outcome === 'lose' ? command.onLose : command.onEscape;
            this.push(branch);
          }
          break;
        case 'gameOver':
        case 'returnToTitle':
          this.stack = [];
          return null;
        default:
          break;
      }
    }
    return this.run();
  }

  /** Fait avancer les attentes temporisées (`wait`). */
  update(dt: number): WaitState | null {
    if (this.current?.kind === 'wait') {
      this.timer -= dt;
      if (this.timer <= 1e-9) return this.resume();
    }
    return this.current;
  }

  /** Arrête immédiatement l'exécution. */
  stop(): void {
    this.stack = [];
    this.current = null;
    this.pendingCommand = null;
  }

  private resumeChoice(wait: Extract<WaitState, { kind: 'choice' }>, command: Command | null, result: unknown): void {
    if (command?.type !== 'choice') return;
    let index = typeof result === 'number' ? Math.trunc(result) : -1;
    if (index < 0 || index >= command.options.length) index = wait.cancelIndex ?? -1;
    const option = command.options[index];
    if (option) this.push(option.commands);
  }

  private push(commands: readonly Command[] | undefined): void {
    if (commands && commands.length > 0) this.stack.push({ commands, index: 0 });
  }

  private wait(state: WaitState, command: Command): void {
    this.current = state;
    this.pendingCommand = command;
  }

  private conditionContext(): ConditionContext {
    return { state: this.ctx.state, mapId: this.mapId, eventId: this.eventId, rng: this.ctx.rng };
  }

  private text(source: string): string {
    const ctx = this.conditionContext();
    return interpolate(source, new RpgScope(ctx.state), scriptOptions(ctx));
  }

  private emit(effect: InterpreterEffect): void {
    this.ctx.onEffect?.(effect);
  }

  private changed(reason: string): void {
    this.emit({ type: 'changed', reason });
  }

  private report(message: string): void {
    this.emit({ type: 'error', message });
  }

  private requireEvent(command: string): string {
    if (this.eventId === null) throw new Error(`« ${command} » nécessite un événement`);
    return this.eventId;
  }

  private execute(command: Command): void {
    const { state } = this.ctx;
    switch (command.type) {
      case 'text':
        this.wait(
          {
            kind: 'message',
            text: this.text(command.text),
            ...(command.speaker ? { speaker: this.text(command.speaker) } : {}),
          },
          command,
        );
        return;
      case 'choice': {
        const cancel = command.cancel;
        this.wait(
          {
            kind: 'choice',
            options: command.options.map((o) => this.text(o.label)),
            cancelIndex: cancel !== undefined && cancel < command.options.length ? cancel : null,
          },
          command,
        );
        return;
      }
      case 'if':
        this.push(checkCondition(command.condition, this.conditionContext()) ? command.then : command.else);
        return;
      case 'setSwitch':
        setSwitch(state, command.name, command.value ?? true);
        this.changed('switch');
        return;
      case 'setSelfSwitch': {
        const eventId = command.event ?? this.requireEvent('setSelfSwitch');
        setSelfSwitch(state, this.mapId, eventId, command.letter, command.value ?? true);
        this.changed('selfSwitch');
        return;
      }
      case 'setVariable':
        applyVariableOp(state, command.name, command.op ?? 'set', command.value, command.max, () =>
          this.ctx.rng.next(),
        );
        this.changed('variable');
        return;
      case 'giveItem':
        addItem(state, command.item, command.count ?? 1);
        this.changed('item');
        return;
      case 'giveGold':
        addGold(state, command.amount);
        this.changed('gold');
        return;
      case 'teleport':
        this.wait(
          {
            kind: 'teleport',
            map: command.map,
            x: command.x,
            y: command.y,
            ...(command.direction ? { direction: command.direction } : {}),
          },
          command,
        );
        return;
      case 'battle':
        this.wait(
          {
            kind: 'battle',
            troop: command.troop,
            canEscape: command.canEscape ?? true,
            canLose: command.canLose ?? false,
          },
          command,
        );
        return;
      case 'wait':
        if (command.seconds > 0) {
          this.timer = command.seconds;
          this.wait({ kind: 'wait', seconds: command.seconds }, command);
        }
        return;
      case 'playSfx':
        this.emit({ type: 'sfx', ref: command.ref });
        return;
      case 'playMusic':
        this.emit({ type: 'music', ref: command.ref });
        return;
      case 'stopMusic':
        this.emit({ type: 'stopMusic' });
        return;
      case 'moveRoute':
        this.wait(
          { kind: 'moveRoute', target: command.target, steps: [...command.steps], wait: command.wait ?? true },
          command,
        );
        return;
      case 'healParty':
        healParty(state);
        this.changed('party');
        return;
      case 'erase': {
        const eventId = this.requireEvent('erase');
        if (this.mapId === state.map && !state.erased.includes(eventId)) state.erased.push(eventId);
        return;
      }
      case 'setFlag':
        state.flags[command.flag] = command.value;
        this.changed('flag');
        return;
      case 'gameOver':
        this.wait({ kind: 'gameOver' }, command);
        return;
      case 'returnToTitle':
        this.wait({ kind: 'returnToTitle' }, command);
        return;
      case 'script': {
        const ctx = this.conditionContext();
        execute(command.code, new RpgScope(state), scriptOptions(ctx));
        this.changed('script');
        return;
      }
      case 'comment':
        return;
    }
  }
}

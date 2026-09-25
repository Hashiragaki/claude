import { Emitter } from './events';

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'cancel'
  | 'menu'
  | 'dash'
  | 'skip'
  | 'auto'
  | 'history';

/**
 * Associations par défaut, en `KeyboardEvent.code` (position physique) :
 * WASD sur QWERTY correspond automatiquement à ZQSD sur AZERTY.
 */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyE'],
  cancel: ['Escape', 'Backspace', 'KeyX'],
  menu: ['KeyM', 'Tab'],
  dash: ['ShiftLeft', 'ShiftRight'],
  skip: ['ControlLeft', 'ControlRight'],
  auto: ['KeyF'],
  history: ['KeyH', 'PageUp'],
};

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
  /** Vrai pendant la frame où le bouton a été enfoncé. */
  justPressed: boolean;
  /** Défilement vertical accumulé depuis la dernière frame. */
  wheel: number;
}

export type InputEvents = {
  action: { action: Action; pressed: boolean };
  pointer: { x: number; y: number; type: 'down' | 'up' | 'move' };
};

/**
 * Gestion des entrées clavier, souris/tactile et manette, exposées sous forme d'actions.
 * Appeler `update()` une fois par frame logique avant de lire `justPressed`.
 */
export class InputManager {
  readonly events = new Emitter<InputEvents>();
  readonly pointer: PointerState = { x: 0, y: 0, down: false, justPressed: false, wheel: 0 };

  private readonly keyToActions = new Map<string, Action[]>();
  private readonly downKeys = new Set<string>();
  private readonly virtualDown = new Set<Action>();
  private gamepadDown = new Set<Action>();
  private current = new Set<Action>();
  private previous = new Set<Action>();
  private pendingPresses = new Set<Action>();
  private justPressedSet = new Set<Action>();
  private pendingPointerPress = false;
  private pendingWheel = 0;
  private detachers: (() => void)[] = [];

  constructor(bindings: Partial<Record<Action, string[]>> = {}) {
    const all = { ...DEFAULT_BINDINGS, ...bindings };
    for (const [action, codes] of Object.entries(all) as [Action, string[]][]) {
      for (const code of codes) {
        const list = this.keyToActions.get(code) ?? [];
        list.push(action);
        this.keyToActions.set(code, list);
      }
    }
  }

  /**
   * Branche le clavier sur `keyTarget` (souvent `window`) et le pointeur sur `pointerTarget`
   * (souvent le canvas). Retourne une fonction de détachement.
   */
  attach(keyTarget: Window | HTMLElement, pointerTarget?: HTMLElement): () => void {
    const onKeyDown = (e: Event) => {
      const ev = e as KeyboardEvent;
      const actions = this.keyToActions.get(ev.code);
      if (!actions) return;
      if (isEditableTarget(ev.target)) return;
      ev.preventDefault();
      // Toujours réenregistrer la touche : si `onBlur` l'a effacée pendant qu'elle était
      // maintenue (voir plus bas), l'autorepeat (repeat=true) doit pouvoir la restaurer.
      this.downKeys.add(ev.code);
      if (ev.repeat) return;
      for (const a of actions) {
        this.pendingPresses.add(a);
        this.events.emit('action', { action: a, pressed: true });
      }
    };
    const onKeyUp = (e: Event) => {
      const ev = e as KeyboardEvent;
      this.downKeys.delete(ev.code);
      for (const a of this.keyToActions.get(ev.code) ?? []) this.events.emit('action', { action: a, pressed: false });
    };
    const onBlur = (e: Event) => {
      // `focusout` remonte depuis les enfants : un focus qui reste à l'intérieur de `keyTarget`
      // (ex. clic sur le canvas focusable du mount) ne doit pas être traité comme une perte de
      // focus du jeu, sinon les touches maintenues sont effacées à chaque clic.
      if (relatedTargetInside(keyTarget, (e as FocusEvent).relatedTarget)) return;
      this.downKeys.clear();
    };
    // `blur` ne remonte pas depuis les éléments enfants : on utilise `focusout` sur un élément.
    const blurEvent = typeof window !== 'undefined' && keyTarget === window ? 'blur' : 'focusout';
    keyTarget.addEventListener('keydown', onKeyDown);
    keyTarget.addEventListener('keyup', onKeyUp);
    keyTarget.addEventListener(blurEvent, onBlur);
    this.detachers.push(() => {
      keyTarget.removeEventListener('keydown', onKeyDown);
      keyTarget.removeEventListener('keyup', onKeyUp);
      keyTarget.removeEventListener(blurEvent, onBlur);
    });

    if (pointerTarget) {
      const toLocal = (ev: PointerEvent) => {
        const rect = pointerTarget.getBoundingClientRect();
        const el = pointerTarget as HTMLCanvasElement;
        const scaleX = el.width && rect.width ? el.width / rect.width : 1;
        const scaleY = el.height && rect.height ? el.height / rect.height : 1;
        this.pointer.x = (ev.clientX - rect.left) * scaleX;
        this.pointer.y = (ev.clientY - rect.top) * scaleY;
      };
      const onDown = (e: Event) => {
        const ev = e as PointerEvent;
        toLocal(ev);
        this.pointer.down = true;
        this.pendingPointerPress = true;
        this.events.emit('pointer', { x: this.pointer.x, y: this.pointer.y, type: 'down' });
      };
      const onUp = (e: Event) => {
        toLocal(e as PointerEvent);
        this.pointer.down = false;
        this.events.emit('pointer', { x: this.pointer.x, y: this.pointer.y, type: 'up' });
      };
      const onMove = (e: Event) => {
        toLocal(e as PointerEvent);
        this.events.emit('pointer', { x: this.pointer.x, y: this.pointer.y, type: 'move' });
      };
      const onWheel = (e: Event) => {
        this.pendingWheel += (e as WheelEvent).deltaY;
      };
      pointerTarget.addEventListener('pointerdown', onDown);
      pointerTarget.addEventListener('pointerup', onUp);
      pointerTarget.addEventListener('pointermove', onMove);
      pointerTarget.addEventListener('wheel', onWheel, { passive: true });
      this.detachers.push(() => {
        pointerTarget.removeEventListener('pointerdown', onDown);
        pointerTarget.removeEventListener('pointerup', onUp);
        pointerTarget.removeEventListener('pointermove', onMove);
        pointerTarget.removeEventListener('wheel', onWheel);
      });
    }
    return () => this.detach();
  }

  detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.downKeys.clear();
  }

  /** Appuie virtuellement sur une action (tests, boutons tactiles). */
  press(action: Action): void {
    this.virtualDown.add(action);
    this.pendingPresses.add(action);
  }

  release(action: Action): void {
    this.virtualDown.delete(action);
  }

  /** Appui bref : pressé puis relâché, détecté à la prochaine frame. */
  tap(action: Action): void {
    this.pendingPresses.add(action);
  }

  /** Simule un clic (tests, avancement tactile). */
  click(x: number, y: number): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pendingPointerPress = true;
  }

  update(): void {
    this.pollGamepads();
    this.previous = this.current;
    const now = new Set<Action>(this.virtualDown);
    for (const code of this.downKeys) for (const a of this.keyToActions.get(code) ?? []) now.add(a);
    for (const a of this.gamepadDown) now.add(a);
    this.current = now;
    const just = new Set<Action>(this.pendingPresses);
    for (const a of now) if (!this.previous.has(a)) just.add(a);
    this.justPressedSet = just;
    this.pendingPresses = new Set();
    this.pointer.justPressed = this.pendingPointerPress;
    this.pendingPointerPress = false;
    this.pointer.wheel = this.pendingWheel;
    this.pendingWheel = 0;
  }

  isDown(action: Action): boolean {
    return this.current.has(action);
  }

  justPressed(action: Action): boolean {
    return this.justPressedSet.has(action);
  }

  /** Consomme un appui (évite qu'un même appui soit traité par deux systèmes). */
  consume(action: Action): void {
    this.justPressedSet.delete(action);
  }

  consumePointer(): void {
    this.pointer.justPressed = false;
  }

  /** Direction courante (priorité à la plus récente n'est pas gérée : ordre haut, bas, gauche, droite). */
  direction(): 'up' | 'down' | 'left' | 'right' | null {
    for (const d of ['up', 'down', 'left', 'right'] as const) if (this.current.has(d)) return d;
    return null;
  }

  private pollGamepads(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const down = new Set<Action>();
    for (const pad of pads) {
      if (!pad) continue;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (b(12) || ay < -0.5) down.add('up');
      if (b(13) || ay > 0.5) down.add('down');
      if (b(14) || ax < -0.5) down.add('left');
      if (b(15) || ax > 0.5) down.add('right');
      if (b(0)) down.add('confirm');
      if (b(1)) down.add('cancel');
      if (b(9)) down.add('menu');
      if (b(2)) down.add('dash');
      if (b(5)) down.add('skip');
    }
    this.gamepadDown = down;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Vrai si `related` est `container` lui-même ou un de ses descendants. Utilise `contains` par
 * détection de fonctionnalité (plutôt que `instanceof Node`, indisponible hors navigateur) pour
 * rester testable avec de faux éléments en environnement Node.
 */
function relatedTargetInside(container: Window | HTMLElement, related: EventTarget | null): boolean {
  if (!related) return false;
  const withContains = container as unknown as { contains?: (other: EventTarget) => boolean };
  return typeof withContains.contains === 'function' && withContains.contains(related);
}

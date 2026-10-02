import type { Action, InputManager } from './input';

/** Actions de direction pilotées par la croix / le joystick virtuel. */
export type DirectionAction = 'up' | 'down' | 'left' | 'right';

/** Boutons d'action disponibles à droite de l'écran. */
export type TouchButton = 'confirm' | 'cancel' | 'menu';

/** Disposition tactile d'un mode : croix directionnelle et/ou boutons. */
export interface TouchOptions {
  /** Croix directionnelle (joystick 8 directions) à gauche. */
  dpad: boolean;
  /** Boutons à droite ; `[]` pour n'en afficher aucun. */
  buttons: TouchButton[];
  /**
   * Affichage : `'auto'` (défaut) seulement sur appareil tactile (`pointer: coarse` ou premier événement
   * tactile), `'always'` pour forcer (tests, aperçu).
   */
  show?: 'auto' | 'always';
}

const ALL_BUTTONS: TouchButton[] = ['confirm', 'cancel', 'menu'];

/**
 * Dispositions par défaut selon l'identifiant du mode : croix + A/B/☰ pour les modes à déplacement,
 * ☰ seul pour les modes tout-souris (VN, point & click), croix + A/B/☰ par défaut pour un mode inconnu.
 */
export const TOUCH_LAYOUTS: Record<string, TouchOptions> = {
  rpg: { dpad: true, buttons: ALL_BUTTONS },
  platformer: { dpad: true, buttons: ALL_BUTTONS },
  sandbox3d: { dpad: true, buttons: ALL_BUTTONS },
  vn: { dpad: false, buttons: ['menu'] },
  pointclick: { dpad: false, buttons: ['menu'] },
};

export function touchLayoutForMode(mode: string): TouchOptions {
  const layout = TOUCH_LAYOUTS[mode] ?? { dpad: true, buttons: ALL_BUTTONS };
  return { ...layout, buttons: [...layout.buttons] };
}

/**
 * Directions actives pour un point du joystick, relatif à son centre (`dx`, `dy` en pixels, y vers le bas).
 * Zone morte = fraction du rayon ; 8 directions (diagonales à ±22,5° des axes).
 */
export function joystickDirections(dx: number, dy: number, radius: number, deadZone = 0.25): Set<DirectionAction> {
  const out = new Set<DirectionAction>();
  const dist = Math.hypot(dx, dy);
  if (radius <= 0 || dist < deadZone * radius) return out;
  const nx = dx / dist;
  const ny = dy / dist;
  const t = Math.sin(Math.PI / 8);
  if (nx > t) out.add('right');
  if (nx < -t) out.add('left');
  if (ny > t) out.add('down');
  if (ny < -t) out.add('up');
  return out;
}

const DIRECTIONS: DirectionAction[] = ['up', 'down', 'left', 'right'];

/** Applique un ensemble de directions à l'InputManager (relâche les autres). */
export function applyDirections(input: InputManager, active: ReadonlySet<DirectionAction>): void {
  for (const d of DIRECTIONS) input.setVirtual(d, active.has(d));
}

/** Vrai si l'appareil a un pointeur principal grossier (écran tactile). */
export function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export interface TouchControls {
  /** Affiche ou masque les contrôles. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

const BUTTON_LABELS: Record<TouchButton, string> = { confirm: 'A', cancel: 'B', menu: '☰' };
const BUTTON_ACTION: Record<TouchButton, Action> = { confirm: 'confirm', cancel: 'cancel', menu: 'menu' };

/**
 * Crée les manettes virtuelles au-dessus du jeu, dans `parent` (positionnement fixe). Multi-touch :
 * chaque doigt est suivi par son `pointerId`. À appeler côté navigateur seulement (aucun accès DOM
 * au chargement du module). Retourne `null` côté serveur.
 */
export function createTouchControls(
  input: InputManager,
  parent: HTMLElement,
  options: TouchOptions,
): TouchControls | null {
  if (typeof document === 'undefined') return null;
  const root = document.createElement('div');
  root.dataset.forgeTouch = '';
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:50;touch-action:none;user-select:none;' +
    '-webkit-user-select:none;-webkit-touch-callout:none;display:none';
  const cleanups: (() => void)[] = [];
  const base =
    'position:absolute;pointer-events:auto;touch-action:none;background:rgba(255,255,255,0.18);' +
    'border:2px solid rgba(255,255,255,0.45);color:rgba(255,255,255,0.85);display:flex;align-items:center;' +
    'justify-content:center;font:bold 22px system-ui,sans-serif;box-sizing:border-box;';

  if (options.dpad) {
    const pad = document.createElement('div');
    pad.style.cssText =
      `${base}left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));` +
      'width:150px;height:150px;border-radius:50%;';
    const knob = document.createElement('div');
    knob.style.cssText =
      'width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.35);pointer-events:none;' +
      'transition:transform 40ms linear;';
    pad.appendChild(knob);
    let activeId: number | null = null;
    const update = (ev: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      const radius = rect.width / 2;
      const dx = ev.clientX - (rect.left + radius);
      const dy = ev.clientY - (rect.top + rect.height / 2);
      applyDirections(input, joystickDirections(dx, dy, radius));
      const dist = Math.hypot(dx, dy) || 1;
      const k = Math.min(dist, radius * 0.6) / dist;
      knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== activeId) return;
      activeId = null;
      applyDirections(input, new Set());
      knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', (ev) => {
      if (activeId !== null) return;
      activeId = ev.pointerId;
      pad.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
      update(ev);
    });
    pad.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === activeId) update(ev);
    });
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    root.appendChild(pad);
  }

  options.buttons.forEach((name, index) => {
    const btn = document.createElement('div');
    btn.textContent = BUTTON_LABELS[name];
    const size = name === 'menu' ? 48 : 68;
    // A en bas à droite, B au-dessus à gauche de A, ☰ en haut à droite.
    const pos =
      name === 'menu'
        ? 'top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));'
        : `right:calc(max(16px,env(safe-area-inset-right)) + ${name === 'confirm' ? 0 : 84}px);` +
          `bottom:calc(max(16px,env(safe-area-inset-bottom)) + ${name === 'confirm' ? 40 : 0}px);`;
    btn.style.cssText = `${base}${pos}width:${size}px;height:${size}px;border-radius:50%;`;
    btn.dataset.button = name;
    btn.dataset.index = String(index);
    const action = BUTTON_ACTION[name];
    const ids = new Set<number>();
    const up = (ev: PointerEvent) => {
      ids.delete(ev.pointerId);
      if (ids.size === 0) {
        input.setVirtual(action, false);
        btn.style.background = 'rgba(255,255,255,0.18)';
      }
    };
    btn.addEventListener('pointerdown', (ev) => {
      ids.add(ev.pointerId);
      btn.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
      input.setVirtual(action, true);
      btn.style.background = 'rgba(255,255,255,0.4)';
    });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    root.appendChild(btn);
  });

  parent.appendChild(root);
  const setVisible = (visible: boolean) => {
    root.style.display = visible ? 'block' : 'none';
    if (!visible) input.clearVirtual();
  };
  if (options.show === 'always' || isCoarsePointer()) {
    setVisible(true);
  } else if (typeof window !== 'undefined') {
    const onTouch = () => setVisible(true);
    window.addEventListener('touchstart', onTouch, { once: true, passive: true });
    cleanups.push(() => window.removeEventListener('touchstart', onTouch));
  }
  return {
    setVisible,
    destroy() {
      for (const c of cleanups) c();
      input.clearVirtual();
      root.remove();
    },
  };
}

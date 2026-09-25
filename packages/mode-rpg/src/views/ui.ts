import { DEFAULT_THEME, drawPanel, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Text, TextStyle, type TextStyleOptions } from 'pixi.js';

/** Thème des fenêtres du RPG, dimensionné pour 960×540. */
export const RPG_THEME: UiTheme = {
  ...DEFAULT_THEME,
  fontSize: 20,
  lineHeight: 28,
  padding: 16,
  radius: 8,
  panelColor: 0x121a33,
  panelAlpha: 0.92,
  borderColor: 0x9db8ff,
  borderWidth: 2,
  accentColor: 0xffd35a,
  selectionColor: 0x2f4f96,
};

/** Hauteur d'un `ChoiceMenu` de `count` lignes (même calcul que render2d). */
export function choiceMenuHeight(theme: UiTheme, count: number): number {
  const rowH = theme.lineHeight + theme.padding * 0.9;
  const gap = Math.round(theme.padding * 0.35);
  return count * rowH + Math.max(0, count - 1) * gap;
}

export function textStyle(theme: UiTheme, over: TextStyleOptions = {}): TextStyle {
  return new TextStyle({
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    lineHeight: theme.lineHeight,
    fill: theme.textColor,
    ...over,
  });
}

export function label(text: string, theme: UiTheme = RPG_THEME, over: TextStyleOptions = {}): Text {
  return new Text({ text, style: textStyle(theme, over) });
}

/** Fenêtre (panneau) redimensionnable. */
export class Panel extends Container {
  private readonly bg = new Graphics();

  constructor(
    public panelWidth: number,
    public panelHeight: number,
    private readonly theme: UiTheme = RPG_THEME,
  ) {
    super();
    drawPanel(this.bg, panelWidth, panelHeight, theme);
    this.addChild(this.bg);
  }

  resize(width: number, height: number): void {
    this.panelWidth = width;
    this.panelHeight = height;
    drawPanel(this.bg, width, height, this.theme);
  }
}

/** Couleur stable dérivée d'un texte (repères visuels des assets manquants). */
export function colorFromText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const [r, g, b] = hslToRgb(hue / 360, 0.55, 0.55);
  return (r << 16) | (g << 8) | b;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Interruption d'une séquence asynchrone (changement d'écran, destruction). */
export class Cancelled extends Error {
  constructor() {
    super('Séquence interrompue');
    this.name = 'Cancelled';
  }
}

/**
 * Petites coroutines pilotées par `update(dt)` : attendre une condition ou un délai.
 * Chaque condition est évaluée une fois par frame (elle peut donc lire les entrées).
 */
export class Flow {
  private waiters: { check: () => boolean; resolve: () => void }[] = [];
  private time = 0;

  /** Temps écoulé (secondes) depuis la création. */
  get now(): number {
    return this.time;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.waiters.length === 0) return;
    const pending = this.waiters;
    this.waiters = [];
    const keep: typeof pending = [];
    for (const w of pending) {
      if (w.check()) w.resolve();
      else keep.push(w);
    }
    this.waiters = [...keep, ...this.waiters];
  }

  until(check: () => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ check, resolve }));
  }

  delay(seconds: number): Promise<void> {
    const end = this.time + seconds;
    return this.until(() => this.time >= end);
  }

  /** Abandonne toutes les attentes (les séquences en cours ne reprendront jamais). */
  cancelAll(): void {
    this.waiters = [];
  }
}

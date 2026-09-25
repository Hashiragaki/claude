import type { InputManager } from '@forge/core';
import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { DEFAULT_THEME, type UiTheme } from './theme';

/** Dessine un panneau arrondi semi-transparent avec bordure. */
export function drawPanel(g: Graphics, width: number, height: number, theme: UiTheme = DEFAULT_THEME): Graphics {
  g.clear();
  g.roundRect(0, 0, width, height, theme.radius).fill({ color: theme.panelColor, alpha: theme.panelAlpha });
  if (theme.borderWidth > 0) {
    g.roundRect(0, 0, width, height, theme.radius).stroke({
      width: theme.borderWidth,
      color: theme.borderColor,
      alpha: 0.9,
    });
  }
  return g;
}

function textStyle(theme: UiTheme, over: Partial<ConstructorParameters<typeof TextStyle>[0] & object> = {}): TextStyle {
  return new TextStyle({
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    lineHeight: theme.lineHeight,
    fill: theme.textColor,
    ...over,
  });
}

export interface MessageBoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  theme?: UiTheme;
  /** Vitesse d'affichage (caractères/s). 0 = instantané. */
  charsPerSecond?: number;
}

/**
 * Fenêtre de dialogue avec plaque de nom, effet machine à écrire et indicateur « suite ».
 */
export class MessageBox extends Container {
  charsPerSecond: number;
  private readonly theme: UiTheme;
  private readonly bg = new Graphics();
  private readonly nameBg = new Graphics();
  private readonly nameText: Text;
  private readonly body: Text;
  private readonly indicator = new Graphics();
  private readonly boxWidth: number;
  private readonly boxHeight: number;
  private fullText = '';
  private visibleChars = 0;
  private time = 0;

  constructor(options: MessageBoxOptions) {
    super();
    this.theme = options.theme ?? DEFAULT_THEME;
    this.charsPerSecond = options.charsPerSecond ?? 45;
    this.position.set(options.x, options.y);
    this.boxWidth = options.width;
    this.boxHeight = options.height;
    drawPanel(this.bg, options.width, options.height, this.theme);
    this.nameText = new Text({
      text: '',
      style: textStyle(this.theme, { fontWeight: 'bold', fill: this.theme.nameColor }),
    });
    this.body = new Text({ text: '', style: textStyle(this.theme) });
    this.body.position.set(this.theme.padding, this.theme.padding);
    const s = Math.max(6, Math.round(this.theme.fontSize * 0.35));
    this.indicator.poly([0, 0, s * 2, 0, s, s * 1.4]).fill(this.theme.accentColor);
    this.indicator.position.set(options.width - this.theme.padding - s * 2, options.height - this.theme.padding - s);
    this.addChild(this.bg, this.nameBg, this.nameText, this.body, this.indicator);
    this.visible = false;
  }

  /** Affiche un texte, avec éventuellement le nom (et la couleur) de l'orateur. */
  show(text: string, speaker?: { name: string; color?: number } | null): void {
    const pad = this.theme.padding;
    const wrapStyle = textStyle(this.theme, {
      wordWrap: true,
      wordWrapWidth: this.boxWidth - pad * 2,
      breakWords: true,
    });
    const lines = CanvasTextMetrics.measureText(text, wrapStyle).lines;
    this.fullText = lines.join('\n');
    this.visibleChars = this.charsPerSecond > 0 ? 0 : this.fullText.length;
    this.body.text = this.fullText.slice(0, this.visibleChars);
    if (speaker?.name) {
      this.nameText.text = speaker.name;
      this.nameText.style.fill = speaker.color ?? this.theme.nameColor;
      const w = this.nameText.width + pad * 1.5;
      const h = this.theme.lineHeight + pad * 0.5;
      this.nameBg.clear();
      this.nameBg.roundRect(0, 0, w, h, this.theme.radius).fill({ color: this.theme.panelColor, alpha: 0.95 });
      this.nameBg
        .roundRect(0, 0, w, h, this.theme.radius)
        .stroke({ width: this.theme.borderWidth, color: speaker.color ?? this.theme.borderColor });
      this.nameBg.position.set(pad * 0.6, -h * 0.7);
      this.nameText.position.set(pad * 0.6 + (w - this.nameText.width) / 2, -h * 0.7 + (h - this.nameText.height) / 2);
      this.nameBg.visible = this.nameText.visible = true;
    } else {
      this.nameBg.visible = this.nameText.visible = false;
    }
    this.visible = true;
  }

  get typing(): boolean {
    return this.visibleChars < this.fullText.length;
  }

  /** Affiche immédiatement tout le texte. */
  skipTyping(): void {
    this.visibleChars = this.fullText.length;
    this.body.text = this.fullText;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.typing) {
      this.visibleChars = Math.min(this.fullText.length, this.visibleChars + this.charsPerSecond * dt);
      this.body.text = this.fullText.slice(0, Math.floor(this.visibleChars));
    }
    this.indicator.visible = !this.typing && this.visible && Math.floor(this.time * 2.5) % 2 === 0;
  }

  hide(): void {
    this.visible = false;
  }

  get panelHeight(): number {
    return this.boxHeight;
  }
}

export interface ChoiceItem {
  label: string;
  enabled?: boolean;
}

export interface ChoiceMenuOpenOptions {
  /** Centre horizontal / haut du menu (par défaut centré sur l'écran fourni au constructeur). */
  x?: number;
  y?: number;
  width?: number;
  /** Permet d'annuler (renvoie -1). */
  cancelable?: boolean;
  initialIndex?: number;
}

/**
 * Menu vertical de choix, navigable au clavier/manette et à la souris.
 * `handleInput` renvoie l'index choisi, -1 en cas d'annulation, `null` sinon.
 */
export class ChoiceMenu extends Container {
  private readonly theme: UiTheme;
  private items: ChoiceItem[] = [];
  private rows: { bg: Graphics; label: Text }[] = [];
  private index = 0;
  private cancelable = false;
  private pending: number | null = null;
  private menuWidth = 0;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
    theme: UiTheme = DEFAULT_THEME,
  ) {
    super();
    this.theme = theme;
    this.visible = false;
  }

  get isOpen(): boolean {
    return this.visible;
  }

  get selectedIndex(): number {
    return this.index;
  }

  open(items: ChoiceItem[], options: ChoiceMenuOpenOptions = {}): void {
    this.close();
    this.items = items;
    this.cancelable = options.cancelable ?? false;
    this.pending = null;
    const t = this.theme;
    const rowH = t.lineHeight + t.padding * 0.9;
    const gap = Math.round(t.padding * 0.35);
    const style = textStyle(t);
    const widest = Math.max(...items.map((i) => CanvasTextMetrics.measureText(i.label, style).width), 80);
    this.menuWidth = options.width ?? Math.min(this.screenWidth * 0.9, widest + t.padding * 3);
    const totalH = items.length * rowH + (items.length - 1) * gap;
    const cx = options.x ?? this.screenWidth / 2;
    const top = options.y ?? Math.max(t.padding, (this.screenHeight - totalH) / 2 - this.screenHeight * 0.08);
    this.position.set(cx - this.menuWidth / 2, top);

    items.forEach((item, i) => {
      const bg = new Graphics();
      bg.position.set(0, i * (rowH + gap));
      const label = new Text({
        text: item.label,
        style: textStyle(t, { fill: item.enabled === false ? t.mutedTextColor : t.textColor }),
      });
      label.position.set((this.menuWidth - label.width) / 2, i * (rowH + gap) + (rowH - label.height) / 2);
      bg.eventMode = 'static';
      bg.cursor = item.enabled === false ? 'not-allowed' : 'pointer';
      bg.on('pointerover', () => this.select(i));
      bg.on('pointertap', () => {
        if (item.enabled !== false) this.pending = i;
      });
      this.addChild(bg, label);
      this.rows.push({ bg, label });
    });
    this.index = Math.min(options.initialIndex ?? this.firstEnabled(), items.length - 1);
    this.redraw();
    this.visible = true;
  }

  close(): void {
    for (const row of this.rows) {
      row.bg.destroy();
      row.label.destroy();
    }
    this.rows = [];
    this.removeChildren();
    this.visible = false;
  }

  private firstEnabled(): number {
    const i = this.items.findIndex((it) => it.enabled !== false);
    return i < 0 ? 0 : i;
  }

  private select(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.redraw();
  }

  private redraw(): void {
    const t = this.theme;
    const rowH = t.lineHeight + t.padding * 0.9;
    this.rows.forEach(({ bg }, i) => {
      const selected = i === this.index;
      bg.clear();
      bg.roundRect(0, 0, this.menuWidth, rowH, t.radius).fill({
        color: selected ? t.selectionColor : t.panelColor,
        alpha: selected ? 0.95 : t.panelAlpha,
      });
      bg.roundRect(0, 0, this.menuWidth, rowH, t.radius).stroke({
        width: t.borderWidth,
        color: selected ? t.accentColor : t.borderColor,
        alpha: selected ? 1 : 0.35,
      });
    });
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    let i = this.index;
    for (let n = 0; n < this.items.length; n++) {
      i = (i + delta + this.items.length) % this.items.length;
      if (this.items[i]?.enabled !== false) break;
    }
    this.select(i);
  }

  handleInput(input: InputManager): number | null {
    if (!this.visible) return null;
    if (this.pending !== null) {
      const chosen = this.pending;
      this.pending = null;
      input.consumePointer();
      return chosen;
    }
    if (input.justPressed('up')) this.move(-1);
    if (input.justPressed('down')) this.move(1);
    if (input.justPressed('confirm') && this.items[this.index]?.enabled !== false) {
      input.consume('confirm');
      return this.index;
    }
    if (this.cancelable && input.justPressed('cancel')) {
      input.consume('cancel');
      return -1;
    }
    return null;
  }
}

/** Voile plein écran pour les fondus au noir / au blanc. */
export class Fader extends Graphics {
  private target = 0;
  private speed = 0;
  private resolveFn: (() => void) | null = null;

  constructor(width: number, height: number, color = 0x000000) {
    super();
    this.rect(0, 0, width, height).fill(color);
    this.alpha = 0;
    this.eventMode = 'none';
  }

  /** Anime l'opacité vers `alpha` en `seconds`. */
  fadeTo(alpha: number, seconds: number): Promise<void> {
    this.resolveFn?.();
    this.target = alpha;
    // Déjà à la cible : rien à animer (sinon `update` ne résoudrait jamais la promesse).
    if (seconds <= 0 || Math.abs(this.alpha - alpha) < 1e-4) {
      this.alpha = alpha;
      this.resolveFn = null;
      return Promise.resolve();
    }
    this.speed = Math.abs(alpha - this.alpha) / seconds;
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  update(dt: number): void {
    if (this.alpha === this.target) return;
    const step = this.speed * dt;
    this.alpha =
      this.alpha < this.target ? Math.min(this.target, this.alpha + step) : Math.max(this.target, this.alpha - step);
    if (this.alpha === this.target && this.resolveFn) {
      const r = this.resolveFn;
      this.resolveFn = null;
      r();
    }
  }
}

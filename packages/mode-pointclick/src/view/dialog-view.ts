import type { InputManager } from '@forge/core';
import { ChoiceMenu, MessageBox, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Text } from 'pixi.js';
import type { ChoiceView, MessageView } from '../types';

/** Étiquette près du curseur (survol) : nom de la zone ou « Utiliser X sur Y ». */
export class HoverLabel extends Container {
  private readonly bg = new Graphics();
  private readonly text: Text;

  constructor(
    private readonly viewWidth: number,
    private readonly viewHeight: number,
    private readonly theme: UiTheme,
  ) {
    super();
    this.text = new Text({
      text: '',
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 0.8),
        fill: theme.textColor,
        fontWeight: '600',
      },
    });
    this.addChild(this.bg, this.text);
    this.visible = false;
    this.eventMode = 'none';
  }

  show(label: string, x: number, y: number): void {
    if (!label) {
      this.visible = false;
      return;
    }
    if (this.text.text !== label) {
      this.text.text = label;
      const padX = Math.round(this.theme.padding * 0.6);
      const padY = Math.round(this.theme.padding * 0.3);
      this.text.position.set(padX, padY);
      this.bg.clear();
      this.bg
        .roundRect(0, 0, this.text.width + padX * 2, this.text.height + padY * 2, this.theme.radius)
        .fill({ color: this.theme.panelColor, alpha: 0.88 })
        .roundRect(0, 0, this.text.width + padX * 2, this.text.height + padY * 2, this.theme.radius)
        .stroke({ width: 1, color: this.theme.borderColor, alpha: 0.6 });
    }
    const w = this.text.width + Math.round(this.theme.padding * 1.2);
    const h = this.text.height + Math.round(this.theme.padding * 0.6);
    const left = Math.max(4, Math.min(this.viewWidth - w - 4, x + 14));
    // Sous le curseur ; au-dessus s'il n'y a pas la place.
    const below = y + 24;
    const top = below + h > this.viewHeight - 4 ? Math.max(4, y - h - 10) : below;
    this.position.set(Math.round(left), Math.round(top));
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }
}

/**
 * Boîte de texte (bulle avec nom de l'orateur, effet machine à écrire) et choix de dialogue
 * (cliquables, flèches + Entrée au clavier), posés au-dessus de la barre d'inventaire.
 */
export class DialogView extends Container {
  private readonly box: MessageBox;
  private readonly promptBox: MessageBox;
  private readonly menu: ChoiceMenu;
  private readonly margin: number;
  private readonly boxHeight: number;
  private options: ChoiceView['options'] = [];

  constructor(
    private readonly viewWidth: number,
    private readonly viewHeight: number,
    private readonly theme: UiTheme,
  ) {
    super();
    this.margin = Math.round(theme.padding * 0.8);
    this.boxHeight = Math.round(theme.lineHeight * 3 + theme.padding * 2);
    const width = viewWidth - this.margin * 2;
    this.box = new MessageBox({ x: this.margin, y: 0, width, height: this.boxHeight, theme });
    this.promptBox = new MessageBox({
      x: this.margin,
      y: 0,
      width,
      height: Math.round(theme.lineHeight * 2 + theme.padding * 2),
      theme,
      charsPerSecond: 0,
    });
    this.menu = new ChoiceMenu(viewWidth, viewHeight, theme);
    this.addChild(this.box, this.promptBox, this.menu);
  }

  get typing(): boolean {
    return this.box.typing;
  }

  skipTyping(): void {
    this.box.skipTyping();
  }

  get choosing(): boolean {
    return this.menu.isOpen;
  }

  /** `reserved` = hauteur occupée en bas (barre d'inventaire). */
  showMessage(message: MessageView, reserved: number): void {
    this.box.y = this.viewHeight - this.margin - reserved - this.boxHeight;
    this.box.show(message.text, message.speaker ? { name: message.speaker } : null);
  }

  hideMessage(): void {
    this.box.hide();
  }

  openChoices(choice: ChoiceView, reserved: number): void {
    const t = this.theme;
    const rowH = t.lineHeight + t.padding * 0.9;
    const gap = Math.round(t.padding * 0.35);
    const n = choice.options.length;
    const total = n * rowH + (n - 1) * gap;
    const bottom = this.viewHeight - this.margin - reserved;
    this.options = choice.options;
    this.menu.open(
      choice.options.map((o) => ({ label: o.text })),
      { x: this.viewWidth / 2, y: bottom - total, width: Math.round(this.viewWidth * 0.7) },
    );
    const label = choice.prompt ?? '';
    if (label || choice.speaker) {
      this.promptBox.y = bottom - total - gap * 3 - this.promptBox.panelHeight;
      this.promptBox.show(label, choice.speaker ? { name: choice.speaker } : null);
    } else {
      this.promptBox.hide();
    }
  }

  closeChoices(): void {
    this.menu.close();
    this.promptBox.hide();
    this.options = [];
  }

  /** Index d'origine du choix validé (souris, flèches + Entrée), sinon `null`. */
  pollChoice(input: InputManager): number | null {
    const picked = this.menu.handleInput(input);
    if (picked === null || picked < 0) return null;
    return this.options[picked]?.index ?? null;
  }

  update(dt: number): void {
    this.box.update(dt);
    this.promptBox.update(dt);
  }
}

/** Message bref en haut de l'écran (sauvegarde effectuée, chargement impossible…). */
export class Toast extends Container {
  private readonly bg = new Graphics();
  private readonly text: Text;
  private remaining = 0;

  constructor(
    private readonly viewWidth: number,
    private readonly theme: UiTheme,
  ) {
    super();
    this.text = new Text({
      text: '',
      style: { fontFamily: theme.fontFamily, fontSize: Math.round(theme.fontSize * 0.85), fill: theme.textColor },
    });
    this.addChild(this.bg, this.text);
    this.visible = false;
    this.eventMode = 'none';
  }

  show(message: string): void {
    const t = this.theme;
    this.text.text = message;
    const w = this.text.width + t.padding * 2;
    const h = this.text.height + t.padding;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, w, h, t.radius)
      .fill({ color: t.panelColor, alpha: 0.92 })
      .roundRect(0, 0, w, h, t.radius)
      .stroke({ width: t.borderWidth, color: t.accentColor, alpha: 0.8 });
    this.text.position.set(t.padding, t.padding / 2);
    this.position.set(Math.round((this.viewWidth - w) / 2), Math.round(t.padding));
    this.remaining = 2;
    this.alpha = 1;
    this.visible = true;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.visible = false;
    else this.alpha = Math.min(1, this.remaining / 0.4);
  }
}

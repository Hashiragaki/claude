import { hashString } from '@forge/core';
import type { UiTheme } from '@forge/render2d';
import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { Fader } from '@forge/render2d';

const PLACEHOLDER_COLORS = [0x5b7db1, 0x9c6ade, 0xd9776b, 0x4f9d8f, 0xc49a3a, 0x7a8c4f, 0xb05c8a, 0x5a9bd4];

/** Couleur stable dérivée d'un nom. */
export function colorFromName(name: string): number {
  return PLACEHOLDER_COLORS[hashString(name) % PLACEHOLDER_COLORS.length] as number;
}

/** Substitut d'image manquante : rectangle arrondi teinté portant le nom. */
export function createPlaceholder(
  label: string,
  width: number,
  height: number,
  theme: UiTheme,
  radius = 24,
): Container {
  const box = new Container();
  const g = new Graphics()
    .roundRect(0, 0, width, height, radius)
    .fill({ color: colorFromName(label), alpha: 0.85 })
    .roundRect(0, 0, width, height, radius)
    .stroke({ width: 3, color: 0xffffff, alpha: 0.45 });
  const text = new Text({
    text: label,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: Math.max(14, Math.round(theme.fontSize * 0.9)),
      fill: 0xffffff,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: Math.max(40, width - 24),
    },
  });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2);
  box.addChild(g, text);
  return box;
}

/** Fond plein écran bloquant les clics vers les couches inférieures. */
export function createBackdrop(width: number, height: number, alpha: number, color = 0x000000): Graphics {
  const g = new Graphics().rect(0, 0, width, height).fill({ color, alpha });
  g.eventMode = 'static';
  return g;
}

/** Bouton texte cliquable (menu rapide, retour). */
export class TextButton extends Container {
  private readonly caption: Text;
  private active = false;
  private hover = false;

  constructor(
    text: string,
    private readonly theme: UiTheme,
    fontSize: number,
    onTap: () => void,
  ) {
    super();
    this.caption = new Text({ text, style: { fontFamily: theme.fontFamily, fontSize, fill: theme.mutedTextColor } });
    this.addChild(this.caption);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(-8, -6, this.caption.width + 16, this.caption.height + 12);
    this.on('pointerover', () => {
      this.hover = true;
      this.refresh();
    });
    this.on('pointerout', () => {
      this.hover = false;
      this.refresh();
    });
    this.on('pointertap', (event) => {
      event.stopPropagation();
      onTap();
    });
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.refresh();
  }

  private refresh(): void {
    // Un bouton détruit peut encore recevoir « pointerout » : on l'ignore.
    if (this.destroyed) return;
    const t = this.theme;
    this.caption.style.fill = this.active ? t.accentColor : this.hover ? t.textColor : t.mutedTextColor;
  }
}

/** Message bref affiché en haut de l'écran (« Partie sauvegardée. »). */
export class Toast extends Text {
  private remaining = 0;

  constructor(width: number, theme: UiTheme) {
    super({
      text: '',
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 0.8),
        fill: theme.textColor,
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 4, distance: 2, angle: Math.PI / 4 },
      },
    });
    this.anchor.set(0.5, 0);
    this.position.set(width / 2, Math.round(theme.padding * 0.8));
    this.alpha = 0;
    this.eventMode = 'none';
  }

  show(message: string): void {
    this.text = message;
    this.remaining = 2.2;
    this.alpha = 1;
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    this.alpha = Math.max(0, Math.min(1, this.remaining / 0.4));
  }
}

/** Narration centrée sans boîte de dialogue (`centered "…"`). */
export class CenteredText extends Text {
  constructor(width: number, height: number, theme: UiTheme) {
    super({
      text: '',
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 1.3),
        lineHeight: Math.round(theme.lineHeight * 1.3),
        fill: theme.textColor,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.7,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 6, distance: 2, angle: Math.PI / 4 },
      },
    });
    this.anchor.set(0.5);
    this.position.set(width / 2, height / 2);
    this.visible = false;
    this.eventMode = 'none';
  }

  show(text: string): void {
    this.text = text;
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }
}

/**
 * `Fader.fadeTo` ne se résout jamais si l'opacité vaut déjà la cible : on court-circuite ce cas.
 */
export function fadeTo(fader: Fader, alpha: number, seconds: number): Promise<void> {
  if (seconds <= 0 || Math.abs(fader.alpha - alpha) < 1e-4) return fader.fadeTo(alpha, 0);
  return fader.fadeTo(alpha, seconds);
}

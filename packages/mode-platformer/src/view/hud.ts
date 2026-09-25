import { drawPanel, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { HudView } from '../types';

/** Thème pixel-art du HUD et de la bulle de panneau, dimensionné pour un rendu zoomé. */
export const PLATFORMER_THEME: UiTheme = {
  fontFamily: '"Courier New", monospace',
  fontSize: 14,
  lineHeight: 17,
  textColor: 0xffffff,
  mutedTextColor: 0xb8b8c0,
  nameColor: 0xffffff,
  panelColor: 0x121417,
  panelAlpha: 0.78,
  borderColor: 0xffffff,
  borderWidth: 1,
  accentColor: 0xffd35a,
  selectionColor: 0x2c5f99,
  radius: 4,
  padding: 8,
};

function hudStyle(theme: UiTheme): TextStyle {
  return new TextStyle({
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    fill: theme.textColor,
    stroke: { color: 0x000000, width: 3, join: 'round' },
  });
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Barre d'informations (niveau, vies, pièces, score, temps), en haut à gauche de l'écran. */
export class Hud extends Container {
  private readonly text: Text;

  constructor(private readonly theme: UiTheme = PLATFORMER_THEME) {
    super();
    this.text = new Text({ text: '', style: hudStyle(theme) });
    this.text.position.set(theme.padding, theme.padding * 0.6);
    this.addChild(this.text);
  }

  sync(hud: HudView): void {
    const parts = [`${hud.levelName || hud.level}`, `Vies ${hud.lives}`, `Pièces ${hud.coins}`, `Score ${hud.score}`];
    if (hud.timeLeft !== undefined) parts.push(`Temps ${formatTime(hud.timeLeft)}`);
    this.text.text = parts.join('    ');
  }
}

const SIGN_BUBBLE_WIDTH = 260;
const SIGN_BUBBLE_MARGIN = 10;

/** Bulle de texte affichée au-dessus du joueur quand il est devant un panneau (`currentSign`). */
export class SignBubble extends Container {
  private readonly bg = new Graphics();
  private readonly bodyText: Text;

  constructor(private readonly theme: UiTheme = PLATFORMER_THEME) {
    super();
    this.bodyText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize,
        fill: theme.textColor,
        wordWrap: true,
        wordWrapWidth: SIGN_BUBBLE_WIDTH - theme.padding * 2,
      }),
    });
    this.bodyText.position.set(theme.padding, theme.padding * 0.6);
    this.addChild(this.bg, this.bodyText);
    this.visible = false;
  }

  /**
   * Affiche `text` centré au-dessus de `(anchorX, anchorY)` (coordonnées écran), replié dans les
   * bords de l'écran (`screenWidth`).
   */
  show(text: string, anchorX: number, anchorY: number, screenWidth: number): void {
    this.bodyText.text = text;
    const width = SIGN_BUBBLE_WIDTH;
    const height = this.bodyText.height + this.theme.padding * 1.6;
    drawPanel(this.bg, width, height, this.theme);
    const x = Math.max(SIGN_BUBBLE_MARGIN, Math.min(screenWidth - width - SIGN_BUBBLE_MARGIN, anchorX - width / 2));
    const y = Math.max(SIGN_BUBBLE_MARGIN, anchorY - height - 14);
    this.position.set(Math.round(x), Math.round(y));
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }
}

import type { InputManager } from '@forge/core';
import type { UiTheme } from '@forge/render2d';
import { Container, Text } from 'pixi.js';
import { createBackdrop } from './widgets';

/** Écran « Fin » : un clic ou Entrée ramène à l'écran titre. */
export class EndScreen extends Container {
  private clicked = false;
  private elapsed = 0;

  constructor(width: number, height: number, theme: UiTheme, text: string) {
    super();
    const backdrop = createBackdrop(width, height, 1);
    backdrop.cursor = 'pointer';
    backdrop.on('pointertap', () => {
      this.clicked = true;
    });
    const label = new Text({
      text,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 2.8),
        fontStyle: 'italic',
        fill: theme.textColor,
        letterSpacing: 4,
      },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    this.addChild(backdrop, label);
    this.alpha = 0;
  }

  /** Renvoie vrai quand le joueur demande à revenir au titre. */
  update(dt: number, input: InputManager): boolean {
    this.elapsed += dt;
    this.alpha = Math.min(1, this.elapsed / 1.2);
    // Laisse le temps d'apparaître avant d'accepter une validation.
    if (this.elapsed < 0.8) {
      this.clicked = false;
      return false;
    }
    return this.clicked || input.justPressed('confirm');
  }
}

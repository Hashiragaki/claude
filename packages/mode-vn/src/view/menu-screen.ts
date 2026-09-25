import type { InputManager } from '@forge/core';
import { ChoiceMenu, type ChoiceItem, type UiTheme } from '@forge/render2d';
import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { createBackdrop } from './widgets';

export interface MenuScreenOptions {
  width: number;
  height: number;
  theme: UiTheme;
  title: string;
  items: ChoiceItem[];
  /** Image de fond (écran titre), étirée pour couvrir l'écran. */
  background?: Texture | null;
  /** Grand titre (écran titre) plutôt qu'un simple intitulé. */
  large?: boolean;
  cancelable?: boolean;
}

/** Écran plein avec titre et liste de choix : écran titre, sauvegarde, chargement. */
export class MenuScreen extends Container {
  private readonly menu: ChoiceMenu;

  constructor(o: MenuScreenOptions) {
    super();
    const { width, height, theme } = o;
    this.addChild(createBackdrop(width, height, o.background ? 1 : 0.9, o.large ? 0x101820 : 0x000000));
    if (o.background) {
      const sprite = new Sprite(o.background);
      sprite.anchor.set(0.5);
      sprite.position.set(width / 2, height / 2);
      sprite.scale.set(Math.max(width / o.background.width, height / o.background.height));
      this.addChild(sprite, createBackdrop(width, height, 0.35));
    }
    const title = new Text({
      text: o.title,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * (o.large ? 2.6 : 1.4)),
        fontWeight: 'bold',
        fill: theme.textColor,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.85,
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 8, distance: 3, angle: Math.PI / 4 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(width / 2, height * (o.large ? 0.3 : 0.12));
    this.menu = new ChoiceMenu(width, height, theme);
    this.addChild(title, this.menu);
    const menuWidth = Math.min(width * 0.8, o.large ? theme.fontSize * 14 : theme.fontSize * 30);
    this.menu.open(o.items, {
      y: height * (o.large ? 0.5 : 0.2),
      width: menuWidth,
      cancelable: o.cancelable ?? false,
    });
  }

  /** Index choisi, -1 si annulé, `null` sinon. */
  handleInput(input: InputManager): number | null {
    return this.menu.handleInput(input);
  }
}

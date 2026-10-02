import type { InputManager } from '@forge/core';
import { ChoiceMenu, type ChoiceItem, type UiTheme } from '@forge/render2d';
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';

function backdrop(width: number, height: number, alpha: number, color = 0x000000): Graphics {
  const g = new Graphics().rect(0, 0, width, height).fill({ color, alpha });
  g.eventMode = 'static';
  return g;
}

export interface MenuScreenOptions {
  width: number;
  height: number;
  theme: UiTheme;
  title: string;
  items: ChoiceItem[];
  /** Image de fond (écran titre), mise à l'échelle pour couvrir l'écran. */
  background?: Texture | null;
  /** Grand titre (écran titre) plutôt qu'un simple intitulé. */
  large?: boolean;
  cancelable?: boolean;
}

/** Écran avec titre et liste de choix : écran titre, pause, sauvegarde, chargement. */
export class MenuScreen extends Container {
  private readonly menu: ChoiceMenu;

  constructor(o: MenuScreenOptions) {
    super();
    const { width, height, theme } = o;
    this.addChild(backdrop(width, height, o.background ? 1 : o.large ? 1 : 0.8, o.large ? 0x101820 : 0x000000));
    if (o.background) {
      const sprite = new Sprite(o.background);
      sprite.anchor.set(0.5);
      sprite.position.set(width / 2, height / 2);
      sprite.scale.set(Math.max(width / o.background.width, height / o.background.height));
      this.addChild(sprite, backdrop(width, height, o.large ? 0.4 : 0.6));
    }
    const title = new Text({
      text: o.title,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * (o.large ? 2.4 : 1.4)),
        fontWeight: 'bold',
        fill: theme.textColor,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.85,
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 8, distance: 3, angle: Math.PI / 4 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(width / 2, height * (o.large ? 0.28 : 0.12));
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

/** Écran de fin : texte de fin sur fond sombre, un clic ou Entrée pour revenir au titre. */
export class EndScreen extends Container {
  private readonly veil: Graphics;
  private readonly body: Container;
  private readonly hint: Text;
  private time = 0;

  constructor(width: number, height: number, theme: UiTheme, text: string, hint: string) {
    super();
    this.veil = backdrop(width, height, 0.78, 0x05070a);
    this.body = new Container();
    const title = new Text({
      text,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: Math.round(theme.fontSize * 1.8),
        fontWeight: 'bold',
        fill: theme.textColor,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.75,
        lineHeight: Math.round(theme.lineHeight * 1.6),
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 6, distance: 2, angle: Math.PI / 4 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(width / 2, height * 0.44);
    this.hint = new Text({
      text: hint,
      style: { fontFamily: theme.fontFamily, fontSize: Math.round(theme.fontSize * 0.8), fill: theme.mutedTextColor },
    });
    this.hint.anchor.set(0.5);
    this.hint.position.set(width / 2, height * 0.78);
    this.body.addChild(title, this.hint);
    this.addChild(this.veil, this.body);
    this.alpha = 0;
  }

  /** Vrai quand le joueur valide (clic ou Entrée) une fois le fondu terminé. */
  update(dt: number, input: InputManager, clicked: boolean): boolean {
    this.time += dt;
    this.alpha = Math.min(1, this.time / 0.8);
    this.hint.alpha = 0.55 + 0.45 * Math.sin(this.time * 3);
    if (this.time < 0.9) return false;
    if (input.justPressed('confirm')) {
      input.consume('confirm');
      return true;
    }
    return clicked;
  }
}

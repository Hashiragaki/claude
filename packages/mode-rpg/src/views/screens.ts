import { ChoiceMenu } from '@forge/render2d';
import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { SceneContext } from './context';

/** Écran titre : fond en dégradé, collines, titre du jeu et menu (Nouvelle partie / Continuer). */
export class TitleScreen extends Container {
  readonly menu: ChoiceMenu;

  constructor(ctx: SceneContext, title: string) {
    super();
    const { width: w, height: h } = ctx;
    const sky = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: 0x0d1330 },
        { offset: 0.7, color: 0x3a4f8f },
        { offset: 1, color: 0x8a6aa8 },
      ],
    });
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill(sky);
    for (let i = 0; i < 60; i++) {
      const x = (i * 157) % w;
      const y = (i * 89) % Math.floor(h * 0.55);
      bg.circle(x, y, i % 7 === 0 ? 1.8 : 1).fill({ color: 0xffffff, alpha: 0.35 + (i % 5) * 0.1 });
    }
    bg.ellipse(w * 0.2, h * 1.05, w * 0.45, h * 0.3).fill(0x1d3a2a);
    bg.ellipse(w * 0.8, h * 1.1, w * 0.5, h * 0.33).fill(0x16301f);

    const titleText = new Text({
      text: title,
      style: {
        fontFamily: ctx.theme.fontFamily,
        fontSize: 56,
        fontWeight: 'bold',
        fill: 0xffe7a0,
        stroke: { color: 0x221433, width: 8 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: w - 80,
      },
    });
    titleText.anchor.set(0.5);
    titleText.position.set(w / 2, h * 0.3);
    this.menu = new ChoiceMenu(w, h, ctx.theme);
    this.addChild(bg, titleText, this.menu);
  }
}

/** Écran de fin de partie. */
export class GameOverScreen extends Container {
  constructor(ctx: SceneContext) {
    super();
    const { width: w, height: h } = ctx;
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill(0x000000);
    const title = new Text({
      text: ctx.i18n.t('game.over'),
      style: {
        fontFamily: ctx.theme.fontFamily,
        fontSize: 72,
        fontWeight: 'bold',
        fill: 0xd6403a,
        stroke: { color: 0x2a0000, width: 6 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(w / 2, h * 0.42);
    const hint = new Text({
      text: ctx.i18n.t('rpg.gameOverHint'),
      style: { fontFamily: ctx.theme.fontFamily, fontSize: 18, fill: 0x9a9a9a },
    });
    hint.anchor.set(0.5);
    hint.position.set(w / 2, h * 0.62);
    this.addChild(bg, title, hint);
  }
}

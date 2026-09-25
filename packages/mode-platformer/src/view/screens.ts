import { Container, FillGradient, Graphics, Text } from 'pixi.js';

const TITLE_FONT = '"Courier New", monospace';

function skyBackground(w: number, h: number, top: number, bottom: number): Graphics {
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bottom },
    ],
  });
  const bg = new Graphics();
  bg.rect(0, 0, w, h).fill(gradient);
  return bg;
}

function blinkingHint(width: number, height: number, text: string): Text {
  const hint = new Text({
    text,
    style: { fontFamily: TITLE_FONT, fontSize: 18, fill: 0xffffff, stroke: { color: 0x000000, width: 4 } },
  });
  hint.anchor.set(0.5);
  hint.position.set(width / 2, height * 0.75);
  return hint;
}

/** Écran titre : fond dégradé, titre du jeu et invite à appuyer sur Entrée. */
export class TitleScreen extends Container {
  private readonly hint: Text;
  private time = 0;

  constructor(width: number, height: number, title: string) {
    super();
    const bg = skyBackground(width, height, 0x0d1330, 0x3a6f9f);
    const ground = new Graphics();
    ground.rect(0, height * 0.82, width, height * 0.18).fill(0x2a6b2a);
    const titleText = new Text({
      text: title,
      style: {
        fontFamily: TITLE_FONT,
        fontSize: 44,
        fontWeight: 'bold',
        fill: 0xffe7a0,
        stroke: { color: 0x221433, width: 8 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width - 80,
      },
    });
    titleText.anchor.set(0.5);
    titleText.position.set(width / 2, height * 0.35);
    this.hint = blinkingHint(width, height, 'Appuie sur Entrée');
    this.addChild(bg, ground, titleText, this.hint);
  }

  update(dt: number): void {
    this.time += dt;
    this.hint.alpha = Math.floor(this.time * 2) % 2 === 0 ? 1 : 0.25;
  }
}

/** Bandeau de fin de niveau (affiché pendant la phase `level-complete`). */
export class LevelCompleteBanner extends Container {
  constructor(width: number, height: number, levelName: string) {
    super();
    const panel = new Graphics();
    const panelHeight = 64;
    panel.rect(0, (height - panelHeight) / 2, width, panelHeight).fill({ color: 0x0a0a12, alpha: 0.75 });
    const label = new Text({
      text: levelName ? `Niveau « ${levelName} » terminé !` : 'Niveau terminé !',
      style: { fontFamily: TITLE_FONT, fontSize: 22, fontWeight: 'bold', fill: 0xffd35a },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    this.addChild(panel, label);
  }
}

/** Écran de fin de partie ou de victoire (« Entrée » redémarre). */
export class EndScreen extends Container {
  private readonly hint: Text;
  private time = 0;

  constructor(width: number, height: number, options: { title: string; color: number; hint?: string }) {
    super();
    const bg = new Graphics();
    bg.rect(0, 0, width, height).fill(0x000000);
    const title = new Text({
      text: options.title,
      style: {
        fontFamily: TITLE_FONT,
        fontSize: 56,
        fontWeight: 'bold',
        fill: options.color,
        stroke: { color: 0x000000, width: 6 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(width / 2, height * 0.42);
    this.hint = blinkingHint(width, height, options.hint ?? 'Appuie sur Entrée pour recommencer');
    this.addChild(bg, title, this.hint);
  }

  update(dt: number): void {
    this.time += dt;
    this.hint.alpha = Math.floor(this.time * 2) % 2 === 0 ? 1 : 0.25;
  }
}

/** Voile semi-transparent affiché pendant la pause. */
export class PauseOverlay extends Container {
  constructor(width: number, height: number) {
    super();
    const veil = new Graphics();
    veil.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.55 });
    const label = new Text({
      text: 'Pause',
      style: {
        fontFamily: TITLE_FONT,
        fontSize: 32,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 5 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    this.addChild(veil, label);
  }
}

import type { LogLevel, RuntimeContext } from '@forge/core';
import {
  ChoiceMenu,
  DEFAULT_THEME,
  Fader,
  MessageBox,
  PIXEL_THEME,
  Tweens,
  createStage,
  type Stage,
  type UiTheme,
} from '@forge/render2d';
import { Container, Rectangle } from 'pixi.js';
import { ImageLoader } from './images';
import { PixiPresenter } from './pixi-presenter';
import { QuickMenu, type QuickAction } from './quick-menu';
import { SceneView } from './scene-view';
import { CenteredText, Toast } from './widgets';

export interface ShellCallbacks {
  /** Clic sur la zone de jeu (hors menu rapide et choix). */
  onAdvanceClick(): void;
  onQuickAction(action: QuickAction): void;
  labels: Record<QuickAction, string>;
}

/**
 * Scène PixiJS du mode VN, par couches : décor + personnages, zone de clic, boîte de dialogue,
 * narration centrée, choix, menu rapide, fondu, écrans (titre, sauvegardes…), notifications.
 */
export class VNShell {
  readonly screens = new Container();
  /** Animations de l'interface (écrans), indépendantes des transitions de scène. */
  readonly uiTweens = new Tweens();

  private constructor(
    readonly stage: Stage,
    /** Animations de la scène (accélérées par un clic pendant une transition). */
    readonly tweens: Tweens,
    readonly theme: UiTheme,
    readonly images: ImageLoader,
    readonly presenter: PixiPresenter,
    readonly quickMenu: QuickMenu,
    readonly toast: Toast,
    private readonly fader: Fader,
  ) {}

  static async create(ctx: RuntimeContext, mount: HTMLElement, callbacks: ShellCallbacks): Promise<VNShell> {
    const { manifest } = ctx.bundle;
    const { width, height } = manifest.resolution;
    const stage = await createStage(mount, { width, height, pixelArt: manifest.pixelArt });
    const theme = manifest.pixelArt && width < 800 ? PIXEL_THEME : DEFAULT_THEME;
    const log = (level: LogLevel, message: string) => ctx.log(level, message);
    const images = new ImageLoader(ctx.assets, ctx.bundle.files, manifest.pixelArt, log);

    const barHeight = Math.round(theme.fontSize * 1.3);
    const margin = Math.round(width * 0.03);
    const boxHeight = Math.round(Math.max(theme.lineHeight * 3 + theme.padding * 2, height * 0.24));
    const fader = new Fader(width, height);
    const tweens = new Tweens();
    const scene = new SceneView({ width, height, theme, tweens, fader, images });
    const clickArea = new Container();
    clickArea.hitArea = new Rectangle(0, 0, width, height);
    clickArea.eventMode = 'static';
    clickArea.cursor = 'pointer';
    clickArea.on('pointertap', () => callbacks.onAdvanceClick());
    const messageBox = new MessageBox({
      x: margin,
      y: height - boxHeight - barHeight - Math.round(theme.padding * 0.3),
      width: width - margin * 2,
      height: boxHeight,
      theme,
    });
    const centered = new CenteredText(width, height, theme);
    const menu = new ChoiceMenu(width, height, theme);
    const quickY = height - barHeight + Math.round(barHeight * 0.1);
    const quickMenu = new QuickMenu(width, quickY, theme, callbacks.labels, callbacks.onQuickAction);
    const toast = new Toast(width, theme);
    const presenter = new PixiPresenter({ theme, scene, messageBox, centered, menu });

    const shell = new VNShell(stage, tweens, theme, images, presenter, quickMenu, toast, fader);
    stage.root.addChild(scene, clickArea, messageBox, centered, menu, quickMenu, fader, shell.screens, toast);
    return shell;
  }

  get width(): number {
    return this.stage.width;
  }

  get height(): number {
    return this.stage.height;
  }

  update(dt: number): void {
    this.tweens.update(dt);
    this.uiTweens.update(dt);
    this.fader.update(dt);
    this.presenter.update(dt);
    this.toast.update(dt);
  }

  /** Masque le menu rapide pendant les écrans titre et de fin. */
  setQuickMenuVisible(visible: boolean): void {
    this.quickMenu.visible = visible;
  }

  destroy(): void {
    this.tweens.finishAll();
    this.uiTweens.finishAll();
    this.stage.destroy();
  }
}

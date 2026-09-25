import { Application, Container } from 'pixi.js';

export interface StageOptions {
  /** Résolution logique du jeu (les coordonnées de la scène sont dans cet espace). */
  width: number;
  height: number;
  pixelArt?: boolean;
  background?: number;
}

export interface Stage {
  app: Application;
  /** Conteneur racine dans l'espace logique du jeu. */
  root: Container;
  width: number;
  height: number;
  pixelArt: boolean;
  destroy(): void;
}

/**
 * Crée une application PixiJS dans `mount`, à la résolution logique demandée, mise à l'échelle
 * (letterbox) pour remplir le conteneur en conservant les proportions.
 */
export async function createStage(mount: HTMLElement, options: StageOptions): Promise<Stage> {
  const { width, height } = options;
  const pixelArt = options.pixelArt ?? false;
  const app = new Application();
  await app.init({
    width,
    height,
    background: options.background ?? 0x000000,
    antialias: !pixelArt,
    resolution: pixelArt ? 1 : Math.min(globalThis.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
  });

  const canvas = app.canvas;
  canvas.style.display = 'block';
  canvas.style.outline = 'none';
  canvas.tabIndex = 0;
  if (pixelArt) canvas.style.imageRendering = 'pixelated';

  Object.assign(mount.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: '#000',
  } satisfies Partial<CSSStyleDeclaration>);
  mount.appendChild(canvas);

  const fit = () => {
    const rect = mount.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / width, rect.height / height);
    canvas.style.width = `${Math.floor(width * scale)}px`;
    canvas.style.height = `${Math.floor(height * scale)}px`;
  };
  fit();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  observer?.observe(mount);

  const root = new Container();
  app.stage.addChild(root);

  return {
    app,
    root,
    width,
    height,
    pixelArt,
    destroy() {
      observer?.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

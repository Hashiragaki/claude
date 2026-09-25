import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { fitAspect, parseHexColor } from './math';

export interface View3dOptions {
  /** Champ de vision vertical (degrés). */
  fov?: number;
  near?: number;
  far?: number;
  /** Couleur de fond (`#rrggbb` ou nombre) ; transparent si omis et `alpha` activé. */
  background?: string | number;
  alpha?: boolean;
  /** Ombres portées (activées par défaut). */
  shadows?: boolean;
  /**
   * Proportions à conserver (ex. 16/9) : la vue est centrée avec des bandes noires, comme la
   * scène 2D. Sans valeur, la vue remplit tout le conteneur.
   */
  aspect?: number;
  /** Conserve l'image après le rendu (captures d'écran à tout moment). */
  preserveDrawingBuffer?: boolean;
  /** Densité de pixels maximale (2 par défaut). */
  maxPixelRatio?: number;
}

export interface View3d {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /**
   * Conteneur positionné (`position: relative`) qui épouse exactement le canevas : y placer les
   * surcouches DOM (dialogues, invites…).
   */
  container: HTMLDivElement;
  /** Taille courante en pixels CSS. */
  readonly width: number;
  readonly height: number;
  render(): void;
  /** Recalcule la taille (appelé automatiquement via ResizeObserver). */
  resize(): void;
  /** Abonnement aux redimensionnements ; retourne une fonction de désabonnement. */
  onResize(listener: (width: number, height: number) => void): () => void;
  destroy(): void;
}

/**
 * Crée un rendu WebGL (antialiasing, sortie sRGB, tone mapping ACES, ombres douces) dans `mount`,
 * avec une scène et une caméra perspective. La vue suit la taille du conteneur.
 */
export function createView3d(mount: HTMLElement, options: View3dOptions = {}): View3d {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: options.alpha ?? false,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = options.shadows ?? true;
  // PCF + `shadow.radius` donne des ombres adoucies (PCFSoftShadowMap est retiré de Three.js).
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
  if (options.background !== undefined) renderer.setClearColor(parseHexColor(options.background, 0), 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(options.fov ?? 50, 16 / 9, options.near ?? 0.1, options.far ?? 1000);

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.outline = 'none';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.tabIndex = 0;

  const container = document.createElement('div');
  container.className = 'forge-view3d';
  Object.assign(container.style, {
    position: 'relative',
    overflow: 'hidden',
    flex: '0 0 auto',
    width: '100%',
    height: '100%',
  } satisfies Partial<CSSStyleDeclaration>);
  container.appendChild(canvas);

  const previousMountStyle = mount.getAttribute('style');
  Object.assign(mount.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: '#000',
  } satisfies Partial<CSSStyleDeclaration>);
  if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
  mount.appendChild(container);

  const listeners = new Set<(width: number, height: number) => void>();
  let width = 0;
  let height = 0;
  let destroyed = false;

  const resize = () => {
    if (destroyed) return;
    const rect = mount.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const size = options.aspect ? fitAspect(rect.width, rect.height, options.aspect) : rect;
    const w = Math.max(1, Math.floor(size.width));
    const h = Math.max(1, Math.floor(size.height));
    if (options.aspect) {
      container.style.width = `${w}px`;
      container.style.height = `${h}px`;
    }
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const listener of listeners) listener(w, h);
  };
  resize();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(mount);

  return {
    renderer,
    scene,
    camera,
    canvas,
    container,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    render() {
      if (!destroyed) renderer.render(scene, camera);
    },
    resize,
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      listeners.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      container.remove();
      if (previousMountStyle === null) mount.removeAttribute('style');
      else mount.setAttribute('style', previousMountStyle);
    },
  };
}

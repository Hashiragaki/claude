import type { AssetKind, AssetRegistry } from '@forge/core';
import type { Renderer, Texture } from 'pixi.js';

/**
 * Services de rendu partagés par les vues du plateformer (texture, renderer, dimensions).
 * Équivalent du `SceneContext` de mode-rpg, réduit à ce dont le plateformer a besoin.
 */
export interface PlatformViewContext {
  readonly renderer: Renderer;
  readonly assets: AssetRegistry;
  readonly width: number;
  readonly height: number;
  /** Affiche les boîtes de collision (options.debug). */
  readonly debug: boolean;
  /** Texture d'un asset (pixel-art, nearest) ou `null` avec un avertissement unique. */
  texture(ref: string | undefined, kind: AssetKind): Promise<Texture | null>;
}

import type { AssetRegistry, LogLevel, ProjectFiles } from '@forge/core';
import { tryLoadTexture } from '@forge/render2d';
import type { Texture } from 'pixi.js';
import { builtinImageColor } from '../constants';
import { looksLikePath, resolveImageAsset } from '../refs';

/**
 * Charge les textures des références d'images du script (alias d'asset avec repli Ren'Py, id,
 * ou chemin de fichier). Une image introuvable renvoie `null` et n'est signalée qu'une fois.
 */
export class ImageLoader {
  private readonly cache = new Map<string, Promise<Texture | null>>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly files: ProjectFiles,
    private readonly pixelArt: boolean,
    private readonly log: (level: LogLevel, message: string) => void,
  ) {}

  load(ref: string): Promise<Texture | null> {
    let promise = this.cache.get(ref);
    if (!promise) {
      promise = this.fetch(ref);
      this.cache.set(ref, promise);
    }
    return promise;
  }

  private url(ref: string): string | null {
    const meta = resolveImageAsset(this.assets, ref);
    if (meta) return this.assets.url(meta);
    if (!looksLikePath(ref)) return null;
    try {
      return this.files.url(ref);
    } catch {
      return null;
    }
  }

  private async fetch(ref: string): Promise<Texture | null> {
    const url = this.url(ref);
    const texture = url ? await tryLoadTexture(url, { pixelArt: this.pixelArt }) : null;
    // Les images intégrées (`black`, `white`) sont dessinées par la scène.
    if (!texture && builtinImageColor(ref) === null && !this.warned.has(ref)) {
      this.warned.add(ref);
      this.log('warn', `Image introuvable : « ${ref} » — un substitut est affiché.`);
    }
    return texture;
  }
}

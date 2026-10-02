import type { AssetKind, AssetRegistry, LogLevel } from '@forge/core';
import { tryLoadTexture } from '@forge/render2d';
import type { Texture } from 'pixi.js';

/**
 * Chargeur de textures du mode : résout une référence d'asset (id, alias ou fichier), charge l'image
 * (nearest pour le pixel-art) et met le résultat en cache. Une image absente ou illisible renvoie `null`
 * (le rendu dessine un substitut) et n'est signalée qu'une fois.
 */
export class TextureLoader {
  private readonly cache = new Map<string, Promise<Texture | null>>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly log: (level: LogLevel, message: string) => void,
  ) {}

  load(ref: string | undefined, kind?: AssetKind): Promise<Texture | null> {
    if (!ref) return Promise.resolve(null);
    const key = `${kind ?? '*'}|${ref}`;
    let promise = this.cache.get(key);
    if (!promise) {
      promise = this.fetch(ref, kind);
      this.cache.set(key, promise);
    }
    return promise;
  }

  private async fetch(ref: string, kind?: AssetKind): Promise<Texture | null> {
    const meta = this.assets.resolve(ref, kind) ?? (kind ? this.assets.resolve(ref) : undefined);
    if (!meta) {
      this.warnOnce(ref, `Asset introuvable : « ${ref} » (un substitut est affiché).`);
      return null;
    }
    const pixelArt = meta.kind === 'charset' || meta.info?.pixelArt === true;
    const texture = await tryLoadTexture(this.assets.url(meta), { pixelArt });
    if (!texture) this.warnOnce(ref, `Image illisible : « ${ref} » (un substitut est affiché).`);
    return texture;
  }

  /** Avertit une seule fois par clé. */
  warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log('warn', message);
  }
}

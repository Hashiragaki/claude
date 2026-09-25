import { TILE_SIZE, type TileCollision, type TilesetInfo } from '@forge/core';
import { toColor } from '@forge/render2d';
import { Container, Graphics, Sprite, TilingSprite, type DestroyOptions, type Texture } from 'pixi.js';
import type { LevelGrid } from '../grid';
import type { PlatformerLevel } from '../schema';
import type { PlatformViewContext } from './context';
import { loadTilesetFrames, type TilesetFrames } from './textures';

/**
 * Couche de tuiles avec réutilisation des sprites (pool) et n'affiche que les tuiles dans la plage
 * de cases fournie à {@link sync} : un niveau peut faire jusqu'à 1024×256 cases, hors de question
 * d'y poser un sprite par case en permanence.
 */
class TiledLayer extends Container {
  private readonly active = new Map<number, Sprite>();
  private readonly pool: Sprite[] = [];
  private data: readonly number[] = [];
  private frames: Texture[] = [];
  private mapWidth = 0;
  private mapHeight = 0;

  setSource(data: readonly number[], frames: Texture[], mapWidth: number, mapHeight: number): void {
    for (const sprite of this.active.values()) this.release(sprite);
    this.active.clear();
    this.data = data;
    this.frames = frames;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
  }

  private acquire(): Sprite {
    const reused = this.pool.pop();
    if (reused) {
      reused.visible = true;
      return reused;
    }
    const sprite = new Sprite();
    this.addChild(sprite);
    return sprite;
  }

  private release(sprite: Sprite): void {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  /** Cases visibles (incluses), avec une marge déjà appliquée par l'appelant. */
  sync(tx0: number, ty0: number, tx1: number, ty1: number): void {
    const s = TILE_SIZE;
    const needed = new Set<number>();
    const xStart = Math.max(0, tx0);
    const xEnd = Math.min(this.mapWidth - 1, tx1);
    const yStart = Math.max(0, ty0);
    const yEnd = Math.min(this.mapHeight - 1, ty1);
    for (let ty = yStart; ty <= yEnd; ty++) {
      for (let tx = xStart; tx <= xEnd; tx++) {
        const i = ty * this.mapWidth + tx;
        const tile = this.data[i];
        if (tile === undefined || tile < 0) continue;
        const texture = this.frames[tile];
        if (!texture) continue;
        needed.add(i);
        if (this.active.has(i)) continue;
        const sprite = this.acquire();
        sprite.texture = texture;
        sprite.width = s;
        sprite.height = s;
        sprite.position.set(tx * s, ty * s);
        this.active.set(i, sprite);
      }
    }
    for (const [i, sprite] of this.active) {
      if (needed.has(i)) continue;
      this.active.delete(i);
      this.release(sprite);
    }
  }

  clear(): void {
    for (const sprite of this.active.values()) this.release(sprite);
    this.active.clear();
  }

  override destroy(options?: DestroyOptions): void {
    this.active.clear();
    this.pool.length = 0;
    super.destroy(options);
  }
}

/** Couleurs de survol des boîtes de collision (mode débogage). */
const DEBUG_COLORS: Record<TileCollision, number> = {
  solid: 0xff2a2a,
  oneway: 0xffd23f,
  hazard: 0xff7a1a,
  none: 0x000000,
};

/**
 * Décor et terrain d'un niveau (deux couches de tuiles culées à la caméra) et survol des
 * collisions en mode débogage. Le fond (image ou couleur unie) est géré séparément par le runtime
 * car son défilement parallaxe n'est pas soumis au même zoom/caméra que le monde.
 */
export class LevelView extends Container {
  private readonly decorLayer = new TiledLayer();
  private readonly terrainLayer = new TiledLayer();
  private readonly debugLayer = new Graphics();
  private frames: Texture[] = [];
  private ownedFrames = false;

  constructor(private readonly ctx: PlatformViewContext) {
    super();
    this.addChild(this.decorLayer, this.terrainLayer, this.debugLayer);
  }

  get tileset(): readonly Texture[] {
    return this.frames;
  }

  /** (Re)construit les couches pour `level` (charge/découpe le tileset). */
  async build(level: PlatformerLevel, tileset: TilesetInfo): Promise<void> {
    const loaded: TilesetFrames = await loadTilesetFrames(this.ctx, level.tileset, tileset);
    this.clear();
    this.frames = loaded.frames;
    this.ownedFrames = loaded.placeholder;
    this.decorLayer.setSource(level.layers.decor, this.frames, level.width, level.height);
    this.terrainLayer.setSource(level.layers.terrain, this.frames, level.width, level.height);
  }

  /** Met à jour les tuiles visibles et, en débogage, les boîtes de collision, pour la vue caméra donnée. */
  sync(grid: LevelGrid, viewLeft: number, viewTop: number, viewWidth: number, viewHeight: number): void {
    const margin = 1;
    const tx0 = Math.floor(viewLeft / TILE_SIZE) - margin;
    const ty0 = Math.floor(viewTop / TILE_SIZE) - margin;
    const tx1 = Math.ceil((viewLeft + viewWidth) / TILE_SIZE) + margin;
    const ty1 = Math.ceil((viewTop + viewHeight) / TILE_SIZE) + margin;
    this.decorLayer.sync(tx0, ty0, tx1, ty1);
    this.terrainLayer.sync(tx0, ty0, tx1, ty1);
    this.debugLayer.clear();
    if (!this.ctx.debug) return;
    const s = TILE_SIZE;
    for (let ty = Math.max(0, ty0); ty <= Math.min(grid.height - 1, ty1); ty++) {
      for (let tx = Math.max(0, tx0); tx <= Math.min(grid.width - 1, tx1); tx++) {
        const collision = grid.collisionAt(tx, ty);
        if (collision === 'none') continue;
        this.debugLayer.rect(tx * s, ty * s, s, s).fill({ color: DEBUG_COLORS[collision], alpha: 0.35 });
      }
    }
  }

  clear(): void {
    this.decorLayer.clear();
    this.terrainLayer.clear();
    this.debugLayer.clear();
    if (this.ownedFrames) for (const t of this.frames) t?.destroy(true);
    this.frames = [];
    this.ownedFrames = false;
  }

  override destroy(options?: DestroyOptions): void {
    this.clear();
    super.destroy(options);
  }
}

/**
 * Fond du niveau : image en défilement parallaxe (facteur 0,3 de la caméra) si `level.background`
 * est défini, sinon un aplat de `level.backgroundColor`. Hors du repère caméra/zoom du monde (elle
 * couvre l'écran en permanence) : c'est `runtime.ts` qui pousse le zoom pour garder un rendu net.
 */
export class BackgroundView extends Container {
  private readonly colorLayer = new Graphics();
  private tiling: TilingSprite | null = null;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    super();
    this.addChild(this.colorLayer);
  }

  setColor(hex: string): void {
    this.colorLayer.clear();
    this.colorLayer.rect(0, 0, this.screenWidth, this.screenHeight).fill(toColor(hex, 0x79c5f2));
    this.colorLayer.visible = true;
    if (this.tiling) this.tiling.visible = false;
  }

  setImage(texture: Texture, zoom: number): void {
    this.colorLayer.visible = false;
    if (!this.tiling) {
      this.tiling = new TilingSprite({ texture, width: this.screenWidth, height: this.screenHeight });
      this.addChild(this.tiling);
    } else {
      this.tiling.texture = texture;
    }
    this.tiling.tileScale.set(zoom);
    this.tiling.visible = true;
  }

  /** Défilement parallaxe : le fond bouge à 0,3× la vitesse de la caméra. */
  scroll(cameraLeft: number, cameraTop: number, zoom: number): void {
    if (!this.tiling?.visible) return;
    this.tiling.tilePosition.set(-Math.round(cameraLeft * 0.3 * zoom), -Math.round(cameraTop * 0.3 * zoom));
  }

  override destroy(options?: DestroyOptions): void {
    this.tiling?.destroy();
    this.tiling = null;
    super.destroy(options);
  }
}

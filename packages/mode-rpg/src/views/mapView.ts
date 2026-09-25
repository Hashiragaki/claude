import { TILE_SIZE } from '@forge/core';
import { Container, Graphics, Sprite, Texture, type DestroyOptions } from 'pixi.js';
import { DIRECTION_ROW, type Character, type EventCharacter } from '../character';
import type { Direction, LayerName, RpgMap } from '../schema';
import type { RpgWorld } from '../world';
import type { SceneContext } from './context';
import { loadCharsetFrames, loadTilesetFrames, type CharsetFrames } from './textures';
import { colorFromText } from './ui';

const S = TILE_SIZE;

/** Silhouette de remplacement (charset manquant), dessinée au-dessus du point d'ancrage. */
function placeholderCharacter(ref: string): Graphics {
  const g = new Graphics();
  g.ellipse(0, -1, 6, 2).fill({ color: 0x000000, alpha: 0.3 });
  g.roundRect(-5, -15, 10, 12, 3).fill(colorFromText(ref));
  g.circle(0, -18, 4.5).fill(0xf1c7a3);
  return g;
}

/** Personnage affiché : charset animé, tuile du tileset, ou silhouette de remplacement. */
class CharacterSprite extends Container {
  /** Identité de l'apparence affichée (`c:ref`, `t:index` ou vide). */
  key: string | null = null;
  private readonly sprite = new Sprite(Texture.EMPTY);
  private placeholder: Graphics | null = null;
  private frames: CharsetFrames | null = null;

  constructor() {
    super();
    this.sprite.anchor.set(0.5, 1);
    this.addChild(this.sprite);
  }

  setCharset(frames: CharsetFrames | null, ref: string): void {
    this.reset();
    this.frames = frames;
    if (frames) {
      // Charset haute résolution : ramené à la grille de 16 px.
      this.sprite.scale.set(frames.frameWidth > S * 1.5 ? S / frames.frameWidth : 1);
      this.sprite.visible = true;
    } else {
      this.placeholder = placeholderCharacter(ref);
      this.addChild(this.placeholder);
    }
  }

  setTile(texture: Texture | undefined): void {
    this.reset();
    this.sprite.texture = texture ?? Texture.EMPTY;
    this.sprite.width = S;
    this.sprite.height = S;
    this.sprite.visible = texture !== undefined;
  }

  setNone(): void {
    this.reset();
  }

  syncFrame(direction: Direction, column: number): void {
    if (this.frames) this.sprite.texture = this.frames.rows[DIRECTION_ROW[direction]]?.[column] ?? Texture.EMPTY;
    if (this.placeholder) this.placeholder.y = column === 1 ? 0 : -1;
  }

  private reset(): void {
    this.frames = null;
    this.placeholder?.destroy();
    this.placeholder = null;
    this.sprite.visible = false;
    this.sprite.scale.set(1);
  }
}

/**
 * Carte affichée : couches de tuiles statiques (sol + décor sous les personnages, couche haute
 * au-dessus), personnages triés en profondeur et caméra qui suit le joueur.
 */
export class MapView extends Container {
  private readonly layers: Record<LayerName, Container> = {
    ground: new Container(),
    decor: new Container(),
    overhead: new Container(),
  };
  private readonly actors = new Container();
  private readonly debugLayer = new Graphics();
  private readonly playerSprite = new CharacterSprite();
  private readonly eventSprites = new Map<EventCharacter, CharacterSprite>();
  private readonly charsets = new Map<string, Promise<CharsetFrames | null>>();
  private tiles: Texture[] = [];
  private ownedTiles = false;
  private world: RpgWorld | null = null;
  private zoom = 3;
  /** Version de carte affichée (`world.mapVersion`). */
  version = -1;

  constructor(private readonly ctx: SceneContext) {
    super();
    this.actors.sortableChildren = true;
    this.addChild(this.layers.ground, this.layers.decor, this.actors, this.layers.overhead, this.debugLayer);
  }

  /** Reconstruit l'affichage pour la carte courante du monde. */
  async build(world: RpgWorld): Promise<void> {
    const version = world.mapVersion;
    const map = world.map;
    const tileset = await loadTilesetFrames(this.ctx, map.tileset, world.tileset);
    const leaderRef = this.leaderCharset(world);
    const leader = leaderRef ? await this.charset(leaderRef) : null;
    this.clear();
    this.world = world;
    this.tiles = tileset.frames;
    this.ownedTiles = tileset.placeholder;
    this.zoom = world.system.zoom;
    this.scale.set(this.zoom);
    for (const layer of ['ground', 'decor', 'overhead'] as const) this.fillLayer(this.layers[layer], map, layer);
    if (this.ctx.debug) this.drawCollisions(world);
    this.playerSprite.setCharset(leader, leaderRef ?? 'joueur');
    this.playerSprite.key = null;
    this.actors.addChild(this.playerSprite);
    for (const ev of world.characters) {
      const sprite = new CharacterSprite();
      this.eventSprites.set(ev, sprite);
      this.actors.addChild(sprite);
    }
    await Promise.all(world.characters.map((ev) => this.applyGraphic(ev)));
    this.version = version;
    this.sync(world);
  }

  private leaderCharset(world: RpgWorld): string | undefined {
    const leader = world.state.party[0];
    return leader ? world.database.actors.find((a) => a.id === leader.id)?.charset : undefined;
  }

  private charset(ref: string): Promise<CharsetFrames | null> {
    let promise = this.charsets.get(ref);
    if (!promise) {
      promise = loadCharsetFrames(this.ctx, ref);
      this.charsets.set(ref, promise);
    }
    return promise;
  }

  private fillLayer(target: Container, map: RpgMap, layer: LayerName): void {
    const data = map.layers[layer];
    for (let i = 0; i < data.length; i++) {
      const tile = data[i];
      if (tile === undefined || tile < 0) continue;
      const texture = this.tiles[tile];
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.position.set((i % map.width) * S, Math.floor(i / map.width) * S);
      sprite.width = S;
      sprite.height = S;
      target.addChild(sprite);
    }
  }

  /** Débogage : cases infranchissables en rouge. */
  private drawCollisions(world: RpgWorld): void {
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        if (world.isTilePassable(x, y)) continue;
        this.debugLayer.rect(x * S, y * S, S, S).fill({ color: 0xff0000, alpha: 0.28 });
      }
    }
  }

  private graphicKey(ev: EventCharacter): string {
    const graphic = ev.visible ? ev.page?.graphic : null;
    if (!graphic) return '';
    return 'charset' in graphic ? `c:${graphic.charset}` : `t:${graphic.tile}`;
  }

  private async applyGraphic(ev: EventCharacter): Promise<void> {
    const sprite = this.eventSprites.get(ev);
    if (!sprite) return;
    const key = this.graphicKey(ev);
    if (sprite.key === key) return;
    sprite.key = key;
    const graphic = ev.page?.graphic;
    if (!key || !graphic) {
      sprite.setNone();
    } else if ('tile' in graphic) {
      sprite.setTile(this.tiles[graphic.tile]);
    } else {
      const frames = await this.charset(graphic.charset);
      if (sprite.key === key && !sprite.destroyed) sprite.setCharset(frames, graphic.charset);
    }
  }

  /** Vrai si la vue affiche la carte courante de ce monde. */
  shows(world: RpgWorld): boolean {
    return this.world === world && this.version === world.mapVersion;
  }

  /** Met à jour positions, animations, apparences et caméra. */
  sync(world: RpgWorld): void {
    if (world !== this.world) return;
    this.syncCharacter(this.playerSprite, world.player, 0);
    for (const [ev, sprite] of this.eventSprites) {
      if (this.graphicKey(ev) !== sprite.key) void this.applyGraphic(ev);
      sprite.visible = ev.visible;
      const priority = ev.page?.priority ?? 'same';
      this.syncCharacter(sprite, ev, priority === 'below' ? -100_000 : priority === 'above' ? 100_000 : 0);
    }
    this.updateCamera(world);
  }

  private syncCharacter(sprite: CharacterSprite, char: Character, zOffset: number): void {
    const snap = (v: number) => Math.round(v * this.zoom) / this.zoom;
    sprite.position.set(snap(char.realX * S + S / 2), snap(char.realY * S + S));
    sprite.zIndex = zOffset + sprite.y;
    sprite.syncFrame(char.direction, char.frameColumn);
  }

  private updateCamera(world: RpgWorld): void {
    const viewW = this.ctx.width / this.zoom;
    const viewH = this.ctx.height / this.zoom;
    const mapW = world.map.width * S;
    const mapH = world.map.height * S;
    const px = world.player.realX * S + S / 2;
    const py = world.player.realY * S + S / 2;
    const camX = mapW <= viewW ? (mapW - viewW) / 2 : Math.max(0, Math.min(mapW - viewW, px - viewW / 2));
    const camY = mapH <= viewH ? (mapH - viewH) / 2 : Math.max(0, Math.min(mapH - viewH, py - viewH / 2));
    this.position.set(Math.round(-camX * this.zoom), Math.round(-camY * this.zoom));
  }

  /** Vide l'affichage (les textures de remplacement générées sont libérées). */
  clear(): void {
    for (const layer of Object.values(this.layers)) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    this.debugLayer.clear();
    this.actors.removeChild(this.playerSprite);
    for (const sprite of this.eventSprites.values()) sprite.destroy({ children: true });
    this.eventSprites.clear();
    if (this.ownedTiles) for (const t of this.tiles) t?.destroy(true);
    this.tiles = [];
    this.ownedTiles = false;
    this.world = null;
    this.version = -1;
  }

  override destroy(options?: DestroyOptions): void {
    this.clear();
    this.playerSprite.destroy({ children: true });
    super.destroy(options);
  }
}

import { TILE_ROLES, TILE_SIZE, type TilesetInfo } from '@forge/core';
import { sliceGrid } from '@forge/render2d';
import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { SceneContext } from './context';

/** Couleurs des tuiles de remplacement (tileset manquant), par rôle. */
const ROLE_COLORS: Record<string, number> = {
  ground: 0x5fa845,
  ground_alt: 0x57a03f,
  ground_detail: 0x3c7f33,
  path: 0xc9a86b,
  path_alt: 0xbe9d5f,
  water: 0x3d7fd1,
  deep_water: 0x2a5ea8,
  bridge: 0x9b6b3a,
  wall_top: 0x5d5d6d,
  wall: 0x8a8a9a,
  wall_window: 0x9ab8d8,
  door: 0x6b4423,
  roof: 0xb5483a,
  roof_edge: 0x8f3529,
  stairs: 0x9a9a9a,
  fence: 0xa07a4a,
  tree_top: 0x2f7a2f,
  tree_trunk: 0x6b4a2a,
  bush: 0x3a8a3a,
  rock: 0x8a8a8a,
  flowers: 0xe86aa0,
  log: 0x7a5230,
  sign: 0xb08850,
  crate: 0xa87a44,
  table: 0x9a6a3a,
  chair: 0x8a5a2a,
  bed: 0xd05060,
  shelf: 0x7a5a3a,
  barrel: 0x8a5a30,
  torch: 0xffb040,
  rug: 0xa03a3a,
  void: 0x101014,
};

export interface TilesetFrames {
  /** Index de tuile → texture. */
  frames: Texture[];
  placeholder: boolean;
}

/** Dessine une tuile de remplacement (sol plein, décor en médaillon, feuillage en disque). */
function drawPlaceholderTile(g: Graphics, roleId: string, layer: string): void {
  const color = ROLE_COLORS[roleId] ?? 0xff00ff;
  const s = TILE_SIZE;
  if (layer === 'overhead') {
    g.circle(s / 2, s / 2, s / 2).fill(color);
  } else if (layer === 'decor') {
    g.roundRect(2, 2, s - 4, s - 4, 2)
      .fill(color)
      .stroke({ width: 1, color: 0, alpha: 0.35 });
  } else {
    g.rect(0, 0, s, s).fill(color);
  }
}

/** Textures de remplacement pour un tileset introuvable. */
export function placeholderTiles(renderer: Renderer, info: TilesetInfo): Texture[] {
  const frames: Texture[] = [];
  for (const role of info.tiles.length ? info.tiles : TILE_ROLES) {
    const holder = new Container();
    const g = new Graphics();
    g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill({ color: 0x000000, alpha: 0 });
    drawPlaceholderTile(g, role.id, role.layer);
    holder.addChild(g);
    frames[role.index] = renderer.generateTexture({
      target: holder,
      frame: new Rectangle(0, 0, TILE_SIZE, TILE_SIZE),
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    holder.destroy({ children: true });
  }
  return frames;
}

/** Découpe le tileset en tuiles (ou crée des tuiles de remplacement). */
export async function loadTilesetFrames(ctx: SceneContext, ref: string, info: TilesetInfo): Promise<TilesetFrames> {
  const texture = await ctx.texture(ref, 'tileset', true);
  if (texture) {
    const size = info.tileSize || TILE_SIZE;
    return { frames: sliceGrid(texture, size, size).flat(), placeholder: false };
  }
  return { frames: placeholderTiles(ctx.renderer, info), placeholder: true };
}

export interface CharsetFrames {
  /** `rows[ligne][colonne]` : lignes bas, gauche, droite, haut ; colonnes pas A, repos, pas B. */
  rows: Texture[][];
  frameWidth: number;
  frameHeight: number;
}

/** Charge un charset (3 × 4 frames, taille lue dans `info.frameWidth/frameHeight` si présente). */
export async function loadCharsetFrames(ctx: SceneContext, ref: string): Promise<CharsetFrames | null> {
  const texture = await ctx.texture(ref, 'charset', true);
  if (!texture) return null;
  const info = ctx.session.ctx.assets.resolve(ref, 'charset')?.info ?? {};
  const fw = typeof info.frameWidth === 'number' && info.frameWidth > 0 ? info.frameWidth : texture.width / 3;
  const fh = typeof info.frameHeight === 'number' && info.frameHeight > 0 ? info.frameHeight : texture.height / 4;
  const rows = sliceGrid(texture, fw, fh);
  if (rows.length < 4 || (rows[0]?.length ?? 0) < 3) return null;
  return { rows, frameWidth: fw, frameHeight: fh };
}

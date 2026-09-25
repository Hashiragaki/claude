import {
  PLATFORM_TILE_ROLES,
  PLATFORM_TILESET_COLUMNS,
  TILE_SIZE,
  type AssetRegistry,
  type Diagnostic,
  type ProjectFiles,
  type TileCollision,
  type TilesetInfo,
} from '@forge/core';
import { sliceGrid } from '@forge/render2d';
import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { PlatformViewContext } from './context';

/**
 * Chargement et découpe des tilesets « vue de côté » et des charsets (joueur, ennemis) du
 * plateformer. Contrepartie visuelle de `PLATFORM_TILE_ROLES` (`@forge/core`) : ce module ne
 * connaît que la disposition (taille, colonnes), jamais les règles de jeu.
 */

/** Disposition standard (celle de `PLATFORM_TILE_ROLES`) si le tileset n'a pas de métadonnées. */
export const DEFAULT_PLATFORM_TILESET_INFO: TilesetInfo = {
  tileSize: TILE_SIZE,
  columns: PLATFORM_TILESET_COLUMNS,
  theme: 'default',
  layout: 'side',
  tiles: [...PLATFORM_TILE_ROLES],
};

/** Normalise des métadonnées de tileset lues depuis `extra.tiles` (repli sur la disposition standard). */
export function normalizePlatformTilesetInfo(data: unknown): TilesetInfo {
  if (!data || typeof data !== 'object') return DEFAULT_PLATFORM_TILESET_INFO;
  const raw = data as Partial<TilesetInfo>;
  const tiles = Array.isArray(raw.tiles) && raw.tiles.length > 0 ? raw.tiles : DEFAULT_PLATFORM_TILESET_INFO.tiles;
  const collisions: readonly TileCollision[] = ['solid', 'oneway', 'hazard', 'none'];
  return {
    tileSize: typeof raw.tileSize === 'number' && raw.tileSize > 0 ? raw.tileSize : TILE_SIZE,
    columns: typeof raw.columns === 'number' && raw.columns > 0 ? raw.columns : PLATFORM_TILESET_COLUMNS,
    theme: typeof raw.theme === 'string' ? raw.theme : 'default',
    layout: 'side',
    tiles: tiles.map((t, i) => ({
      index: typeof t.index === 'number' ? t.index : i,
      id: String(t.id ?? PLATFORM_TILE_ROLES[i]?.id ?? `tile_${i}`),
      name: String(t.name ?? t.id ?? ''),
      passable: t.passable !== false,
      layer: t.layer === 'decor' || t.layer === 'overhead' ? t.layer : 'ground',
      collision: collisions.includes(t.collision as TileCollision)
        ? (t.collision as TileCollision)
        : (PLATFORM_TILE_ROLES[i]?.collision ?? 'none'),
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Métadonnées d'un tileset (`extra.tiles` de l'asset), disposition standard par défaut.
 * Utilisé par `../view/loader.ts` (chargement du projet pour le rendu).
 */
export async function loadPlatformTilesetInfo(
  files: ProjectFiles,
  ref: string,
  assets: AssetRegistry | undefined,
  problems: Diagnostic[] = [],
): Promise<TilesetInfo> {
  const meta = assets?.resolve(ref, 'tileset');
  const tilesPath = meta?.extra.tiles;
  if (!tilesPath) return DEFAULT_PLATFORM_TILESET_INFO;
  try {
    return normalizePlatformTilesetInfo(await files.readJson(tilesPath));
  } catch (error) {
    problems.push({
      file: tilesPath,
      severity: 'warning',
      message:
        `Métadonnées du tileset « ${ref} » illisibles (disposition standard utilisée) : ` + errorMessage(error),
    });
    return DEFAULT_PLATFORM_TILESET_INFO;
  }
}

/** Couleur de remplacement par collision (tileset introuvable). */
const COLLISION_COLORS: Record<TileCollision, number> = {
  solid: 0x6b4a2a,
  oneway: 0xb08850,
  hazard: 0xd6403a,
  none: 0x3a8a3a,
};

function drawPlaceholderTile(g: Graphics, size: number, collision: TileCollision, layer: string): void {
  const color = COLLISION_COLORS[collision];
  if (layer === 'decor' && collision === 'none') {
    g.circle(size / 2, size / 2, size / 2 - 2).fill({ color, alpha: 0.85 });
  } else if (collision === 'oneway') {
    g.rect(0, 2, size, size - 4).fill(color);
  } else {
    g.rect(0, 0, size, size).fill(color);
  }
}

/** Textures de remplacement pour un tileset introuvable (une par rôle, colorée selon la collision). */
export function placeholderPlatformTiles(renderer: Renderer, info: TilesetInfo): Texture[] {
  const frames: Texture[] = [];
  const size = info.tileSize || TILE_SIZE;
  const roles = info.tiles.length ? info.tiles : PLATFORM_TILE_ROLES;
  for (const role of roles) {
    const holder = new Container();
    const g = new Graphics();
    g.rect(0, 0, size, size).fill({ color: 0x000000, alpha: 0 });
    drawPlaceholderTile(g, size, role.collision ?? 'none', role.layer);
    holder.addChild(g);
    frames[role.index] = renderer.generateTexture({
      target: holder,
      frame: new Rectangle(0, 0, size, size),
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    holder.destroy({ children: true });
  }
  return frames;
}

export interface TilesetFrames {
  /** Index de tuile → texture. */
  frames: Texture[];
  /** Vrai si ce sont des textures de remplacement générées (à libérer explicitement). */
  placeholder: boolean;
}

/** Découpe le tileset en tuiles (ou crée des tuiles de remplacement). */
export async function loadTilesetFrames(
  ctx: PlatformViewContext,
  ref: string,
  info: TilesetInfo,
): Promise<TilesetFrames> {
  const texture = await ctx.texture(ref, 'tileset');
  if (texture) {
    const size = info.tileSize || TILE_SIZE;
    return { frames: sliceGrid(texture, size, size).flat(), placeholder: false };
  }
  return { frames: placeholderPlatformTiles(ctx.renderer, info), placeholder: true };
}

export interface CharsetFrames {
  /** `rows[ligne][colonne]` (disposition charset Forge : 3 colonnes × 4 lignes de 16×24). */
  rows: Texture[][];
  frameWidth: number;
  frameHeight: number;
}

/** Charge un charset (joueur ou ennemi) : 3 colonnes × 4 lignes, taille lue dans `info` si présente. */
export async function loadCharsetFrames(ctx: PlatformViewContext, ref: string): Promise<CharsetFrames | null> {
  const texture = await ctx.texture(ref, 'charset');
  if (!texture) return null;
  const info = ctx.assets.resolve(ref, 'charset')?.info ?? {};
  const fw = typeof info.frameWidth === 'number' && info.frameWidth > 0 ? info.frameWidth : texture.width / 3;
  const fh = typeof info.frameHeight === 'number' && info.frameHeight > 0 ? info.frameHeight : texture.height / 4;
  const rows = sliceGrid(texture, fw, fh);
  if (rows.length < 2 || (rows[0]?.length ?? 0) < 3) return null;
  return { rows, frameWidth: fw, frameHeight: fh };
}

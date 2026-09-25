import { TILE_ROLES, TILESET_COLUMNS, TILE_SIZE } from '@forge/core';
import { PixelCanvas } from '../canvas';
import { drawGrid, type PixelGrid } from '../grid';
import { drawBed, drawChair, drawBarrel, drawRug, drawShelf, drawTable, drawTorch } from './furniture';
import { drawGround, drawPath, drawVoid, drawWater } from './ground';
import { drawBush, drawCrate, drawFlowers, drawLog, drawRock, drawSign, drawTreeTop, drawTreeTrunk } from './nature';
import type { TilesetPalette, TilesetTheme } from './palettes';
import {
  drawBridge,
  drawDoor,
  drawFence,
  drawRoof,
  drawRoofEdge,
  drawStairs,
  drawWall,
  drawWallTop,
  drawWallWindow,
} from './structures';
import { Tile } from './tile';

type TileDrawer = (t: Tile) => void;

/** Dessin procédural de chaque rôle standard (voir `TILE_ROLES` dans @forge/core). */
export const ROLE_DRAWERS: Record<string, TileDrawer> = {
  ground: (t) => drawGround(t, 0),
  ground_alt: (t) => drawGround(t, 1),
  ground_detail: (t) => drawGround(t, 2),
  path: (t) => drawPath(t, false),
  path_alt: (t) => drawPath(t, true),
  water: (t) => drawWater(t, false),
  deep_water: (t) => drawWater(t, true),
  bridge: drawBridge,
  wall_top: drawWallTop,
  wall: drawWall,
  wall_window: drawWallWindow,
  door: drawDoor,
  roof: drawRoof,
  roof_edge: drawRoofEdge,
  stairs: drawStairs,
  fence: drawFence,
  tree_top: drawTreeTop,
  tree_trunk: drawTreeTrunk,
  bush: drawBush,
  rock: drawRock,
  flowers: drawFlowers,
  log: drawLog,
  sign: drawSign,
  crate: drawCrate,
  table: drawTable,
  chair: drawChair,
  bed: drawBed,
  shelf: drawShelf,
  barrel: drawBarrel,
  torch: drawTorch,
  rug: drawRug,
  void: drawVoid,
};

/** Dessine une tuile isolée (16 × 16). */
export function drawTile(role: string, theme: TilesetTheme, palette: TilesetPalette): PixelCanvas {
  const tile = new Tile(palette, theme, role);
  const draw = ROLE_DRAWERS[role];
  if (!draw) throw new Error(`Rôle de tuile inconnu : ${role}`);
  draw(tile);
  return tile;
}

/** Assemble le tileset complet (8 colonnes × 4 lignes de 16 px) ; les tuiles dessinées à la main priment. */
export function drawTileset(
  theme: TilesetTheme,
  palette: TilesetPalette,
  customTiles: Partial<Record<string, PixelGrid>> = {},
): PixelCanvas {
  const rows = Math.ceil(TILE_ROLES.length / TILESET_COLUMNS);
  const sheet = new PixelCanvas(TILESET_COLUMNS * TILE_SIZE, rows * TILE_SIZE);
  for (const role of TILE_ROLES) {
    const x = (role.index % TILESET_COLUMNS) * TILE_SIZE;
    const y = Math.floor(role.index / TILESET_COLUMNS) * TILE_SIZE;
    const custom = customTiles[role.id];
    if (custom) drawGrid(sheet, custom, x, y);
    else sheet.draw(drawTile(role.id, theme, palette), x, y);
  }
  return sheet;
}

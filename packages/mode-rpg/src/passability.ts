import { TILE_ROLES, TILE_SIZE, TILESET_COLUMNS, type TileRole, type TilesetInfo } from '@forge/core';
import { COLLISION_BLOCK, COLLISION_PASS, type LayerName, type RpgMap } from './schema';

/** Tileset par défaut (disposition standard Forge) utilisé si les métadonnées sont absentes. */
export const DEFAULT_TILESET_INFO: TilesetInfo = {
  tileSize: TILE_SIZE,
  columns: TILESET_COLUMNS,
  theme: 'default',
  tiles: [...TILE_ROLES],
};

/** Normalise des métadonnées de tileset lues depuis un fichier (repli sur la disposition standard). */
export function normalizeTilesetInfo(data: unknown): TilesetInfo {
  if (!data || typeof data !== 'object') return DEFAULT_TILESET_INFO;
  const raw = data as Partial<TilesetInfo>;
  const tiles = Array.isArray(raw.tiles) && raw.tiles.length > 0 ? raw.tiles : DEFAULT_TILESET_INFO.tiles;
  return {
    tileSize: typeof raw.tileSize === 'number' && raw.tileSize > 0 ? raw.tileSize : TILE_SIZE,
    columns: typeof raw.columns === 'number' && raw.columns > 0 ? raw.columns : TILESET_COLUMNS,
    theme: typeof raw.theme === 'string' ? raw.theme : 'default',
    tiles: tiles.map((t, i) => ({
      index: typeof t.index === 'number' ? t.index : i,
      id: String(t.id ?? TILE_ROLES[i]?.id ?? `tile_${i}`),
      name: String(t.name ?? t.id ?? ''),
      passable: t.passable !== false,
      layer: t.layer === 'decor' || t.layer === 'overhead' ? t.layer : 'ground',
    })),
  };
}

/** Table index → rôle d'un tileset. */
export function roleTable(info: TilesetInfo): Map<number, TileRole> {
  return new Map(info.tiles.map((t) => [t.index, t]));
}

export function inBounds(map: Pick<RpgMap, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Tuile d'une couche (`-1` si vide ou hors carte). */
export function tileAt(map: RpgMap, layer: LayerName, x: number, y: number): number {
  if (!inBounds(map, x, y)) return -1;
  return map.layers[layer][y * map.width + x] ?? -1;
}

/**
 * Passabilité d'une case selon les tuiles : bloquée si une tuile non vide des couches `ground` ou
 * `decor` est infranchissable (la couche `overhead` ne bloque jamais), sauf surcharge de collision
 * (1 = bloqué, 2 = passage forcé). Les tuiles d'index inconnu sont franchissables.
 */
export function isCellPassable(map: RpgMap, roles: Map<number, TileRole>, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  const override = map.collision?.[y * map.width + x] ?? 0;
  if (override === COLLISION_BLOCK) return false;
  if (override === COLLISION_PASS) return true;
  for (const layer of ['ground', 'decor'] as const) {
    const tile = tileAt(map, layer, x, y);
    if (tile >= 0 && roles.get(tile)?.passable === false) return false;
  }
  return true;
}

/** Vrai si une tuile de rôle `roleId` est posée sur la case (couches `ground` ou `decor`). */
export function cellHasRole(map: RpgMap, roles: Map<number, TileRole>, x: number, y: number, roleId: string): boolean {
  for (const layer of ['ground', 'decor'] as const) {
    const tile = tileAt(map, layer, x, y);
    if (tile >= 0 && roles.get(tile)?.id === roleId) return true;
  }
  return false;
}

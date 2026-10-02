import { TILE, TILE_SIZE } from '@forge/core';

/** Bits du masque de voisinage à 8 cases. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
export const NE = 16;
export const SE = 32;
export const SW = 64;
export const NW = 128;

/** Rayon (en pixels) des coins arrondis. */
const CORNER_RADIUS = 4;
/** Épaisseur du sable puis de l'écume (en pixels, mesurée depuis la case voisine). */
const SAND = 2;
const FOAM = 3;

export type ShoreKind = 'sand' | 'foam' | 'blend';

export interface ShoreRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ShoreKind;
}

/** Vrai si l'indice de tuile de sol est de l'eau (peu profonde ou profonde). */
export function isWaterTile(tile: number | undefined): boolean {
  return tile === TILE.water || tile === TILE.deep_water;
}

/**
 * Masque 8 voisins d'une case : un bit est levé quand la case voisine vérifie `test`.
 * Hors carte, `test` n'est pas appelé et le bit reste à 0 (pas de rive au bord de la carte).
 */
export function neighborMask(
  width: number,
  height: number,
  x: number,
  y: number,
  test: (nx: number, ny: number) => boolean,
): number {
  const dirs: [number, number, number][] = [
    [0, -1, N],
    [1, 0, E],
    [0, 1, S],
    [-1, 0, W],
    [1, -1, NE],
    [1, 1, SE],
    [-1, 1, SW],
    [-1, -1, NW],
  ];
  let mask = 0;
  for (const [dx, dy, bit] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (test(nx, ny)) mask |= bit;
  }
  return mask;
}

/**
 * Distance (en pixels) du centre du pixel `(px, py)` de la case au plus proche voisin marqué dans `mask`,
 * avec des coins extérieurs arrondis (deux côtés adjacents) et des coins intérieurs arrondis (diagonale seule).
 * Infinity si le masque est vide.
 */
export function edgeDistance(mask: number, px: number, py: number): number {
  const size = TILE_SIZE;
  const dN = py + 0.5;
  const dS = size - py - 0.5;
  const dW = px + 0.5;
  const dE = size - px - 0.5;
  let d = Infinity;
  if (mask & N) d = Math.min(d, dN);
  if (mask & S) d = Math.min(d, dS);
  if (mask & W) d = Math.min(d, dW);
  if (mask & E) d = Math.min(d, dE);
  const corners: [number, number, number, number][] = [
    [N | W, dN, dW, NW],
    [N | E, dN, dE, NE],
    [S | W, dS, dW, SW],
    [S | E, dS, dE, SE],
  ];
  for (const [both, dy, dx, diag] of corners) {
    if ((mask & both) === both) {
      if (dx < CORNER_RADIUS && dy < CORNER_RADIUS) {
        d = Math.min(d, CORNER_RADIUS - Math.hypot(CORNER_RADIUS - dx, CORNER_RADIUS - dy));
      }
    } else if (mask & diag && !(mask & both)) {
      d = Math.min(d, Math.hypot(dx, dy));
    }
  }
  return d;
}

/** Rive d'un pixel de case d'eau : sable collé à la terre, puis liseré d'écume. */
export function shoreKindAt(landMask: number, px: number, py: number): 'sand' | 'foam' | null {
  const d = edgeDistance(landMask, px, py);
  if (d < SAND) return 'sand';
  if (d < FOAM) return 'foam';
  return null;
}

/** Transition eau / eau profonde (côté profond) : bande éclaircie puis tramage en damier. */
export function blendKindAt(shallowMask: number, px: number, py: number): 'blend' | null {
  const d = edgeDistance(shallowMask, px, py);
  if (d < 1) return 'blend';
  if (d < 3 && (px + py) % 2 === 0) return 'blend';
  return null;
}

/** Rectangles (en pixels de case) d'une case d'eau, pixels consécutifs de même nature fusionnés par ligne. */
export function cellRects(landMask: number, shallowMask: number, deep: boolean): ShoreRect[] {
  const rects: ShoreRect[] = [];
  if (landMask === 0 && (!deep || shallowMask === 0)) return rects;
  for (let py = 0; py < TILE_SIZE; py++) {
    let start = 0;
    let kind: ShoreKind | null = null;
    for (let px = 0; px <= TILE_SIZE; px++) {
      const k =
        px === TILE_SIZE ? null : (shoreKindAt(landMask, px, py) ?? (deep ? blendKindAt(shallowMask, px, py) : null));
      if (k === kind) continue;
      if (kind) rects.push({ x: start, y: py, w: px - start, h: 1, kind });
      start = px;
      kind = k;
    }
  }
  return rects;
}

/** Calcule tous les rectangles de rive d'une couche de sol (coordonnées en pixels de carte). */
export function buildShore(width: number, height: number, ground: readonly number[]): ShoreRect[] {
  const out: ShoreRect[] = [];
  const tileAt = (x: number, y: number): number | undefined => ground[y * width + x];
  const isLand = (x: number, y: number): boolean => {
    const t = tileAt(x, y);
    return t !== undefined && t >= 0 && !isWaterTile(t);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tileAt(x, y);
      if (!isWaterTile(tile)) continue;
      const deep = tile === TILE.deep_water;
      const land = neighborMask(width, height, x, y, isLand);
      const shallow = deep ? neighborMask(width, height, x, y, (nx, ny) => tileAt(nx, ny) === TILE.water) : 0;
      for (const r of cellRects(land, shallow, deep)) {
        out.push({ ...r, x: x * TILE_SIZE + r.x, y: y * TILE_SIZE + r.y });
      }
    }
  }
  return out;
}

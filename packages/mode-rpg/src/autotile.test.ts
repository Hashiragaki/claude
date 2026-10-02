import { TILE, TILE_SIZE } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { N, NE, NW, S, SW, W, blendKindAt, buildShore, cellRects, neighborMask, shoreKindAt } from './autotile';

describe('autotile (rives)', () => {
  it('calcule le masque 8 voisins et ignore le hors-carte', () => {
    const mask = neighborMask(3, 3, 0, 0, () => true);
    expect(mask & (N | W | NE | NW)).toBe(0);
    expect(neighborMask(3, 3, 1, 1, (x, y) => x === 1 && y === 0)).toBe(N);
  });

  it("dessine du sable puis de l'écume côté terre, rien ailleurs", () => {
    expect(shoreKindAt(N, 8, 0)).toBe('sand');
    expect(shoreKindAt(N, 8, 2)).toBe('foam');
    expect(shoreKindAt(N, 8, 8)).toBeNull();
    expect(shoreKindAt(0, 0, 0)).toBeNull();
  });

  it('arrondit le coin extérieur (coin en sable, centre épargné)', () => {
    expect(shoreKindAt(N | W, 0, 0)).toBe('sand');
    expect(shoreKindAt(N | W, 6, 6)).toBeNull();
  });

  it('crée un coin intérieur quand seule la diagonale est de la terre', () => {
    expect(shoreKindAt(SW, 0, TILE_SIZE - 1)).toBe('sand');
    expect(shoreKindAt(SW, TILE_SIZE - 1, 0)).toBeNull();
    expect(shoreKindAt(S, 8, TILE_SIZE - 1)).toBe('sand');
  });

  it('adoucit la transition eau profonde / eau', () => {
    expect(blendKindAt(N, 5, 0)).toBe('blend');
    expect(blendKindAt(N, 5, 10)).toBeNull();
    expect(cellRects(0, 0, true)).toEqual([]);
    expect(cellRects(0, N, true).length).toBeGreaterThan(0);
  });

  it("buildShore : aucune rive sans terre, une rive autour d'une île", () => {
    const w = TILE.water;
    const g = TILE.ground;
    expect(buildShore(2, 2, [w, w, w, w])).toEqual([]);
    const rects = buildShore(3, 3, [w, w, w, w, g, w, w, w, w]);
    expect(rects.some((r) => r.kind === 'sand')).toBe(true);
    expect(rects.some((r) => r.kind === 'foam')).toBe(true);
    const inCenter = (r: { x: number; y: number }) =>
      r.x >= TILE_SIZE && r.x < 2 * TILE_SIZE && r.y >= TILE_SIZE && r.y < 2 * TILE_SIZE;
    expect(rects.some(inCenter)).toBe(false);
  });
});

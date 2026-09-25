import { TILE_SIZE } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { LevelGrid } from './grid';
import { moveBody, type Body } from './physics';
import { levelFromAscii } from './test-helpers';

function body(overrides: Partial<Body> = {}): Body {
  return { x: 0, y: 0, w: 10, h: 20, vx: 0, vy: 0, onGround: false, ...overrides };
}

describe('moveBody', () => {
  it('fait tomber le corps et l’arrête au sol (landed, onGround)', () => {
    const level = levelFromAscii(['........', '........', '........', '########']);
    const grid = new LevelGrid(level);
    const b = body({ y: 0, vy: 400 });
    const result = moveBody(b, 1, grid);
    expect(result.landed).toBe(true);
    expect(result.hitCeiling).toBe(false);
    expect(b.onGround).toBe(true);
    expect(b.vy).toBe(0);
    // Le bas du corps repose exactement sur le haut de la case de sol (rangée 3).
    expect(b.y + b.h).toBe(3 * TILE_SIZE);
  });

  it('bloque le mouvement horizontal contre un mur (hitWall)', () => {
    const level = levelFromAscii(['....#....', '....#....', '....#....']);
    const grid = new LevelGrid(level);
    const b = body({ x: 0, y: 0, w: 10, h: 16, vx: 300 });
    const result = moveBody(b, 1, grid);
    expect(result.hitWall).toBe(true);
    expect(b.vx).toBe(0);
    expect(b.x + b.w).toBeLessThanOrEqual(4 * TILE_SIZE);
  });

  it('bloque le mouvement vertical contre un plafond (hitCeiling)', () => {
    const level = levelFromAscii(['####', '....', '....', '....']);
    const grid = new LevelGrid(level);
    const b = body({ x: 0, y: 40, w: 10, h: 16, vy: -300 });
    const result = moveBody(b, 1, grid);
    expect(result.hitCeiling).toBe(true);
    expect(result.landed).toBe(false);
    expect(b.vy).toBe(0);
    expect(b.y).toBe(1 * TILE_SIZE);
  });

  it('une plateforme oneway se traverse par-dessous (aucun blocage en montant)', () => {
    const level = levelFromAscii(['....', '====', '....', '....']);
    const grid = new LevelGrid(level);
    // Corps déjà sous la plateforme (haut de la rangée 1 = 16px), qui monte.
    const b = body({ x: 0, y: 32, w: 10, h: 16, vy: -200 });
    const result = moveBody(b, 1, grid);
    expect(result.hitCeiling).toBe(false);
    expect(b.y).toBeLessThan(16);
  });

  it('une plateforme oneway bloque un atterrissage par-dessus', () => {
    const level = levelFromAscii(['....', '====', '....', '....']);
    const grid = new LevelGrid(level);
    // Bas du corps exactement au niveau du haut de la plateforme (rangée 1 → 16px), qui descend.
    const b = body({ x: 0, y: 0, w: 10, h: 16, vy: 60 });
    const result = moveBody(b, 1 / 60, grid);
    expect(result.landed).toBe(true);
    expect(b.onGround).toBe(true);
    expect(b.y + b.h).toBe(1 * TILE_SIZE);
  });

  it('dropThrough ignore les plateformes oneway en descendant', () => {
    const level = levelFromAscii(['....', '====', '....', '....']);
    const grid = new LevelGrid(level);
    const b = body({ x: 0, y: 0, w: 10, h: 16, vy: 300 });
    const result = moveBody(b, 1, grid, { dropThrough: true });
    expect(result.landed).toBe(false);
    expect(b.y + b.h).toBeGreaterThan(2 * TILE_SIZE);
  });

  it('ne traverse jamais un sol solide même à grande vitesse (gros dt)', () => {
    const level = levelFromAscii(['........', '........', '........', '........', '########']);
    const grid = new LevelGrid(level);
    const b = body({ x: 0, y: 0, vy: 5000 });
    const result = moveBody(b, 1, grid);
    expect(result.landed).toBe(true);
    expect(b.y + b.h).toBe(4 * TILE_SIZE);
  });

  it('ne traverse jamais un mur même à grande vitesse horizontale', () => {
    const level = levelFromAscii(['.........#']);
    const grid = new LevelGrid(level);
    const b = body({ x: 0, y: 0, w: 10, h: 10, vx: 8000 });
    const result = moveBody(b, 1, grid);
    expect(result.hitWall).toBe(true);
    expect(b.x + b.w).toBeLessThanOrEqual(9 * TILE_SIZE);
  });

  it('signale un chevauchement avec une tuile hazard (marge de 2px)', () => {
    const level = levelFromAscii(['....', '.^..', '....']);
    const grid = new LevelGrid(level);
    // Case (1,1) = pics : corps centré dessus.
    const b = body({ x: TILE_SIZE + 3, y: TILE_SIZE + 3, w: 10, h: 10 });
    const result = moveBody(b, 0, grid);
    expect(result.hazard).toBe(true);
  });

  it('ne signale pas de hazard si seule la marge (2px) chevauche', () => {
    const level = levelFromAscii(['....', '.^..', '....']);
    const grid = new LevelGrid(level);
    // Corps juste au-dessus de la tuile, ne recouvrant que sa marge externe une fois rétréci.
    const b = body({ x: TILE_SIZE, y: TILE_SIZE - 10 + 1, w: TILE_SIZE, h: 10 });
    const result = moveBody(b, 0, grid);
    expect(result.hazard).toBe(false);
  });
});

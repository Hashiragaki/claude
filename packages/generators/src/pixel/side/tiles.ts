import { PLATFORM_TILE_ROLES, PLATFORM_TILESET_COLUMNS } from '@forge/core';
import { mix, shade } from '../../shared/color';
import { PixelCanvas } from '../canvas';
import type { SideTilesetPalette, SideTilesetTheme } from './palette';
import { T, Tile, hash2, withOpacity } from './tile';

/** Motif périodique doux (période 16 px), pour des taches raccordables (voir `pixel/tileset/ground.ts`). */
function wave(t: Tile, x: number, y: number, k: number): number {
  const p = (i: number) => hash2(i, k, t.salt) * Math.PI * 2;
  const a = (2 * Math.PI) / T;
  return (Math.sin(a * x + p(1)) + Math.sin(a * y + p(2)) + Math.sin(a * (x + y) + p(3)) * 0.8) / 2.8;
}

/** Intérieur du bloc (terre, roche…), raccordable sur les 4 bords : uniquement `wset`/`speckle` par pixel. */
function fillTexture(t: Tile): void {
  const { fill, fillDark, fillLight } = t.pal;
  t.fill(fill);
  t.speckle(mix(fill, fillDark, 0.55), 0.07, 1).speckle(mix(fill, fillLight, 0.5), 0.05, 2);
  t.scatter(8, 3, (x, y, r) => {
    if (r > 0.7) return;
    t.wset(x, y, fillDark);
    t.wset(x + 1, y, mix(fillDark, '#000000', 0.2));
    t.wset(x, y - 1, fillLight);
  });
}

/** Bande de surface lisible (herbe/neige/sable/dallage), sur les `bandH` px du haut, raccordable en X. */
function surfaceBand(t: Tile, bandH = 4): void {
  const { surface, surfaceDark, surfaceLight } = t.pal;
  for (let x = 0; x < T; x++) {
    for (let y = 0; y < bandH; y++) {
      t.wset(x, y, y === 0 ? surfaceLight : y === bandH - 1 ? surfaceDark : surface);
    }
  }
  // Petites touffes/reflets ponctuels, raccordables (uniquement `wset`).
  t.scatter(4, 10, (x, y, r) => {
    if (y >= bandH) return;
    t.wset(x, y, r < 0.5 ? surfaceLight : surfaceDark);
  });
}

/** Coin arrondi : ronge le coin haut-gauche (ou droit, si `mirror`) en transparence. */
function roundCorner(t: Tile, mirror: boolean): void {
  const steps = [4, 3, 2, 1]; // largeur transparente par ligne (escalier de pixels), lignes 0..3
  for (let y = 0; y < steps.length; y++) {
    const w = steps[y] as number;
    for (let i = 0; i < w; i++) {
      const x = mirror ? T - 1 - i : i;
      t.clear(x, y);
    }
  }
}

function drawTop(t: Tile): void {
  fillTexture(t);
  surfaceBand(t);
}

function drawTopCorner(t: Tile, mirror: boolean): void {
  drawTop(t);
  roundCorner(t, mirror);
}

function drawFill(t: Tile): void {
  fillTexture(t);
}

/** Rangées de briques décalées, avec mortier. */
function drawBrick(t: Tile): void {
  const { brick, brickDark } = t.pal;
  const rowH = 4;
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / rowH);
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = 0; x < T; x++) {
      const ly = y % rowH;
      const lx = (x + offset) % 8;
      if (ly === rowH - 1 || lx === 7) {
        t.set(x, y, brickDark);
      } else {
        const tint = t.rnd(Math.floor((x + offset) / 8), row, 20);
        t.set(x, y, tint < 0.5 ? brick : shade(brick, 0.1));
      }
    }
  }
  t.speckle(brickDark, 0.03, 21);
}

/** Bloc de pierre (pavés irréguliers simplifiés). */
function drawStone(t: Tile): void {
  const { stone, stoneDark } = t.pal;
  const light = shade(stone, 0.22);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      const lx = x % 8;
      const ly = y % 8;
      if (lx === 0 || ly === 0) t.set(x, y, stoneDark);
      else {
        const v = t.rnd(bx, by, 30);
        t.set(x, y, v < 0.3 ? light : v < 0.7 ? stone : shade(stone, -0.12));
      }
    }
  }
  t.speckle(stoneDark, 0.04, 31);
}

/** Caisse en bois : planches, croisillon diagonal, clous aux coins. */
function drawCrate(t: Tile): void {
  const { wood, woodDark } = t.pal;
  t.fill(wood);
  for (let x = 0; x < T; x++) t.vline(x, 0, T - 1, x % 2 === 0 ? wood : mix(wood, woodDark, 0.15));
  t.rect(0, 0, T, 1, woodDark);
  t.rect(0, T - 1, T, 1, woodDark);
  t.rect(0, 0, 1, T, woodDark);
  t.rect(T - 1, 0, 1, T, woodDark);
  // Croisillon diagonal.
  t.line(1, 1, T - 2, T - 2, woodDark);
  t.line(T - 2, 1, 1, T - 2, woodDark);
  // Clous aux coins.
  for (const [x, y] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ] as const) {
    t.set(x, y, shade(woodDark, -0.2));
  }
}

/** Planche fine collée en haut de la case, reste transparent. */
function drawPlatform(t: Tile): void {
  const { wood, woodDark } = t.pal;
  const h = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < T; x++) {
      t.set(x, y, y === h - 1 ? woodDark : y === 0 ? shade(wood, 0.2) : wood);
    }
  }
  // Grain du bois et joints des planches.
  for (let x = 0; x < T; x += 5) t.vline(x, 0, h - 1, woodDark);
  t.speckle(woodDark, 0.05, 40);
  t.outlined();
  t.shadow(T / 2, h + 1, T / 2 - 1, 2, 0.28);
}

/** Pont : planches horizontales fines + piquets/cordes aux bords. */
function drawBridge(t: Tile): void {
  const { wood, woodDark } = t.pal;
  const h = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < T; x++) t.set(x, y, y === h - 1 ? woodDark : wood);
  }
  for (let x = 1; x < T; x += 4) t.vline(x, 0, h - 1, woodDark);
  // Piquets aux bords, avec corde qui pend un peu.
  for (const x of [1, T - 2]) {
    t.vline(x, 0, h, woodDark);
    t.set(x, h + 1, woodDark);
    t.set(x === 1 ? x + 1 : x - 1, h + 2, mix(woodDark, '#000000', 0.2));
  }
  t.outlined();
}

/** Pics pointus, lisibles en silhouette, alignés en bas de la case. */
function drawSpikes(t: Tile): void {
  const base = shade(t.pal.stoneDark, -0.1);
  const light = '#f4f4f4';
  const count = 4;
  const w = T / count;
  for (let i = 0; i < count; i++) {
    const cx = i * w + w / 2;
    const h = 8 + Math.floor(t.rnd(i, 0, 50) * 3);
    for (let row = 0; row < h; row++) {
      const y = T - 1 - row;
      const half = Math.max(0, Math.floor((w / 2) * (row / h)));
      for (let dx = -half; dx <= half; dx++) {
        t.set(cx + dx, y, row < h - 2 ? light : base);
      }
    }
  }
  t.outlined();
}

/** Eau semi-transparente, bandes ondulées. */
function drawWater(t: Tile): void {
  const { water, waterLight } = t.pal;
  const dark = shade(water, -0.18);
  const phase = t.rnd(0, 0, 60) * Math.PI * 2;
  t.fill(water);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const band = Math.sin(((2 * Math.PI) / 8) * y + 1.3 * Math.sin(((2 * Math.PI) / T) * x + phase));
      if (band > 0.8) t.set(x, y, dark);
      else if (band < -0.9) t.set(x, y, mix(water, waterLight, 0.2));
    }
  }
  t.wset(6, 2, waterLight);
  t.wset(7, 2, waterLight);
  withOpacity(t, 0.78);
}

/** Nuage : forme ovoïde blanche, plusieurs bosses. */
function drawCloud(t: Tile): void {
  const white = '#ffffff';
  const shadowC = mix(t.pal.waterLight, '#8ea6c8', 0.4);
  for (const [cx, cy, rx, ry] of [
    [4, 9, 3.4, 2.6],
    [8, 7, 4.2, 3.2],
    [12, 9, 3.2, 2.4],
  ] as const) {
    t.ellipse(cx, cy, rx, ry, white);
  }
  // Ombre douce sous le nuage (bas des bosses).
  for (let x = 0; x < T; x++) {
    for (let y = 9; y < T; y++) {
      if (t.filled(x, y) && !t.filled(x, y + 1)) t.paint(x, y, shadowC);
    }
  }
  t.outlined(mix(t.pal.outline, '#ffffff', 0.3));
}

/** Buisson : blob de feuillage sur fond transparent, contour sombre. */
function drawBush(t: Tile): void {
  const { leaf, leafDark } = t.pal;
  for (const [cx, cy, rx, ry] of [
    [4, 11, 3.6, 3.2],
    [11, 11, 3.8, 3.4],
    [8, 9, 4.6, 3.8],
  ] as const) {
    t.ellipse(cx, cy, rx, ry, leaf);
  }
  t.speckle(leafDark, 0.12, 70);
  for (let x = 0; x < T; x++) {
    for (let y = 0; y < T; y++) {
      if (t.filled(x, y) && !t.filled(x, y - 1)) t.paint(x, y, mix(leaf, '#ffffff', 0.15));
    }
  }
  t.outlined();
}

/** Fleurs sur brins d'herbe, fond transparent. */
function drawFlower(t: Tile): void {
  const { leaf, leafDark, accent } = t.pal;
  for (let x = 1; x < T; x += 3) {
    const h = 3 + Math.floor(t.rnd(x, 0, 80) * 3);
    t.vline(x, T - h, T - 1, leaf);
    t.set(x, T - h - 1, leafDark);
  }
  const spots: [number, number][] = [
    [3, 5],
    [8, 3],
    [13, 6],
  ];
  spots.forEach(([sx, sy], i) => {
    const petal = i % 2 === 0 ? accent : shade(accent, -0.1);
    t.set(sx, sy - 1, petal);
    t.set(sx - 1, sy, petal);
    t.set(sx + 1, sy, petal);
    t.set(sx, sy + 1, shade(petal, -0.2));
    t.set(sx, sy, '#f8e070');
  });
  t.outlined();
}

/** Panneau en bois sur piquet, fond transparent. */
function drawSign(t: Tile): void {
  const { wood, woodDark } = t.pal;
  t.rect(5, T - 6, 2, 6, woodDark);
  t.rect(2, 3, 12, 7, wood);
  t.rect(2, 3, 12, 1, shade(wood, 0.2));
  t.rect(2, 9, 12, 1, woodDark);
  t.hline(4, 11, 6, woodDark);
  t.outlined();
}

/** Barrière en bois : montants + lattes horizontales, transparent entre les lattes. */
function drawFence(t: Tile): void {
  const { wood, woodDark } = t.pal;
  for (const x of [2, 13]) {
    t.vline(x, 2, T - 1, wood);
    t.vline(x + 1, 2, T - 1, mix(wood, woodDark, 0.3));
  }
  for (const y of [4, 9]) {
    t.hline(0, T - 1, y, wood);
    t.hline(0, T - 1, y + 1, woodDark);
  }
  t.outlined();
}

type RoleDrawer = (t: Tile) => void;

export const ROLE_DRAWERS: Record<string, RoleDrawer> = {
  top: drawTop,
  fill: drawFill,
  top_left: (t) => drawTopCorner(t, false),
  top_right: (t) => drawTopCorner(t, true),
  platform: drawPlatform,
  brick: drawBrick,
  stone: drawStone,
  crate: drawCrate,
  spikes: drawSpikes,
  water: drawWater,
  bridge: drawBridge,
  cloud: drawCloud,
  bush: drawBush,
  flower: drawFlower,
  sign: drawSign,
  fence: drawFence,
};

/** Dessine une tuile 16 × 16 pour un rôle donné, dans un thème et une palette donnés. */
export function drawTile(role: string, theme: SideTilesetTheme, palette: SideTilesetPalette): Tile {
  const t = new Tile(palette, theme, role);
  const draw = ROLE_DRAWERS[role];
  if (draw) draw(t);
  return t;
}

/** Assemble la planche complète (8 colonnes × 2 lignes de 16 × 16 = 128 × 32). */
export function drawSideTileset(theme: SideTilesetTheme, palette: SideTilesetPalette): PixelCanvas {
  const canvas = new PixelCanvas(PLATFORM_TILESET_COLUMNS * T, 2 * T);
  for (const role of PLATFORM_TILE_ROLES) {
    const tile = drawTile(role.id, theme, palette);
    const x = (role.index % PLATFORM_TILESET_COLUMNS) * T;
    const y = Math.floor(role.index / PLATFORM_TILESET_COLUMNS) * T;
    canvas.draw(tile, x, y);
  }
  return canvas;
}

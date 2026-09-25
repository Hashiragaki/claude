import { hashString } from '@forge/core';
import { mix, shade } from '../../shared/color';
import { PixelCanvas } from '../canvas';
import type { TilesetPalette, TilesetTheme } from './palettes';

export const T = 16;

/** Hachage entier → [0, 1), stable et sans état (motifs raccordables). */
export function hash2(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (v: number) => ((v % T) + T) % T;

/** Tuile 16 × 16 : toile + outils de dessin raccordables et ombre portée. */
export class Tile extends PixelCanvas {
  readonly salt: number;

  constructor(
    readonly pal: TilesetPalette,
    readonly theme: TilesetTheme,
    role: string,
  ) {
    super(T, T);
    this.salt = hashString(`${theme}:${role}`);
  }

  /** Aléa déterministe pour ce pixel et cette tuile. */
  rnd(x: number, y: number, k = 0): number {
    return hash2(x, y, this.salt + k * 7919);
  }

  /** Pose un pixel en bouclant sur les bords (textures sans raccord visible). */
  wset(x: number, y: number, color: string): void {
    this.set(wrap(x), wrap(y), color);
  }

  fill(color: string): this {
    this.rect(0, 0, T, T, color);
    return this;
  }

  /** Mouchetures : `density` = probabilité par pixel. */
  speckle(color: string, density: number, k = 1): this {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (this.rnd(x, y, k) < density) this.set(x, y, color);
    return this;
  }

  /** Touffe d'herbe en « v » (raccordable). */
  tuft(x: number, y: number, dark: string, light: string): void {
    this.wset(x, y, dark);
    this.wset(x - 1, y - 1, dark);
    this.wset(x + 1, y - 1, dark);
    this.wset(x, y - 1, light);
  }

  /** Points répartis sur une grille jitterée (raccordable). */
  scatter(cell: number, k: number, fn: (x: number, y: number, r: number) => void): void {
    for (let gy = 0; gy < T; gy += cell) {
      for (let gx = 0; gx < T; gx += cell) {
        const r = this.rnd(gx, gy, k);
        const x = gx + Math.floor(this.rnd(gx, gy, k + 1) * cell);
        const y = gy + Math.floor(this.rnd(gx, gy, k + 2) * cell);
        fn(x, y, r);
      }
    }
  }

  /** Contour sombre autour des objets posés sur fond transparent. */
  outlined(color = this.pal.outline): this {
    this.outline(color);
    return this;
  }

  /** Ombre douce au sol (seulement sur les pixels transparents), à appeler après le contour. */
  shadow(cx: number, cy: number, rx: number, ry: number, alpha = 0.3): this {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0');
    const color = `${mix(this.pal.outline, '#000000', 0.3)}${a}`;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && this.alpha(x, y) === 0) this.set(x, y, color);
      }
    }
    return this;
  }
}

/** Tons dérivés : ombre, base, lumière, reflet. */
export function tones(base: string): [string, string, string, string] {
  return [shade(base, -0.35), base, shade(base, 0.2), shade(base, 0.45)];
}

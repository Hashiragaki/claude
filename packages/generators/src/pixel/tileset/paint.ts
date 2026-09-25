import { shade } from '../../shared/color';
import { pickTone } from '../shapes';
import type { Tile } from './tile';

/** Rampe de 5 tons à partir d'une couleur de base et de son ombre. */
export function ramp5(base: string, dark: string): string[] {
  return [shade(dark, -0.25), dark, base, shade(base, 0.2), shade(base, 0.42)];
}

/**
 * Ellipse ombrée (éclairage haut-gauche), bord éventuellement irrégulier (`bumps` lobes).
 * `onlyEmpty` ne peint que les pixels encore transparents.
 */
export function blob(
  t: Tile,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tones: readonly string[],
  opts: { bumps?: number; bumpAmp?: number; phase?: number; bias?: number; onlyEmpty?: boolean } = {},
): void {
  const bumps = opts.bumps ?? 0;
  const amp = opts.bumpAmp ?? 0.1;
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const limit = 1 + (bumps ? amp * Math.sin(ang * bumps + (opts.phase ?? 0)) : 0);
      if (d > limit) continue;
      if (opts.onlyEmpty && t.filled(x, y)) continue;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d) ** 2));
      const light = 0.5 + 0.5 * (-0.55 * nx - 0.65 * ny + 0.55 * nz) + (opts.bias ?? 0);
      t.set(x, y, pickTone(tones, Math.max(0, Math.min(1, light))));
    }
  }
}

/** Grappe de feuillage : plusieurs boules ombrées qui se chevauchent. */
export function foliage(t: Tile, clumps: readonly [number, number, number][], tones: readonly string[]): void {
  clumps.forEach(([x, y, r], i) =>
    blob(t, x, y, r, r * 0.92, tones, { bumps: 5, bumpAmp: 0.12, phase: i * 1.7, bias: -y / 60 }),
  );
}

/** Petite flamme (base orange, cœur clair). */
export function flame(t: Tile, cx: number, bottom: number, height: number, accent: string): void {
  const outer = shade(accent, -0.15);
  for (let i = 0; i < height; i++) {
    const y = bottom - i;
    const half = Math.max(0, Math.round((1 - i / height) * 2 - (i === 0 ? 0.5 : 0)));
    for (let dx = -half; dx <= half; dx++) t.set(cx + dx, y, Math.abs(dx) === half ? outer : accent);
    if (i < height - 2) t.set(cx, y, i < height / 2 ? '#fff6c8' : '#ffd860');
  }
  t.set(cx, bottom - height, outer);
}

/** Halo lumineux semi-transparent autour d'un point (seulement sur pixels vides). */
export function glow(t: Tile, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1 || t.filled(x, y)) continue;
      const a = Math.round((1 - d) * 70)
        .toString(16)
        .padStart(2, '0');
      t.set(x, y, `${color}${a}`);
    }
  }
}

import type { Rng } from '@forge/core';
import { num } from './svg';

export type Point = [number, number];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function polar(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/** Points d'une étoile à `n` branches (commence en haut). */
export function starPoints(cx: number, cy: number, outer: number, inner: number, n = 5, rotation = -90): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n * 2; i++) {
    out.push(polar(cx, cy, i % 2 === 0 ? outer : inner, rotation + (i * 180) / n));
  }
  return out;
}

/** Polygone régulier. */
export function regularPolygon(cx: number, cy: number, r: number, n: number, rotation = -90): Point[] {
  return Array.from({ length: n }, (_, i) => polar(cx, cy, r, rotation + (i * 360) / n));
}

/**
 * Chemin fermé lissé (Catmull-Rom → Bézier cubiques) passant par tous les points.
 * `tension` 1 = courbe standard, plus petit = plus anguleux.
 */
export function smoothClosedPath(pts: readonly Point[], tension = 1): string {
  const n = pts.length;
  if (n < 3) return '';
  const p = (i: number) => pts[((i % n) + n) % n] as Point;
  let out = `M${num(p(0)[0])} ${num(p(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const k = tension / 6;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    out += `C${num(c1[0])} ${num(c1[1])} ${num(c2[0])} ${num(c2[1])} ${num(p2[0])} ${num(p2[1])}`;
  }
  return `${out}Z`;
}

/** Chemin ouvert lissé passant par les points. */
export function smoothOpenPath(pts: readonly Point[], tension = 1): string {
  const n = pts.length;
  if (n < 2) return '';
  const p = (i: number) => pts[Math.max(0, Math.min(n - 1, i))] as Point;
  let out = `M${num(p(0)[0])} ${num(p(0)[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const k = tension / 6;
    out +=
      `C${num(p1[0] + (p2[0] - p0[0]) * k)} ${num(p1[1] + (p2[1] - p0[1]) * k)} ` +
      `${num(p2[0] - (p3[0] - p1[0]) * k)} ${num(p2[1] - (p3[1] - p1[1]) * k)} ${num(p2[0])} ${num(p2[1])}`;
  }
  return out;
}

/** Contour organique (« blob ») autour d'un centre, avec une irrégularité contrôlée. */
export function blobPath(cx: number, cy: number, rx: number, ry: number, rng: Rng, count = 9, jitter = 0.15): string {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const k = 1 + rng.float(-jitter, jitter);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smoothClosedPath(pts);
}

/** Silhouette de collines : chemin fermé allant de `y` (ligne de crête) jusqu'au bas `bottom`. */
export function ridgePath(
  width: number,
  baseY: number,
  bottom: number,
  rng: Rng,
  opts: { amplitude: number; segments: number; sharp?: boolean },
): string {
  const pts: Point[] = [];
  const seg = opts.segments;
  for (let i = 0; i <= seg; i++) {
    const x = (i / seg) * width;
    const y = baseY - rng.float(0.2, 1) * opts.amplitude * (opts.sharp && i % 2 === 1 ? 1.4 : 1);
    pts.push([x, y]);
  }
  const top = opts.sharp ? `M${pts.map(([x, y]) => `${num(x)} ${num(y)}`).join('L')}` : smoothOpenPath(pts);
  return `${top}L${num(width)} ${num(bottom)}L0 ${num(bottom)}Z`;
}

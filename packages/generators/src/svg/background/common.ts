import type { Rng } from '@forge/core';
import { mix, shade } from '../../shared/color';
import { d, el } from '../../shared/svg';
import type { SvgBuilder } from '../builder';

export const W = 1280;
export const H = 720;

export const TIMES = ['day', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES)[number];

/** Contexte de dessin d'un décor. */
export interface Scene {
  b: SvgBuilder;
  rng: Rng;
  time: TimeOfDay;
  /** Applique l'éclairage du moment (journée, coucher de soleil, nuit) à une couleur. */
  L: (color: string) => string;
  /** Couleur d'accent optionnelle (palette imposée). */
  accent?: string;
}

export function lighting(time: TimeOfDay): (color: string) => string {
  switch (time) {
    case 'sunset':
      return (c) => shade(mix(c, '#ff8a5c', 0.16), -0.08);
    case 'night':
      return (c) => shade(mix(c, '#1c2858', 0.5), -0.22);
    default:
      return (c) => c;
  }
}

export const SKY: Record<TimeOfDay, [string, string, string]> = {
  day: ['#4f9fe6', '#8cc8f2', '#d8f0fb'],
  sunset: ['#3b3a7c', '#d9708e', '#fbc475'],
  night: ['#070b24', '#15204a', '#2c3c70'],
};

/** Ciel en dégradé + soleil ou lune. */
export function sky(s: Scene, horizon = H, sunX = 960): void {
  const [top, mid, low] = SKY[s.time];
  const fill =
    s.b.style === 'soft'
      ? s.b.lin([
          [0, top],
          [0.6, mid],
          [1, low],
        ])
      : mid;
  s.b.e('rect', { width: W, height: horizon, fill });
  if (s.b.style !== 'soft') {
    for (let i = 0; i < 4; i++) {
      const y = (horizon / 5) * (i + 1);
      s.b.e('rect', { y, width: W, height: horizon - y, fill: mix(mid, low, (i + 1) / 4), opacity: 0.5 });
    }
  }
  if (s.time === 'day') {
    s.b.e('circle', { cx: sunX, cy: 120, r: 150, fill: s.b.glow('#fff6d0', 0.55) });
    s.b.e('circle', { cx: sunX, cy: 120, r: 46, fill: '#fff8e0' });
  } else if (s.time === 'sunset') {
    s.b.e('circle', { cx: sunX, cy: horizon - 40, r: 260, fill: s.b.glow('#ffb870', 0.6) });
    s.b.e('circle', { cx: sunX, cy: horizon - 40, r: 70, fill: '#ffd98a' });
  } else {
    stars(s, horizon, 110);
    s.b.e('circle', { cx: sunX, cy: 110, r: 120, fill: s.b.glow('#c8d8ff', 0.35) });
    s.b.e('circle', { cx: sunX, cy: 110, r: 38, fill: '#f4f2e0' });
    s.b.e('circle', { cx: sunX + 16, cy: 100, r: 34, fill: SKY.night[0], opacity: 0.92 });
  }
}

/** Étoiles de tailles variées (quelques-unes scintillantes en croix). */
export function stars(s: Scene, maxY: number, count: number): void {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = s.rng.float(0, W);
    const y = s.rng.float(0, maxY * 0.85);
    const r = s.rng.float(0.8, 2.2);
    parts.push(`M${Math.round(x)} ${Math.round(y)}h0.1`);
    if (i % 17 === 0) {
      s.b.e('path', {
        d: d('M', x - 8, y, 'L', x + 8, y, 'M', x, y - 8, 'L', x, y + 8),
        stroke: '#ffffff',
        'stroke-width': 1.5,
        opacity: 0.8,
      });
    }
    if (r > 1.9)
      s.b.e('circle', {
        cx: x,
        cy: y,
        r: r * 2.5,
        fill: '#ffffff',
        opacity: 0.12,
      });
  }
  s.b.e('path', {
    d: parts.join(''),
    stroke: '#ffffff',
    'stroke-width': 3,
    'stroke-linecap': 'round',
    opacity: 0.9,
  });
}

/** Nuage cotonneux (grappe d'ellipses avec une base ombrée). */
export function cloud(s: Scene, x: number, y: number, scale: number): void {
  const base = s.time === 'day' ? '#ffffff' : s.time === 'sunset' ? '#ffd0b8' : '#3a4878';
  const shadow = s.time === 'day' ? '#d6e6f4' : s.time === 'sunset' ? '#c07898' : '#26335c';
  const blobs: [number, number, number][] = [
    [-60, 10, 42],
    [-20, -12, 55],
    [30, -20, 60],
    [75, 5, 44],
    [10, 18, 48],
  ];
  const g = blobs
    .map(([dx, dy, r]) =>
      el('circle', {
        cx: dx * scale,
        cy: dy * scale,
        r: r * scale,
        fill: base,
      }),
    )
    .join('');
  const under = el('ellipse', {
    cx: 10 * scale,
    cy: 34 * scale,
    rx: 110 * scale,
    ry: 22 * scale,
    fill: shadow,
  });
  s.b.e(
    'g',
    {
      transform: `translate(${Math.round(x)} ${Math.round(y)})`,
      opacity: s.time === 'night' ? 0.7 : 0.95,
    },
    [under, g],
  );
}

export function clouds(s: Scene, count: number, maxY = 300): void {
  for (let i = 0; i < count; i++) cloud(s, s.rng.float(80, W - 80), s.rng.float(60, maxY), s.rng.float(0.6, 1.2));
}

/** Fenêtre éclairée ou reflet de ciel selon l'heure. */
export function windowFill(s: Scene, lit: boolean): string {
  if (s.time === 'night') return lit ? '#ffd27a' : '#1c2748';
  if (s.time === 'sunset') return lit ? '#ffc98a' : '#f0a888';
  return lit ? '#e8f6ff' : '#a8d4f0';
}

/** Halo lumineux (lampes, fenêtres de nuit). */
export function halo(s: Scene, x: number, y: number, r: number, color = '#ffd27a', opacity = 0.55): void {
  s.b.e('circle', { cx: x, cy: y, r, fill: s.b.glow(color, opacity) });
}

/** Voile d'ambiance (brume, obscurité nocturne) par-dessus tout le décor. */
export function ambience(s: Scene): void {
  if (s.time === 'night') s.b.e('rect', { width: W, height: H, fill: '#0a1030', opacity: 0.18 });
  if (s.time === 'sunset') s.b.e('rect', { width: W, height: H, fill: '#ff9a60', opacity: 0.06 });
}

/** Arbre feuillu : tronc et grappes de feuillage ombrées. */
export function tree(s: Scene, x: number, groundY: number, h: number, leaf = '#4a9a4a'): void {
  const trunk = s.L('#7a5236');
  const lf = s.L(leaf);
  const w = h * 0.09;
  s.b.e('path', {
    d: d(
      'M',
      x - w,
      groundY,
      'C',
      x - w * 0.6,
      groundY - h * 0.3,
      x - w * 0.5,
      groundY - h * 0.5,
      x - w * 0.3,
      groundY - h * 0.6,
      'L',
      x + w * 0.3,
      groundY - h * 0.6,
      'C',
      x + w * 0.5,
      groundY - h * 0.5,
      x + w * 0.6,
      groundY - h * 0.3,
      x + w,
      groundY,
      'Z',
    ),
    fill: trunk,
    ...s.b.line(1),
  });
  const cy = groundY - h * 0.68;
  const r = h * 0.2;
  const clumps: [number, number, number][] = [
    [-1.1, 0.35, 0.8],
    [1.1, 0.35, 0.8],
    [-0.55, -0.3, 0.95],
    [0.6, -0.25, 0.95],
    [0, -0.9, 0.9],
    [0, 0.25, 1],
  ];
  const dark = shade(lf, -0.3);
  const light = shade(lf, 0.2);
  for (const [dx, dy, k] of clumps) {
    s.b.e('circle', {
      cx: x + dx * r,
      cy: cy + dy * r,
      r: r * k,
      fill: dy > 0 ? dark : lf,
      ...s.b.line(0.8),
    });
  }
  for (const [dx, dy, k] of clumps.slice(2, 5)) {
    s.b.e('circle', {
      cx: x + dx * r - r * 0.2,
      cy: cy + dy * r - r * 0.25,
      r: r * k * 0.55,
      fill: light,
      opacity: 0.7,
    });
  }
}

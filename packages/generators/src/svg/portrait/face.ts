import { mix, shade } from '../../shared/color';
import { d, el } from '../../shared/svg';
import type { SvgBuilder } from '../builder';
import type { Expression, PortraitIdentity } from './identity';

/** Réglages du visage selon l'expression. */
interface FaceSettings {
  open: number;
  innerDy: number;
  outerDy: number;
  iris: number;
  lookX: number;
  lookY: number;
  browInner: number;
  browOuter: number;
  browArch: number;
  blush: number;
}

const SETTINGS: Record<Expression, FaceSettings> = {
  neutral: { open: 1, innerDy: 0, outerDy: 0, iris: 1, lookX: 0, lookY: 0, browInner: 0, browOuter: 0, browArch: 7, blush: 0.16 },
  happy: { open: 0, innerDy: 0, outerDy: 0, iris: 1, lookX: 0, lookY: 0, browInner: -8, browOuter: -4, browArch: 9, blush: 0.3 },
  sad: { open: 0.82, innerDy: -7, outerDy: 7, iris: 1, lookX: 0, lookY: 5, browInner: -14, browOuter: 6, browArch: 2, blush: 0.14 },
  angry: { open: 0.74, innerDy: 9, outerDy: -3, iris: 0.9, lookX: 0, lookY: 0, browInner: 14, browOuter: -8, browArch: 0, blush: 0.2 },
  surprised: { open: 1.14, innerDy: 0, outerDy: 0, iris: 0.74, lookX: 0, lookY: 0, browInner: -18, browOuter: -14, browArch: 12, blush: 0.18 },
  embarrassed: { open: 0.9, innerDy: -3, outerDy: 2, iris: 1, lookX: -8, lookY: 3, browInner: -10, browOuter: 3, browArch: 5, blush: 0.55 },
};

export interface FaceColors {
  skin: string;
  skinShadow: string;
  line: string;
  lash: string;
  brow: string;
}

const EYE_W = 64;
const EYE_H = 58;
export const EYE_Y = 338;
export const EYE_X = [252, 348] as const;

/** Un œil ouvert (ou fermé en arc pour la joie). `dir` = -1 œil gauche (coin externe à gauche). */
function eye(b: SvgBuilder, id: PortraitIdentity, c: FaceColors, cx: number, dir: -1 | 1, s: FaceSettings): string {
  const cy = EYE_Y;
  const x = (u: number) => cx + dir * (EYE_W / 2 - u * EYE_W);
  const lashW = 6.5;
  if (s.open === 0) {
    // Yeux plissés de joie : arcs « ^ ».
    const arc = d('M', x(0), cy + 8, 'Q', cx, cy - 18, x(1), cy + 8);
    return (
      el('path', { d: arc, fill: 'none', stroke: c.lash, 'stroke-width': lashW + 1, 'stroke-linecap': 'round' }) +
      el('path', { d: d('M', x(0), cy + 8, 'l', dir * 9, 4), stroke: c.lash, 'stroke-width': 4, 'stroke-linecap': 'round' })
    );
  }
  const outer: [number, number] = [x(0), cy - 5 + s.outerDy];
  const inner: [number, number] = [x(1), cy + 3 + s.innerDy];
  const top = cy - (EYE_H / 2) * s.open;
  const bottom = cy + (EYE_H / 2) * Math.min(1, s.open) * 0.92;
  const upper = d('M', outer[0], outer[1], 'C', x(0.12), top + (s.outerDy > 0 ? s.outerDy : 0), x(0.72), top + (s.innerDy > 0 ? s.innerDy * 0.8 : 0), inner[0], inner[1]);
  const lower = d('C', x(0.8), bottom, x(0.22), bottom + 2, outer[0], outer[1]);
  const clipId = b.id('eye');
  b.def(el('clipPath', { id: clipId }, el('path', { d: `${upper}${lower}Z` })));
  const icx = cx + s.lookX;
  const icy = cy + 5 + s.lookY;
  const rx = 21 * s.iris;
  const ry = 26 * s.iris;
  const irisFill = b.lin([
    [0, shade(id.eyes, -0.6)],
    [0.45, id.eyes],
    [1, shade(id.eyes, 0.4)],
  ]);
  const parts = [
    el('path', { d: `${upper}${lower}Z`, fill: '#fbfbff' }),
    el('g', { 'clip-path': `url(#${clipId})` }, [
      el('ellipse', { cx: icx, cy: icy, rx, ry, fill: irisFill, stroke: shade(id.eyes, -0.55), 'stroke-width': 2.5 }),
      el('ellipse', { cx: icx, cy: icy + 6 * s.iris, rx: rx * 0.6, ry: ry * 0.45, fill: shade(id.eyes, 0.3), opacity: 0.55 }),
      el('ellipse', { cx: icx, cy: icy - 1, rx: 9 * s.iris, ry: 12 * s.iris, fill: shade(id.eyes, -0.75) }),
      el('path', { d: `${upper}L${x(1)} ${top - 30}L${x(0)} ${top - 30}Z`, fill: 'none' }),
      el('path', {
        d: d('M', outer[0], outer[1] + 2, 'C', x(0.12), top + 10, x(0.72), top + 10, inner[0], inner[1] + 3),
        fill: 'none',
        stroke: mix(c.lash, id.eyes, 0.3),
        'stroke-width': 12,
        opacity: 0.35,
      }),
      el('circle', { cx: icx - 8 * s.iris, cy: icy - 10 * s.iris, r: 7 * s.iris, fill: '#ffffff' }),
      el('circle', { cx: icx + 8 * s.iris, cy: icy + 12 * s.iris, r: 3.5 * s.iris, fill: '#ffffff', opacity: 0.9 }),
    ]),
    // Cil supérieur épais + petite aile au coin externe.
    el('path', { d: upper, fill: 'none', stroke: c.lash, 'stroke-width': lashW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    el('path', {
      d: d('M', outer[0] + dir * 2, outer[1] + 2, 'l', dir * 11, -9, 'l', -dir * 3, 11, 'Z'),
      fill: c.lash,
    }),
    el('path', {
      d: d('M', x(0.08), outer[1] + 10, 'Q', x(0.25), bottom + 1, x(0.5), bottom + 1),
      fill: 'none',
      stroke: c.lash,
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      opacity: 0.8,
    }),
    el('path', {
      d: d('M', x(0.18), top - 9, 'Q', x(0.5), top - 15, x(0.86), top - 6 + s.innerDy * 0.5),
      fill: 'none',
      stroke: c.line,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      opacity: 0.45,
    }),
  ];
  return parts.join('');
}

function brow(c: FaceColors, cx: number, dir: -1 | 1, s: FaceSettings): string {
  const by = EYE_Y - 52;
  const inner: [number, number] = [cx - dir * 26, by + s.browInner];
  const outer: [number, number] = [cx + dir * 30, by + 6 + s.browOuter];
  const mid: [number, number] = [(inner[0] + outer[0]) / 2, Math.min(inner[1], outer[1]) - s.browArch];
  return el('path', {
    d: d('M', inner[0], inner[1], 'Q', mid[0], mid[1], outer[0], outer[1]),
    fill: 'none',
    stroke: c.brow,
    'stroke-width': 6,
    'stroke-linecap': 'round',
  });
}

function mouth(expr: Expression, c: FaceColors): string {
  const lip = mix(c.line, '#c04a5a', 0.45);
  const dark = '#7a2434';
  switch (expr) {
    case 'happy':
      return (
        el('path', { d: 'M280 399Q300 404 320 399Q316 425 300 427Q284 425 280 399Z', fill: dark, stroke: lip, 'stroke-width': 2.5 }) +
        el('path', { d: 'M286 401Q300 405 314 401L313 406Q300 409 287 406Z', fill: '#ffffff' }) +
        el('ellipse', { cx: 300, cy: 420, rx: 10, ry: 5, fill: '#e8707e' })
      );
    case 'sad':
      return el('path', { d: 'M287 415Q300 404 313 415', fill: 'none', stroke: lip, 'stroke-width': 3.5, 'stroke-linecap': 'round' });
    case 'angry':
      return (
        el('path', { d: 'M282 414Q300 398 318 414Q300 409 282 414Z', fill: dark, stroke: lip, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }) +
        el('path', { d: 'M289 408Q300 403 311 408', fill: 'none', stroke: '#ffffff', 'stroke-width': 3 })
      );
    case 'surprised':
      return (
        el('ellipse', { cx: 300, cy: 413, rx: 9, ry: 12, fill: dark, stroke: lip, 'stroke-width': 2.5 }) +
        el('ellipse', { cx: 300, cy: 419, rx: 5, ry: 4, fill: '#e8707e' })
      );
    case 'embarrassed':
      return el('path', {
        d: 'M283 411q4 -5 8.5 0t8.5 0t8.5 0t8.5 0',
        fill: 'none',
        stroke: lip,
        'stroke-width': 3,
        'stroke-linecap': 'round',
      });
    default:
      return el('path', { d: 'M289 407Q300 412 311 406', fill: 'none', stroke: lip, 'stroke-width': 3.2, 'stroke-linecap': 'round' });
  }
}

function extras(expr: Expression): string {
  switch (expr) {
    case 'sad': {
      const tear = (x: number, dir: number) =>
        el('path', {
          d: d('M', x, EYE_Y + 24, 'q', dir * 4, 30, dir * 2, 58),
          fill: 'none',
          stroke: '#a8dcf8',
          'stroke-width': 6,
          'stroke-linecap': 'round',
          opacity: 0.85,
        }) + el('path', { d: d('M', x + dir * 2, EYE_Y + 76, 'c', 6, 8, 6, 14, 0, 16, 'c', -6, -2, -6, -8, 0, -16, 'Z'), fill: '#c8ecff', stroke: '#6ab0e0', 'stroke-width': 1.5 });
      const shine = (cx: number) =>
        el('path', { d: d('M', cx - 20, EYE_Y + 22, 'Q', cx, EYE_Y + 30, cx + 20, EYE_Y + 22), fill: 'none', stroke: '#bfe8ff', 'stroke-width': 4, opacity: 0.9, 'stroke-linecap': 'round' });
      return tear(226, -1) + tear(374, 1) + shine(EYE_X[0]) + shine(EYE_X[1]);
    }
    case 'embarrassed': {
      const hatch = (cx: number) =>
        [0, 1, 2].map((i) => el('path', { d: d('M', cx - 14 + i * 12, 398, 'l', 7, -12), stroke: '#e04a6a', 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.8 })).join('');
      return (
        hatch(238) +
        hatch(362) +
        el('path', { d: 'M428 222C444 248 446 264 428 272C410 264 412 248 428 222Z', fill: '#c8ecff', stroke: '#5aa0d0', 'stroke-width': 2.5 }) +
        el('ellipse', { cx: 423, cy: 258, rx: 3.5, ry: 6, fill: '#ffffff' })
      );
    }
    case 'angry': {
      const cx = 404;
      const cy = 205;
      const vein = [
        [-15, -4, -4, -4, -4, -15],
        [4, -15, 4, -4, 15, -4],
        [15, 4, 4, 4, 4, 15],
        [-4, 15, -4, 4, -15, 4],
      ]
        .map(([a, b2, c1, c2, e1, e2]) => d('M', cx + (a as number), cy + (b2 as number), 'Q', cx + (c1 as number), cy + (c2 as number), cx + (e1 as number), cy + (e2 as number)))
        .join('');
      return el('path', { d: vein, fill: 'none', stroke: '#e0303a', 'stroke-width': 5.5, 'stroke-linecap': 'round' });
    }
    case 'surprised':
      return [
        [236, 118, -10, -18],
        [300, 100, 0, -22],
        [364, 118, 10, -18],
      ]
        .map(([x, y, dx, dy]) => el('path', { d: d('M', x as number, y as number, 'l', dx as number, dy as number), stroke: '#3a2a3a', 'stroke-width': 5, 'stroke-linecap': 'round' }))
        .join('');
    case 'happy':
      return [
        [168, 250, 12],
        [436, 212, 9],
      ]
        .map(([x, y, r]) =>
          el('path', {
            d: d('M', x as number, (y as number) - (r as number), 'Q', x as number, y as number, (x as number) + (r as number), y as number, 'Q', x as number, y as number, x as number, (y as number) + (r as number), 'Q', x as number, y as number, (x as number) - (r as number), y as number, 'Q', x as number, y as number, x as number, (y as number) - (r as number), 'Z'),
            fill: '#ffe07a',
          }),
        )
        .join('');
    default:
      return '';
  }
}

/** Yeux, sourcils, nez, bouche, joues et effets d'expression. */
export function drawFace(b: SvgBuilder, id: PortraitIdentity, expr: Expression, c: FaceColors): string {
  const s = SETTINGS[expr];
  return [
    el('ellipse', { cx: 238, cy: 394, rx: 27, ry: 11, fill: '#ff6a8a', opacity: s.blush }),
    el('ellipse', { cx: 362, cy: 394, rx: 27, ry: 11, fill: '#ff6a8a', opacity: s.blush }),
    eye(b, id, c, EYE_X[0], -1, s),
    eye(b, id, c, EYE_X[1], 1, s),
    brow(c, EYE_X[0], -1, s),
    brow(c, EYE_X[1], 1, s),
    el('path', { d: 'M299 370Q295 381 302 382', fill: 'none', stroke: c.skinShadow, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    mouth(expr, c),
    extras(expr),
  ].join('');
}

import { mix, shade } from '../../shared/color';
import { d, el } from '../../shared/svg';
import type { SvgBuilder } from '../builder';
import type { PortraitHairStyle, PortraitIdentity } from './identity';

type P = [number, number];

export interface HairColors {
  base: string;
  dark: string;
  light: string;
  line: string;
}

export function hairColors(hair: string, line: string): HairColors {
  return { base: hair, dark: mix(shade(hair, -0.3), '#3a3048', 0.18), light: shade(hair, 0.38), line };
}

/** Longueur des mèches latérales devant le visage. */
const SIDE_Y: Record<PortraitHairStyle, number> = {
  short: 382,
  bob: 468,
  long: 560,
  ponytail: 384,
  spiky: 372,
  twintails: 410,
};

/** Pointes de la frange (de droite à gauche) : [creux, pointe]. */
function fringe(style: PortraitHairStyle): { valleys: P[]; tips: P[] } {
  const spiky = style === 'spiky';
  const k = spiky ? 1.25 : 1;
  const tip = (x: number, y: number): P => [x, 240 + (y - 240) * k];
  return {
    valleys: [
      [392, 236],
      [356, 232],
      [318, 236],
      [282, 236],
      [246, 232],
      [210, 236],
    ],
    tips: [tip(376, 302), tip(338, 292), tip(302, 306), tip(264, 292), tip(226, 302)],
  };
}

/** Contour de la chevelure avant (calotte + frange + mèches latérales). */
export function frontHairPath(style: PortraitHairStyle): string {
  const side = SIDE_Y[style];
  const { valleys, tips } = fringe(style);
  const long = style === 'long';
  const out: string[] = [];
  out.push(d('M', 194, side));
  if (style === 'spiky') {
    out.push(d('L', 176, 330, 'L', 186, 300, 'L', 162, 268, 'L', 184, 240, 'L', 170, 200, 'L', 200, 186, 'L', 206, 140, 'L', 244, 158));
    out.push(d('L', 262, 112, 'L', 292, 146, 'L', 318, 100, 'L', 340, 146, 'L', 378, 118, 'L', 382, 160, 'L', 420, 158));
    out.push(d('L', 412, 196, 'L', 438, 226, 'L', 416, 250, 'L', 440, 280, 'L', 414, 302, 'L', 424, 334, 'L', 406, side));
  } else {
    const bulge = long ? 150 : style === 'bob' ? 168 : 172;
    out.push(d('C', long ? 150 : 172, side - 90, bulge, 180, 300, 136));
    out.push(d('C', 600 - bulge, 180, long ? 450 : 428, side - 90, 406, side));
  }
  // Bord intérieur droit, remontant le long du visage.
  const sideTip = style === 'bob' ? 396 : 402;
  out.push(d('Q', sideTip, side - 70, 398, 286));
  out.push(d('Q', 396, 256, (valleys[0] as P)[0], (valleys[0] as P)[1]));
  for (let i = 0; i < tips.length; i++) {
    const a = valleys[i] as P;
    const t = tips[i] as P;
    const c = valleys[i + 1] as P;
    const lean = (300 - t[0]) * 0.08;
    out.push(d('Q', (a[0] + t[0]) / 2 + lean, (a[1] + t[1]) / 2 + 6, t[0], t[1]));
    out.push(d('Q', (t[0] + c[0]) / 2 + lean * 0.5, (t[1] + c[1]) / 2 - 4, c[0], c[1]));
  }
  out.push(d('Q', 204, 256, 202, 286));
  out.push(d('Q', style === 'bob' ? 204 : 198, side - 70, 194, side));
  return `${out.join('')}Z`;
}

/** Volume arrière de la tête (derrière le visage). */
export function backHeadPath(style: PortraitHairStyle): string {
  if (style === 'bob' || style === 'long') {
    const bottom = style === 'bob' ? 486 : 520;
    const w = style === 'bob' ? 16 : 0;
    return d(
      'M', 178 - w, 300,
      'C', 160, 120, 440, 120, 422 + w, 300,
      'C', 428 + w, 360, 426 + w, 420, 410 + w, bottom,
      'L', 190 - w, bottom,
      'C', 174 - w, 420, 172 - w, 360, 178 - w, 300, 'Z',
    );
  }
  return 'M178 300C160 120 440 120 422 300C426 340 420 372 400 392C360 410 240 410 200 392C180 372 174 340 178 300Z';
}

/** Cheveux derrière le corps : cheveux longs, queue-de-cheval, couettes. */
export function drawBackHair(b: SvgBuilder, id: PortraitIdentity, c: HairColors): string {
  const fill = b.lin([
    [0, c.base],
    [1, c.dark],
  ]);
  const line = b.line(1.2, c.line);
  switch (id.hairStyle) {
    case 'long':
      return el('path', { d: 'M178 300C150 420 140 600 156 790C230 812 370 812 444 790C460 600 450 420 422 300Z', fill, ...line });
    case 'ponytail':
      return el('path', {
        d: 'M388 188C470 190 500 280 488 380C478 470 500 560 470 640C452 600 440 540 436 480C432 400 440 300 380 250Z',
        fill,
        ...line,
      });
    case 'twintails': {
      const tail = (dir: number) => {
        const x = (v: number) => 300 + dir * v;
        return el('path', {
          d: d('M', x(110), 214, 'C', x(190), 230, x(230), 360, x(214), 480, 'C', x(204), 580, x(226), 660, x(196), 740, 'C', x(170), 660, x(150), 580, x(148), 480, 'C', x(146), 380, x(140), 290, x(96), 250, 'Z'),
          fill,
          ...line,
        });
      };
      return tail(-1) + tail(1);
    }
    default:
      return '';
  }
}

/** Reflet « anneau de lumière » : croissants fins le long d'un arc au sommet du crâne. */
function shineRing(): string {
  const at = (t: number): P => {
    const u = 1 - t;
    return [u * u * 204 + 2 * u * t * 300 + t * t * 396, u * u * 220 + 2 * u * t * 170 + t * t * 220];
  };
  const segments: [number, number, number][] = [
    [0.1, 0.27, 7],
    [0.33, 0.58, 9],
    [0.64, 0.78, 7],
    [0.83, 0.9, 5],
  ];
  return segments
    .map(([t0, t1, thick]) => {
      const a = at(t0);
      const m = at((t0 + t1) / 2);
      const e = at(t1);
      return d('M', a[0], a[1], 'Q', m[0], m[1] - thick, e[0], e[1], 'Q', m[0], m[1] + thick * 0.6, a[0], a[1], 'Z');
    })
    .join('');
}

/** Frange, mèches, reflets et accessoire de tête. */
export function drawFrontHair(b: SvgBuilder, id: PortraitIdentity, c: HairColors): string {
  const path = frontHairPath(id.hairStyle);
  const clip = b.id('hair');
  b.def(el('clipPath', { id: clip }, el('path', { d: path })));
  const fill = b.lin([
    [0, shade(c.base, 0.12)],
    [0.55, c.base],
    [1, shade(c.base, -0.15)],
  ]);
  const { tips } = fringe(id.hairStyle);
  const strands = tips
    .map(([x, y]) => d('M', 300 + (x - 300) * 0.3, 150, 'Q', 300 + (x - 300) * 0.8, 200, x, y - 16))
    .join('');
  const { valleys } = fringe(id.hairStyle);
  const inner = valleys
    .slice(1, -1)
    .map(([x, y], i) => d('M', x - 9, y, 'Q', x - 2, y + 30, x + (i % 2 ? 4 : -4), y + 46, 'Q', x + 4, y + 26, x + 9, y, 'Z'))
    .join('');
  const parts = [
    el('path', { d: inner, fill: c.dark }),
    el('path', { d: path, fill, ...b.line(1.2, c.line) }),
    el('g', { 'clip-path': `url(#${clip})` }, [
      el('path', { d: strands, fill: 'none', stroke: c.dark, 'stroke-width': 3, opacity: 0.55, 'stroke-linecap': 'round' }),
      el('path', { d: 'M196 330C206 280 212 250 226 232', fill: 'none', stroke: c.dark, 'stroke-width': 10, opacity: 0.35 }),
      el('path', { d: 'M404 330C394 280 388 250 374 232', fill: 'none', stroke: c.dark, 'stroke-width': 10, opacity: 0.35 }),
      el('path', { d: shineRing(), fill: c.light, opacity: 0.55 }),
    ]),
  ];
  if (id.hairStyle === 'twintails' || id.hairStyle === 'ponytail') {
    const ties: P[] = id.hairStyle === 'twintails' ? [[196, 222], [404, 222]] : [[392, 196]];
    for (const [x, y] of ties) {
      parts.push(el('circle', { cx: x, cy: y, r: 13, fill: id.accent, ...b.line(0.8, c.line) }));
      parts.push(el('circle', { cx: x - 4, cy: y - 4, r: 4, fill: '#ffffff', opacity: 0.6 }));
    }
  }
  parts.push(accessory(b, id, c));
  return parts.join('');
}

function accessory(b: SvgBuilder, id: PortraitIdentity, c: HairColors): string {
  const a = id.accent;
  const line = b.line(0.8, c.line);
  switch (id.accessory) {
    case 'clip':
      return (
        el('rect', { x: 356, y: 222, width: 40, height: 11, rx: 5.5, fill: a, transform: 'rotate(-28 376 227)', ...line }) +
        el('rect', { x: 356, y: 222, width: 40, height: 11, rx: 5.5, fill: shade(a, 0.2), transform: 'rotate(22 376 227)', ...line })
      );
    case 'ribbon':
      return (
        el('path', { d: 'M396 170L360 146L364 196Z', fill: a, ...line }) +
        el('path', { d: 'M396 170L432 146L428 196Z', fill: shade(a, -0.15), ...line }) +
        el('circle', { cx: 396, cy: 170, r: 9, fill: shade(a, 0.15), ...line })
      );
    case 'headband':
      return el('path', { d: 'M196 246C200 150 400 150 404 246', fill: 'none', stroke: a, 'stroke-width': 13, 'stroke-linecap': 'round' });
    default:
      return '';
  }
}

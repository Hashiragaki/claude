import { mix, outlineOf, shade } from '../shared/color';
import { regularPolygon, starPoints } from '../shared/geometry';
import { d, el, points, type Attrs } from '../shared/svg';
import { SvgBuilder, type SvgStyle } from './builder';

export const OBJECTS = [
  'potion',
  'sword',
  'key',
  'gem',
  'scroll',
  'coin',
  'shield',
  'book',
  'heart',
  'ring',
  'bomb',
  'chest',
  'staff',
  'mushroom',
] as const;
export type ObjectName = (typeof OBJECTS)[number];

export const OBJECT_WORDS: Record<ObjectName, readonly string[]> = {
  potion: ['potion', 'fiole', 'flask', 'elixir', 'philtre', 'flacon'],
  sword: ['epee', 'sword', 'lame', 'blade', 'sabre', 'katana', 'arme', 'weapon'],
  key: ['cle', 'clef', 'key'],
  gem: [
    'gemme',
    'gem',
    'cristal',
    'crystal',
    'diamant',
    'diamond',
    'rubis',
    'ruby',
    'emeraude',
    'emerald',
    'saphir',
    'sapphire',
    'joyau',
    'jewel',
  ],
  scroll: ['parchemin', 'scroll', 'rouleau', 'carte', 'map', 'lettre', 'letter', 'quete', 'quest'],
  coin: ['piece', 'coin', 'monnaie', 'money', 'or', 'gold'],
  shield: ['bouclier', 'shield', 'ecu', 'defense'],
  book: ['livre', 'book', 'grimoire', 'tome', 'journal'],
  heart: ['coeur', 'heart', 'vie', 'life', 'sante', 'health', 'amour', 'love'],
  ring: ['anneau', 'bague', 'ring'],
  bomb: ['bombe', 'bomb', 'explosif', 'explosive'],
  chest: ['coffre', 'chest', 'tresor', 'treasure', 'butin', 'loot'],
  staff: ['baton', 'staff', 'sceptre', 'wand', 'baguette', 'magie', 'magic'],
  mushroom: ['champignon', 'mushroom'],
};

export const OBJECT_COLORS: Record<ObjectName, string> = {
  potion: '#e0344a',
  sword: '#6a4ab0',
  key: '#f0bd3c',
  gem: '#2f8ae8',
  scroll: '#c0303a',
  coin: '#f0bd3c',
  shield: '#b8323c',
  book: '#8a2a4a',
  heart: '#e8344a',
  ring: '#2fb0a0',
  bomb: '#3a3f60',
  chest: '#a86d3c',
  staff: '#8a4ae0',
  mushroom: '#d83838',
};

const GOLD = ['#9a5a14', '#e0a22c', '#ffe08a'] as const;
const STEEL = ['#5a6280', '#b8c2d8', '#f4f8ff'] as const;
const WOOD = ['#5a3420', '#9a6238', '#c89058'] as const;

interface Ctx {
  b: SvgBuilder;
  c: string;
  line: Attrs;
}

const tri = (
  b: SvgBuilder,
  [dark, mid, light]: readonly string[],
  dir: [number, number, number, number] = [0, 0, 1, 1],
) =>
  b.lin(
    [
      [0, light as string],
      [0.45, mid as string],
      [1, dark as string],
    ],
    dir,
  );

const ramp3 = (c: string): [string, string, string] => [shade(c, -0.4), c, shade(c, 0.4)];

function sparkle(x: number, y: number, r: number, color = '#ffffff'): string {
  return el('path', {
    d: d('M', x, y - r, 'Q', x, y, x + r, y, 'Q', x, y, x, y + r, 'Q', x, y, x - r, y, 'Q', x, y, x, y - r, 'Z'),
    fill: color,
  });
}

function shine(x1: number, y1: number, x2: number, y2: number, w = 9): string {
  return el('path', {
    d: d('M', x1, y1, 'Q', (x1 + x2) / 2 - 6, (y1 + y2) / 2 - 6, x2, y2),
    fill: 'none',
    stroke: '#ffffff',
    'stroke-width': w,
    'stroke-linecap': 'round',
    opacity: 0.8,
  });
}

const DRAW: Record<ObjectName, (x: Ctx) => string> = {
  potion: ({ b, c, line }) =>
    [
      el('circle', {
        cx: 128,
        cy: 160,
        r: 74,
        fill: b.lin([
          [0, '#eef8ff'],
          [1, '#b8d0e4'],
        ]),
        opacity: 0.9,
        ...line,
      }),
      el('path', { d: 'M60 170A70 70 0 0 0 196 170C196 150 60 150 60 170Z', fill: tri(b, ramp3(c), [0, 0, 0.6, 1]) }),
      el('path', { d: 'M62 166Q128 150 194 166Q128 184 62 166Z', fill: shade(c, 0.3) }),
      el('circle', { cx: 150, cy: 196, r: 7, fill: '#ffffff', opacity: 0.5 }),
      el('circle', { cx: 120, cy: 210, r: 5, fill: '#ffffff', opacity: 0.4 }),
      el('rect', {
        x: 104,
        y: 56,
        width: 48,
        height: 40,
        fill: b.lin([
          [0, '#eef8ff'],
          [1, '#c4d8ea'],
        ]),
        ...line,
      }),
      el('rect', { x: 96, y: 26, width: 64, height: 36, rx: 8, fill: tri(b, WOOD), ...line }),
      el('path', { d: 'M104 40H152', stroke: WOOD[0], 'stroke-width': 3, opacity: 0.6 }),
      shine(86, 150, 104, 116, 10),
      sparkle(190, 110, 12),
    ].join(''),
  sword: ({ b, c, line }) =>
    [
      el('path', { d: 'M104 146L200 34L226 30L222 56L110 152Z', fill: tri(b, STEEL, [0, 0, 1, 0]), ...line }),
      el('path', { d: 'M110 142L214 40', stroke: STEEL[0], 'stroke-width': 3, opacity: 0.6 }),
      el('path', { d: 'M70 130L126 186', stroke: GOLD[0], 'stroke-width': 26, 'stroke-linecap': 'round' }),
      el('path', { d: 'M70 130L126 186', stroke: GOLD[1], 'stroke-width': 18, 'stroke-linecap': 'round' }),
      el('path', { d: 'M96 164L52 208', stroke: shade(c, -0.3), 'stroke-width': 22, 'stroke-linecap': 'round' }),
      el('path', {
        d: 'M96 164L52 208',
        stroke: c,
        'stroke-width': 14,
        'stroke-linecap': 'round',
        'stroke-dasharray': '8 5',
      }),
      el('circle', { cx: 44, cy: 216, r: 17, fill: tri(b, GOLD), ...line }),
      el('circle', { cx: 44, cy: 216, r: 7, fill: shade(c, 0.3) }),
      el('circle', { cx: 98, cy: 158, r: 8, fill: c, ...line }),
      sparkle(196, 48, 14),
    ].join(''),
  key: ({ b, line }) =>
    [
      el('circle', { cx: 80, cy: 80, r: 50, fill: tri(b, GOLD), ...line }),
      el('circle', { cx: 80, cy: 80, r: 24, fill: 'none', stroke: GOLD[0], 'stroke-width': 6 }),
      el('path', {
        d:
          points(starPoints(80, 80, 16, 7, 4, -45))
            .replace(/^/, 'M')
            .replace(/ /g, 'L') + 'Z',
        fill: GOLD[0],
      }),
      el('path', { d: 'M108 112L212 216', stroke: GOLD[0], 'stroke-width': 28, 'stroke-linecap': 'round' }),
      el('path', { d: 'M108 112L212 216', stroke: GOLD[1], 'stroke-width': 18, 'stroke-linecap': 'round' }),
      el('path', { d: 'M168 172L146 194L160 208L182 186ZM196 200L178 218L190 230L208 212Z', fill: GOLD[1], ...line }),
      shine(52, 70, 70, 46, 8),
      sparkle(200, 150, 12),
    ].join(''),
  gem: ({ b, c }) => {
    const [dark, mid, light] = ramp3(c);
    const outline = outlineOf(c);
    return [
      el('path', {
        d: 'M40 100L84 50H172L216 100L128 222Z',
        fill: mid,
        stroke: outline,
        'stroke-width': 4,
        'stroke-linejoin': 'round',
      }),
      el('path', { d: 'M84 50L104 100H152L172 50Z', fill: light }),
      el('path', { d: 'M40 100L84 50L104 100Z', fill: shade(c, 0.2) }),
      el('path', { d: 'M216 100L172 50L152 100Z', fill: shade(c, -0.15) }),
      el('path', { d: 'M40 100H104L128 222Z', fill: shade(c, 0.1) }),
      el('path', { d: 'M104 100H152L128 222Z', fill: mid }),
      el('path', { d: 'M152 100H216L128 222Z', fill: dark }),
      el('path', { d: 'M40 100H216', stroke: shade(c, 0.45), 'stroke-width': 3 }),
      el('path', { d: 'M92 60L110 60L98 86Z', fill: '#ffffff', opacity: 0.8 }),
      sparkle(190, 64, 16),
      sparkle(64, 180, 9),
      el('circle', { cx: 128, cy: 136, r: 110, fill: b.glow(c, 0.25) }),
    ].join('');
  },
  scroll: ({ b, c, line }) => {
    const paper = ['#b89868', '#ecd9a8', '#fff6dc'] as const;
    return [
      el('rect', { x: 62, y: 60, width: 132, height: 140, fill: tri(b, paper, [0, 0, 1, 0]), ...line }),
      el('path', {
        d: 'M84 96H172M84 118H164M84 140H172M84 162H140',
        stroke: paper[0],
        'stroke-width': 5,
        'stroke-linecap': 'round',
        opacity: 0.7,
      }),
      el('rect', { x: 44, y: 40, width: 168, height: 34, rx: 17, fill: tri(b, paper, [0, 0, 0, 1]), ...line }),
      el('rect', { x: 44, y: 186, width: 168, height: 34, rx: 17, fill: tri(b, paper, [0, 0, 0, 1]), ...line }),
      el('ellipse', { cx: 50, cy: 57, rx: 8, ry: 17, fill: paper[0] }),
      el('ellipse', { cx: 50, cy: 203, rx: 8, ry: 17, fill: paper[0] }),
      el('path', { d: 'M150 178L140 226L156 214L166 228L170 178Z', fill: shade(c, -0.1), ...line }),
      el('circle', { cx: 158, cy: 176, r: 20, fill: tri(b, ramp3(c)), ...line }),
      el('path', {
        d:
          points(starPoints(158, 176, 10, 4, 5))
            .replace(/^/, 'M')
            .replace(/ /g, 'L') + 'Z',
        fill: shade(c, -0.35),
      }),
    ].join('');
  },
  coin: ({ b, c, line }) => {
    const g = c === '#f0bd3c' ? GOLD : ramp3(c);
    return [
      el('ellipse', { cx: 138, cy: 136, rx: 92, ry: 96, fill: g[0], ...line }),
      el('circle', { cx: 128, cy: 128, r: 92, fill: tri(b, g), ...line }),
      el('circle', { cx: 128, cy: 128, r: 70, fill: 'none', stroke: g[0], 'stroke-width': 6, opacity: 0.6 }),
      el('path', {
        d:
          points(starPoints(128, 128, 44, 18, 5))
            .replace(/^/, 'M')
            .replace(/ /g, 'L') + 'Z',
        fill: g[1] as string,
        stroke: g[0],
        'stroke-width': 5,
        'stroke-linejoin': 'round',
      }),
      shine(62, 110, 96, 58, 11),
      sparkle(200, 60, 15),
    ].join('');
  },
  shield: ({ b, c, line }) =>
    [
      el('path', {
        d: 'M128 20L216 48V120C216 176 176 214 128 236C80 214 40 176 40 120V48Z',
        fill: tri(b, STEEL),
        ...line,
      }),
      el('path', { d: 'M128 42L196 64V120C196 164 166 196 128 214C90 196 60 164 60 120V64Z', fill: tri(b, ramp3(c)) }),
      el('path', { d: 'M116 70H140V116H182V140H140V196H116V140H74V116H116Z', fill: tri(b, GOLD), ...line }),
      ...[
        [128, 32],
        [56, 58],
        [200, 58],
        [56, 140],
        [200, 140],
      ].map(([x, y]) => el('circle', { cx: x, cy: y, r: 6, fill: STEEL[2], ...line })),
      shine(70, 150, 72, 80, 9),
    ].join(''),
  book: ({ b, c, line }) =>
    [
      el('path', { d: 'M60 40H196V216H60Z', fill: '#f4ead0', ...line }),
      el('path', { d: 'M184 50V206', stroke: '#c8b890', 'stroke-width': 4 }),
      el('rect', { x: 44, y: 30, width: 144, height: 196, rx: 10, fill: tri(b, ramp3(c)), ...line }),
      el('rect', { x: 44, y: 30, width: 26, height: 196, rx: 8, fill: shade(c, -0.3) }),
      el('rect', { x: 86, y: 60, width: 88, height: 136, rx: 8, fill: 'none', stroke: GOLD[1], 'stroke-width': 5 }),
      el('path', {
        d:
          points(regularPolygon(130, 128, 26, 6))
            .replace(/^/, 'M')
            .replace(/ /g, 'L') + 'Z',
        fill: tri(b, GOLD),
        ...line,
      }),
      el('circle', { cx: 130, cy: 128, r: 12, fill: shade(c, 0.5), ...line }),
      ...[
        [70, 36],
        [174, 36],
        [70, 212],
        [174, 212],
      ].map(([x, y]) =>
        el('path', {
          d: d('M', x, y, 'h', 16, 'l', -16, 16, 'Z'),
          fill: GOLD[1],
          transform: x > 100 ? `rotate(90 ${x} ${y})` : undefined,
        }),
      ),
      sparkle(200, 40, 12),
    ].join(''),
  heart: ({ b, c, line }) =>
    [
      el('path', {
        d: 'M128 222C60 170 26 130 30 90C34 50 76 32 104 48C116 55 124 64 128 74C132 64 140 55 152 48C180 32 222 50 226 90C230 130 196 170 128 222Z',
        fill: b.rad(
          [
            [0, shade(c, 0.35)],
            [0.6, c],
            [1, shade(c, -0.35)],
          ],
          { cx: 0.35, cy: 0.3, r: 0.8 },
        ),
        ...line,
      }),
      shine(62, 110, 84, 66, 12),
      el('circle', { cx: 94, cy: 58, r: 6, fill: '#ffffff', opacity: 0.8 }),
      sparkle(200, 190, 12),
    ].join(''),
  ring: ({ b, c, line }) =>
    [
      el('ellipse', { cx: 128, cy: 156, rx: 78, ry: 70, fill: 'none', stroke: GOLD[0], 'stroke-width': 30 }),
      el('ellipse', { cx: 128, cy: 156, rx: 78, ry: 70, fill: 'none', stroke: tri(b, GOLD), 'stroke-width': 22 }),
      el('path', { d: 'M96 84L108 58H148L160 84L128 110Z', fill: tri(b, ramp3(c)), ...line }),
      el('path', { d: 'M108 58L118 84H138L148 58Z', fill: shade(c, 0.35) }),
      el('path', { d: 'M88 88H168', stroke: GOLD[1], 'stroke-width': 10, 'stroke-linecap': 'round' }),
      sparkle(170, 50, 13),
      shine(70, 170, 70, 130, 7),
    ].join(''),
  bomb: ({ b, c, line }) =>
    [
      el('circle', {
        cx: 118,
        cy: 150,
        r: 84,
        fill: b.rad(
          [
            [0, shade(c, 0.45)],
            [0.5, c],
            [1, shade(c, -0.4)],
          ],
          { cx: 0.35, cy: 0.3, r: 0.8 },
        ),
        ...line,
      }),
      el('rect', {
        x: 138,
        y: 54,
        width: 44,
        height: 34,
        rx: 6,
        fill: tri(b, STEEL),
        transform: 'rotate(35 160 71)',
        ...line,
      }),
      el('path', {
        d: 'M172 58Q186 30 210 36',
        fill: 'none',
        stroke: '#c8a870',
        'stroke-width': 7,
        'stroke-linecap': 'round',
      }),
      el('circle', { cx: 212, cy: 34, r: 22, fill: b.glow('#ffb040', 0.9) }),
      sparkle(212, 34, 16, '#ffe060'),
      sparkle(212, 34, 8, '#ffffff'),
      shine(66, 140, 90, 94, 12),
    ].join(''),
  chest: ({ b, c, line }) => {
    const wood = c === OBJECT_COLORS.chest ? WOOD : ramp3(c);
    return [
      el('ellipse', { cx: 128, cy: 222, rx: 100, ry: 12, fill: '#1a1024', opacity: 0.2 }),
      el('rect', { x: 30, y: 110, width: 196, height: 106, rx: 6, fill: tri(b, wood, [0, 0, 0, 1]), ...line }),
      el('path', { d: 'M30 110C30 50 226 50 226 110Z', fill: tri(b, wood, [0, 0, 0, 1]), ...line }),
      el('path', { d: 'M40 160H216M40 190H216', stroke: wood[0], 'stroke-width': 3, opacity: 0.5 }),
      ...[48, 208].map((x) => el('rect', { x: x - 10, y: 62, width: 20, height: 154, fill: tri(b, GOLD), ...line })),
      el('rect', { x: 30, y: 104, width: 196, height: 16, fill: tri(b, GOLD), ...line }),
      el('rect', { x: 108, y: 110, width: 40, height: 48, rx: 6, fill: tri(b, GOLD), ...line }),
      el('path', { d: 'M128 126V144', stroke: '#3a2a1a', 'stroke-width': 6, 'stroke-linecap': 'round' }),
      sparkle(190, 60, 13),
    ].join('');
  },
  staff: ({ b, c, line }) =>
    [
      el('path', { d: 'M70 226L166 86', stroke: WOOD[0], 'stroke-width': 18, 'stroke-linecap': 'round' }),
      el('path', { d: 'M70 226L166 86', stroke: WOOD[1], 'stroke-width': 10, 'stroke-linecap': 'round' }),
      el('path', {
        d: 'M150 104C130 80 136 50 160 40M184 106C204 84 204 56 186 40',
        fill: 'none',
        stroke: tri(b, GOLD),
        'stroke-width': 10,
        'stroke-linecap': 'round',
      }),
      el('circle', { cx: 172, cy: 70, r: 64, fill: b.glow(c, 0.7) }),
      el('circle', {
        cx: 172,
        cy: 70,
        r: 28,
        fill: b.rad(
          [
            [0, '#ffffff'],
            [0.4, shade(c, 0.3)],
            [1, c],
          ],
          { cx: 0.35, cy: 0.35 },
        ),
        ...line,
      }),
      sparkle(212, 30, 12),
      sparkle(128, 40, 8),
      sparkle(220, 110, 7),
    ].join(''),
  mushroom: ({ b, c, line }) =>
    [
      el('ellipse', { cx: 128, cy: 222, rx: 70, ry: 10, fill: '#1a1024', opacity: 0.2 }),
      el('path', {
        d: 'M96 130C92 170 88 200 96 220H160C168 200 164 170 160 130Z',
        fill: b.lin(
          [
            [0, '#fff8ec'],
            [1, '#e0cfb0'],
          ],
          [0, 0, 1, 0],
        ),
        ...line,
      }),
      el('path', {
        d: 'M24 136C24 70 72 30 128 30C184 30 232 70 232 136C232 150 24 150 24 136Z',
        fill: b.rad(
          [
            [0, shade(c, 0.35)],
            [0.6, c],
            [1, shade(c, -0.35)],
          ],
          { cx: 0.35, cy: 0.3, r: 0.8 },
        ),
        ...line,
      }),
      ...[
        [78, 84, 18],
        [144, 60, 14],
        [184, 104, 16],
        [118, 112, 10],
      ].map(([x, y, r]) => el('circle', { cx: x, cy: y, r, fill: '#fff8ec' })),
      el('path', {
        d: 'M40 136Q128 154 216 136',
        fill: 'none',
        stroke: shade(c, -0.4),
        'stroke-width': 4,
        opacity: 0.6,
      }),
    ].join(''),
};

export interface ObjectOptions {
  object: ObjectName;
  color?: string;
  style: SvgStyle;
  width: number;
  height: number;
  icon: boolean;
}

/** Objet d'inventaire illustré (256 × 256 de conception, fond transparent ; halo pour les icônes). */
export function drawObject(opts: ObjectOptions): string {
  const c = opts.color ?? OBJECT_COLORS[opts.object];
  const lineColor = outlineOf(c);
  const b = new SvgBuilder(opts.style, lineColor, 'o');
  if (opts.icon) b.e('circle', { cx: 128, cy: 128, r: 124, fill: b.glow(mix(c, '#ffffff', 0.5), 0.45) });
  b.add(DRAW[opts.object]({ b, c: b.c(c), line: { ...b.line(1.3, lineColor) } }));
  return b.toSvg(opts.width, opts.height, [0, 0, 256, 256]);
}

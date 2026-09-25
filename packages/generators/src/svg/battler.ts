import type { Rng } from '@forge/core';
import { mix, outlineOf, shade } from '../shared/color';
import { d, el, type Attrs } from '../shared/svg';
import { SvgBuilder, type SvgStyle } from './builder';

export const CREATURES = ['slime', 'bat', 'golem', 'wolf', 'ghost', 'plant'] as const;
export type Creature = (typeof CREATURES)[number];

export const CREATURE_COLORS: Record<Creature, string> = {
  slime: '#4cc46a',
  bat: '#7a58b0',
  golem: '#8a90a8',
  wolf: '#8a9ab8',
  ghost: '#c8dcff',
  plant: '#4caa4a',
};

interface Ctx {
  b: SvgBuilder;
  c: string;
  dark: string;
  light: string;
  line: Attrs;
  rng: Rng;
}

function body(ctx: Ctx, cx = 0.38, cy = 0.3): string {
  return ctx.b.rad(
    [
      [0, ctx.light],
      [0.55, ctx.c],
      [1, ctx.dark],
    ],
    { cx, cy, r: 0.8 },
  );
}

/** Grands yeux brillants. */
function eyes(
  ctx: Ctx,
  x1: number,
  x2: number,
  y: number,
  r: number,
  iris = '#2a1a2a',
  angry = false,
): string {
  const one = (x: number, dir: number) =>
    el('ellipse', { cx: x, cy: y, rx: r * 0.8, ry: r, fill: iris }) +
    el('circle', { cx: x - r * 0.3, cy: y - r * 0.4, r: r * 0.32, fill: '#ffffff' }) +
    el('circle', { cx: x + r * 0.25, cy: y + r * 0.35, r: r * 0.14, fill: '#ffffff', opacity: 0.9 }) +
    (angry
      ? el('path', {
          d: d('M', x - r * 1.1 * dir, y - r * 1.5, 'L', x + r * 0.9 * dir, y - r * 0.8),
          stroke: '#2a1a2a',
          'stroke-width': 5,
          'stroke-linecap': 'round',
        })
      : '');
  return one(x1, -1) + one(x2, 1);
}

function blush(x1: number, x2: number, y: number, r = 12): string {
  return (
    el('ellipse', { cx: x1, cy: y, rx: r, ry: r * 0.55, fill: '#ff7a9a', opacity: 0.45 }) +
    el('ellipse', { cx: x2, cy: y, rx: r, ry: r * 0.55, fill: '#ff7a9a', opacity: 0.45 })
  );
}

function groundShadow(rx = 82): string {
  return el('ellipse', { cx: 128, cy: 230, rx, ry: 12, fill: '#1a1024', opacity: 0.22 });
}

function slime(ctx: Ctx): string {
  const shape =
    'M28 206C28 146 70 96 110 84C119 80 123 68 128 54C133 68 137 80 146 84C186 96 228 146 228 206C228 234 28 234 28 206Z';
  return [
    groundShadow(92),
    el('path', { d: shape, fill: body(ctx, 0.35, 0.3), ...ctx.line }),
    el('path', {
      d: 'M52 200C60 214 196 214 204 200C200 222 56 222 52 200Z',
      fill: ctx.dark,
      opacity: 0.35,
    }),
    el('circle', { cx: 170, cy: 186, r: 10, fill: ctx.light, opacity: 0.5 }),
    el('circle', { cx: 186, cy: 164, r: 6, fill: ctx.light, opacity: 0.45 }),
    el('path', {
      d: 'M62 136C70 116 86 102 104 94',
      fill: 'none',
      stroke: '#ffffff',
      'stroke-width': 11,
      'stroke-linecap': 'round',
      opacity: 0.75,
    }),
    el('circle', { cx: 56, cy: 156, r: 6, fill: '#ffffff', opacity: 0.75 }),
    eyes(ctx, 100, 156, 152, 15),
    blush(82, 174, 178),
    el('path', {
      d: 'M118 180Q128 190 138 180',
      fill: 'none',
      stroke: '#2a1a2a',
      'stroke-width': 4,
      'stroke-linecap': 'round',
    }),
  ].join('');
}

function bat(ctx: Ctx): string {
  const wing = (dir: number) => {
    const x = (v: number) => 128 + dir * v;
    return el('path', {
      d: d(
        'M', x(30), 110, 'C', x(60), 70, x(100), 50, x(118), 56, 'C', x(112), 80, x(116), 100,
        x(124), 120, 'C', x(108), 116, x(98), 124, x(96), 138, 'C', x(84), 128, x(70), 130,
        x(64), 146, 'C', x(54), 134, x(42), 134, x(34), 142, 'Z'
      ),
      fill: shade(ctx.c, -0.15),
      ...ctx.line,
    });
  };
  const membrane = (dir: number) =>
    el('path', {
      d: d(
        'M', 128 + dir * 40, 116, 'L', 128 + dir * 110, 64, 'M', 128 + dir * 44, 124, 'L',
        128 + dir * 96, 136, 'M', 128 + dir * 42, 132, 'L', 128 + dir * 64, 144
      ),
      stroke: ctx.dark,
      'stroke-width': 3,
      opacity: 0.6,
    });
  return [
    groundShadow(50),
    wing(-1),
    wing(1),
    membrane(-1),
    membrane(1),
    el('path', { d: 'M94 84L90 44L116 76Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M162 84L166 44L140 76Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M97 76L95 56L108 72Z', fill: '#f0a0c0' }),
    el('path', { d: 'M159 76L161 56L148 72Z', fill: '#f0a0c0' }),
    el('circle', { cx: 128, cy: 124, r: 50, fill: body(ctx), ...ctx.line }),
    el('ellipse', { cx: 128, cy: 146, rx: 30, ry: 22, fill: mix(ctx.c, '#ffffff', 0.35), opacity: 0.8 }),
    eyes(ctx, 108, 148, 114, 11, '#e8b020'),
    el('ellipse', { cx: 108, cy: 115, rx: 3.5, ry: 8, fill: '#2a1a2a' }),
    el('ellipse', { cx: 148, cy: 115, rx: 3.5, ry: 8, fill: '#2a1a2a' }),
    el('path', { d: 'M114 138Q128 146 142 138', fill: 'none', stroke: '#2a1a2a', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    el('path', { d: 'M118 140L121 150L124 141ZM132 141L135 150L138 140Z', fill: '#ffffff' }),
    el('path', { d: 'M112 172L108 186M144 172L148 186', stroke: ctx.dark, 'stroke-width': 6, 'stroke-linecap': 'round' }),
  ].join('');
}

function golem(ctx: Ctx): string {
  const moss = '#5aa04a';
  const glow = '#5ae4ff';
  const rock = (path: string, k = 0) =>
    el('path', {
      d: path,
      fill: k ? shade(ctx.c, k) : body(ctx, 0.3, 0.25),
      ...ctx.line,
    });
  return [
    groundShadow(100),
    rock('M92 190L84 226L120 226L122 196Z', -0.15),
    rock('M164 190L172 226L136 226L134 196Z', -0.15),
    rock('M60 96C84 80 172 80 196 96L206 170C190 200 66 200 50 170Z'),
    rock('M20 110C24 92 52 88 62 102L70 168C60 186 30 184 24 168Z', -0.05),
    rock('M236 110C232 92 204 88 194 102L186 168C196 186 226 184 232 168Z', -0.05),
    rock('M92 44C104 32 152 32 164 44L170 90C150 104 106 104 86 90Z'),
    el('path', { d: 'M92 46C110 36 146 36 162 46L160 56C140 48 116 48 94 56Z', fill: moss }),
    el('path', { d: 'M62 98C88 86 168 86 194 98L192 110C166 100 90 100 64 110Z', fill: moss }),
    el('path', {
      d: 'M110 120L124 142L116 160M160 150L148 168M78 130L90 150',
      fill: 'none',
      stroke: ctx.dark,
      'stroke-width': 3.5,
      'stroke-linecap': 'round',
    }),
    el('circle', { cx: 128, cy: 140, r: 16, fill: ctx.b.glow(glow, 0.8) }),
    el('path', { d: 'M128 128L136 140L128 152L120 140Z', fill: glow }),
    el('circle', { cx: 110, cy: 70, r: 14, fill: ctx.b.glow(glow, 0.9) }),
    el('circle', { cx: 146, cy: 70, r: 14, fill: ctx.b.glow(glow, 0.9) }),
    el('ellipse', { cx: 110, cy: 70, rx: 7, ry: 5, fill: '#e8fcff' }),
    el('ellipse', { cx: 146, cy: 70, rx: 7, ry: 5, fill: '#e8fcff' }),
    el('path', {
      d: 'M40 116L52 122M212 118L200 124',
      stroke: ctx.light,
      'stroke-width': 4,
      'stroke-linecap': 'round',
      opacity: 0.8,
    }),
  ].join('');
}

function wolf(ctx: Ctx): string {
  const fur = mix(ctx.c, '#ffffff', 0.6);
  return [
    groundShadow(90),
    el('path', { d: 'M178 204C222 200 244 166 230 118C224 146 206 166 176 170Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M230 118C236 134 234 150 226 164C218 150 216 136 220 124Z', fill: fur }),
    el('path', { d: 'M70 214C58 170 70 132 128 124C186 132 198 170 186 214Z', fill: body(ctx, 0.4, 0.3), ...ctx.line }),
    el('path', {
      d: 'M102 150L112 164L120 152L128 168L136 152L144 164L154 150C160 176 158 200 156 214L100 214C98 200 96 176 102 150Z',
      fill: fur,
    }),
    el('path', {
      d: 'M84 214L86 196M104 216L104 198M152 216L152 198M172 214L170 196',
      stroke: ctx.dark,
      'stroke-width': 4,
      'stroke-linecap': 'round',
    }),
    el('path', { d: 'M78 70L70 10L118 52Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M178 70L186 10L138 52Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M82 62L78 26L104 52Z', fill: '#e8a0b0' }),
    el('path', { d: 'M174 62L178 26L152 52Z', fill: '#e8a0b0' }),
    el('path', {
      d: 'M58 100C58 62 90 44 128 44C166 44 198 62 198 100C198 110 212 116 214 124L192 126C188 142 176 150 162 154L128 158L94 154C80 150 68 142 64 126L42 124C44 116 58 110 58 100Z',
      fill: body(ctx, 0.4, 0.3),
      ...ctx.line,
    }),
    el('path', {
      d: 'M104 122C104 106 116 100 128 100C140 100 152 106 152 122L150 142C144 156 112 156 106 142Z',
      fill: fur,
      ...ctx.line,
    }),
    el('path', { d: 'M116 108Q128 100 140 108Q138 120 128 120Q118 120 116 108Z', fill: '#2a1a2a' }),
    el('ellipse', { cx: 124, cy: 106, rx: 4, ry: 2.5, fill: '#ffffff', opacity: 0.7 }),
    el('path', {
      d: 'M128 120V130M114 132Q128 142 142 132',
      fill: 'none',
      stroke: '#2a1a2a',
      'stroke-width': 3.5,
      'stroke-linecap': 'round',
    }),
    eyes(ctx, 96, 160, 88, 11, '#c8902a'),
    el('path', { d: 'M82 76L110 82M174 76L146 82', stroke: ctx.dark, 'stroke-width': 5, 'stroke-linecap': 'round' }),
  ].join('');
}

function ghost(ctx: Ctx): string {
  const fill = ctx.b.lin([
    [0, '#ffffff'],
    [0.6, ctx.c],
    [1, shade(ctx.c, -0.25)],
  ]);
  return [
    el('ellipse', { cx: 128, cy: 232, rx: 54, ry: 9, fill: '#1a1024', opacity: 0.15 }),
    el('circle', { cx: 128, cy: 120, r: 110, fill: ctx.b.glow(ctx.c, 0.35) }),
    el('path', {
      d: 'M54 118C54 60 88 30 128 30C168 30 202 60 202 118L204 196C192 206 184 188 172 200C160 212 152 190 140 202C128 214 118 192 106 204C94 214 86 192 74 204C62 212 54 200 52 196Z',
      fill,
      opacity: 0.94,
      ...ctx.line,
    }),
    el('path', { d: 'M54 130C34 132 26 150 36 162C44 150 52 146 58 148Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M202 130C222 132 230 150 220 162C212 150 204 146 198 148Z', fill: ctx.c, ...ctx.line }),
    el('path', { d: 'M78 76C86 58 100 48 114 44', fill: 'none', stroke: '#ffffff', 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85 }),
    eyes(ctx, 104, 152, 104, 14, '#2a2a4a'),
    el('path', { d: 'M114 136Q128 124 142 136Q142 158 128 160Q114 158 114 136Z', fill: '#3a2a4a' }),
    el('ellipse', { cx: 128, cy: 152, rx: 8, ry: 5, fill: '#e87a9a' }),
    blush(84, 172, 128, 11),
  ].join('');
}

function plant(ctx: Ctx): string {
  const leaf = (dir: number, k: number) =>
    el('path', {
      d: d(
        'M', 128, 216, 'C', 128 + dir * 30, 190 - k * 20, 128 + dir * 70, 170 - k * 30,
        128 + dir * (104 - k * 24), 150 - k * 34, 'C', 128 + dir * 96, 190 - k * 20,
        128 + dir * 60, 214, 128, 218, 'Z'
      ),
      fill: k ? shade(ctx.c, -0.2) : ctx.c,
      ...ctx.line,
    }) +
    el('path', {
      d: d(
        'M', 128 + dir * 10, 212, 'Q', 128 + dir * 60, 190 - k * 20,
        128 + dir * (98 - k * 24), 154 - k * 34
      ),
      fill: 'none',
      stroke: shade(ctx.c, 0.25),
      'stroke-width': 3,
      opacity: 0.7,
    });
  const mouth = '#c8304a';
  return [
    groundShadow(80),
    leaf(-1, 1),
    leaf(1, 1),
    el('path', {
      d: 'M122 214C112 180 104 150 122 120L136 120C124 150 132 180 138 214Z',
      fill: shade(ctx.c, -0.1),
      ...ctx.line,
    }),
    leaf(-1, 0),
    leaf(1, 0),
    el('path', {
      d: 'M52 96C52 52 88 26 128 26C168 26 204 52 204 96C204 134 170 148 128 148C86 148 52 134 52 96Z',
      fill: body(ctx, 0.4, 0.25),
      ...ctx.line,
    }),
    el('path', {
      d: 'M68 96C80 88 176 88 188 96C184 128 160 140 128 140C96 140 72 128 68 96Z',
      fill: mouth,
      ...ctx.line,
    }),
    el('path', {
      d: 'M72 96L80 108L88 96L96 108L104 96L112 108L120 96L128 108L136 96L144 108L152 96L160 108L168 96L176 108L184 96Z',
      fill: '#ffffff',
    }),
    el('ellipse', { cx: 128, cy: 126, rx: 24, ry: 9, fill: '#f08aa0' }),
    el('circle', { cx: 86, cy: 58, r: 7, fill: mix(ctx.c, '#ffff80', 0.5), opacity: 0.8 }),
    el('circle', { cx: 170, cy: 54, r: 9, fill: mix(ctx.c, '#ffff80', 0.5), opacity: 0.8 }),
    el('circle', { cx: 130, cy: 40, r: 6, fill: mix(ctx.c, '#ffff80', 0.5), opacity: 0.8 }),
    eyes(ctx, 104, 152, 66, 11, '#2a1a2a', true),
  ].join('');
}

const DRAW: Record<Creature, (ctx: Ctx) => string> = { slime, bat, golem, wolf, ghost, plant };

export interface BattlerOptions {
  creature: Creature;
  color?: string;
  style: SvgStyle;
  width: number;
  height: number;
}

/** Monstre de combat mignon (256 × 256 de conception, fond transparent). */
export function drawBattler(opts: BattlerOptions, rng: Rng): string {
  const c = opts.color ?? CREATURE_COLORS[opts.creature];
  const line = outlineOf(c);
  const b = new SvgBuilder(opts.style, line, 'm');
  const ctx: Ctx = { b, c: b.c(c), dark: shade(c, -0.35), light: shade(c, 0.35), line: b.line(1.2, line), rng };
  b.add(DRAW[opts.creature](ctx));
  return b.toSvg(opts.width, opts.height, [0, 0, 256, 256]);
}

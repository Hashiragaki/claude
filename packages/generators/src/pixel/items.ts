import type { Rng } from '@forge/core';
import { mix, ramp, shade } from '../shared/color';
import { box, capsule, custom, polygon, ring, sphere, Sprite, subtract } from './shapes';

/** Rampes de matériaux (sombre → clair) partagées par les sprites pixel-art. */
export const MATERIALS = {
  gold: ['#7a3f16', '#c47a24', '#f0bd3c', '#fff0a0'],
  steel: ['#3f4660', '#7c87a2', '#c3cbdb', '#f5f8fc'],
  wood: ['#4a2a1a', '#774526', '#a86d3c', '#d09a5c'],
  paper: ['#a88c62', '#d6c093', '#f1e3bb', '#fffbe8'],
  glass: ['#6d86a0', '#a7c2d6', '#dcedf5', '#ffffff'],
  leaf: ['#1e4f34', '#2e7f42', '#55b04c', '#a4dc6c'],
  cream: ['#a8875e', '#d8bf92', '#f2e2bf', '#fffaf0'],
  stone: ['#3e3c4e', '#6b6878', '#9c98a4', '#cdc8cc'],
} as const;

export const OUTLINE = '#1c1424';

export type Draw = (s: Sprite, main: string, rng: Rng) => void;

/** Rampe de 4 tons dont le 2e est la couleur de base (ombre, base, lumière, reflet). */
export const tones = (color: string): string[] => [shade(color, -0.42), color, shade(color, 0.18), shade(color, 0.45)];

const potion: Draw = (s, main) => {
  const liquid = tones(main);
  s.fill(sphere(0.5, 0.64, 0.33, 0.31), MATERIALS.glass);
  s.fill(subtract(sphere(0.5, 0.64, 0.3, 0.28), box(0, 0, 1, 0.52)), liquid);
  s.fill(box(0.39, 0.18, 0.61, 0.38), MATERIALS.glass);
  s.fill(box(0.35, 0.06, 0.65, 0.2, 0.03), MATERIALS.wood, { outlined: true });
  for (let u = 0.26; u <= 0.74; u += 1 / s.scale) s.dot(u, 0.53, liquid[3] as string);
  s.dot(0.32, 0.6, '#ffffff').dot(0.32, 0.68, '#ffffff').dot(0.36, 0.55, '#ffffff');
  s.dot(0.62, 0.76, liquid[3] as string);
};

const sword: Draw = (s, main) => {
  const bladeShape = polygon(
    [
      [0.3, 0.59],
      [0.77, 0.12],
      [0.92, 0.08],
      [0.88, 0.23],
      [0.41, 0.7],
    ],
    (u, v) => (u + v < 1 ? 0.95 : 0.55),
  );
  s.fill(bladeShape, MATERIALS.steel);
  const big = s.scale >= 20;
  s.fill(capsule(0.2, 0.56, 0.44, 0.8, 0.065), MATERIALS.gold, { outlined: big });
  s.fill(capsule(0.28, 0.72, 0.18, 0.82, 0.06), tones(main), { outlined: big });
  s.fill(sphere(0.13, 0.87, 0.085), MATERIALS.gold, { outlined: true });
  s.dot(0.82, 0.14, '#ffffff');
};

const shield: Draw = (s, main) => {
  const halfWidth = (v: number) => (v < 0.5 ? 0.38 : 0.38 * Math.sqrt(Math.max(0, 1 - ((v - 0.5) / 0.42) ** 2)));
  const outer = custom(
    (u, v) => v >= 0.1 && v <= 0.92 && Math.abs(u - 0.5) <= halfWidth(v),
    (u, v) => 0.8 - (u - 0.12) * 0.7 - v * 0.2,
  );
  const inner = custom(
    (u, v) => v >= 0.18 && v <= 0.84 && Math.abs(u - 0.5) <= halfWidth(v + 0.04) - 0.08,
    (u, v) => 0.85 - (u - 0.2) * 0.8 - v * 0.15,
  );
  s.fill(outer, MATERIALS.steel);
  s.fill(inner, tones(main));
  const emblem = MATERIALS.gold;
  s.fill(box(0.46, 0.26, 0.54, 0.72, 0, true), emblem);
  s.fill(box(0.3, 0.38, 0.7, 0.46, 0, true), emblem);
  s.dot(0.2, 0.2, '#ffffff');
};

const key: Draw = (s) => {
  const gold = MATERIALS.gold;
  s.fill(ring(0.28, 0.3, 0.2, 0.09), gold);
  s.fill(capsule(0.4, 0.42, 0.84, 0.86, 0.06), gold);
  s.fill(capsule(0.66, 0.68, 0.56, 0.78, 0.05), gold);
  s.fill(capsule(0.76, 0.78, 0.66, 0.88, 0.05), gold);
  s.dot(0.2, 0.18, '#ffffff');
};

const coin: Draw = (s, main) => {
  const gold = main === '#f0bd3c' ? MATERIALS.gold : tones(main);
  s.fill(sphere(0.5, 0.5, 0.42, 0.44), gold);
  s.fill(ring(0.5, 0.5, 0.33, 0.27, 1.05), [gold[1] as string, gold[1] as string, gold[2] as string, gold[2] as string]);
  s.fill(box(0.45, 0.3, 0.55, 0.7, 0, true), [gold[1] as string, gold[1] as string, gold[3] as string]);
  s.dot(0.3, 0.26, '#ffffff').dot(0.26, 0.32, gold[3] as string);
};

const gem: Draw = (s, main) => {
  const c = tones(main);
  const outline: [number, number][] = [
    [0.2, 0.36],
    [0.34, 0.16],
    [0.66, 0.16],
    [0.8, 0.36],
    [0.5, 0.88],
  ];
  s.fill(
    polygon(outline, (u, v) => {
      if (v < 0.36) return u < 0.4 ? 0.95 : u < 0.62 ? 0.7 : 0.45;
      return u < 0.5 ? 0.6 : 0.2;
    }),
    c,
  );
  s.line(0.2, 0.36, 0.8, 0.36, c[3] as string);
  s.dot(0.36, 0.24, '#ffffff').dot(0.4, 0.22, '#ffffff');
};

const heart: Draw = (s, main) => {
  const light = sphere(0.44, 0.44, 0.5);
  const lobeL = sphere(0.31, 0.37, 0.21);
  const lobeR = sphere(0.69, 0.37, 0.21);
  const tip = polygon([
    [0.1, 0.42],
    [0.9, 0.42],
    [0.5, 0.9],
  ]);
  const shape = custom((u, v) => lobeL.contains(u, v) || lobeR.contains(u, v) || tip.contains(u, v), light.light);
  s.fill(shape, tones(main));
  s.dot(0.24, 0.3, '#ffffff').dot(0.28, 0.26, '#ffffff').dot(0.24, 0.36, '#ffffff');
};

const scroll: Draw = (s, main) => {
  s.fill(box(0.2, 0.2, 0.8, 0.8, 0, true), MATERIALS.paper);
  s.fill(box(0.12, 0.1, 0.88, 0.24, 0.07), MATERIALS.paper, { outlined: true });
  s.fill(box(0.12, 0.76, 0.88, 0.9, 0.07), MATERIALS.paper, { outlined: true });
  const ink = MATERIALS.paper[0];
  for (let v = 0.34; v < 0.68; v += 0.1) s.line(0.3, v, v > 0.6 ? 0.55 : 0.7, v, ink);
  s.fill(sphere(0.62, 0.66, 0.08), tones(main), { outlined: true });
};

const mushroom: Draw = (s, main) => {
  s.fill(box(0.36, 0.5, 0.64, 0.9, 0.06), MATERIALS.cream);
  const cap = custom(
    (u, v) => v <= 0.56 && ((u - 0.5) / 0.44) ** 2 + ((v - 0.56) / 0.44) ** 2 <= 1,
    (u, v) => sphere(0.5, 0.56, 0.44).light(u, v),
  );
  s.fill(cap, tones(main), { outlined: true });
  const spot = MATERIALS.cream[3];
  s.fill(sphere(0.32, 0.36, 0.07), [spot]).fill(sphere(0.6, 0.26, 0.06), [spot]).fill(sphere(0.72, 0.44, 0.05), [spot]);
};

const apple: Draw = (s, main) => {
  const body = custom(
    (u, v) => sphere(0.5, 0.58, 0.38, 0.34).contains(u, v) && !sphere(0.5, 0.2, 0.1).contains(u, v),
    (u, v) => sphere(0.5, 0.58, 0.38, 0.34).light(u, v),
  );
  s.fill(body, tones(main));
  s.fill(capsule(0.5, 0.3, 0.55, 0.12, 0.035), MATERIALS.wood, { outlined: true });
  s.fill(sphere(0.66, 0.16, 0.1, 0.06), MATERIALS.leaf, { outlined: true });
  s.dot(0.3, 0.44, '#ffffff').dot(0.3, 0.5, '#ffffff');
};

const bomb: Draw = (s) => {
  s.fill(sphere(0.46, 0.6, 0.34), ['#1a1c2c', '#2c3150', '#4a5382', '#8a94c2']);
  s.fill(box(0.5, 0.18, 0.66, 0.32, 0.02), MATERIALS.steel, { outlined: true });
  s.line(0.6, 0.18, 0.72, 0.08, '#c8a870');
  s.dot(0.76, 0.06, '#ffe36a', false).dot(0.8, 0.08, '#ff8a2a', false).dot(0.74, 0.02, '#ff8a2a', false);
  s.dot(0.32, 0.48, '#ffffff');
};

const ringItem: Draw = (s, main) => {
  s.fill(ring(0.5, 0.62, 0.3, 0.18, 0.9), MATERIALS.gold);
  s.fill(polygon([
    [0.36, 0.3],
    [0.44, 0.16],
    [0.56, 0.16],
    [0.64, 0.3],
    [0.5, 0.44],
  ]), tones(main), { outlined: true });
  s.dot(0.45, 0.22, '#ffffff');
};

const book: Draw = (s, main) => {
  const cover = tones(main);
  s.fill(box(0.2, 0.14, 0.82, 0.86, 0.03, true), cover);
  s.fill(box(0.7, 0.18, 0.8, 0.82, 0, true), MATERIALS.cream);
  s.fill(box(0.2, 0.14, 0.3, 0.86, 0, true), [cover[0] as string, cover[1] as string]);
  s.fill(sphere(0.5, 0.46, 0.1), MATERIALS.gold, { outlined: true });
  s.line(0.34, 0.74, 0.62, 0.74, MATERIALS.gold[2]);
};

const staff: Draw = (s, main) => {
  s.fill(capsule(0.24, 0.9, 0.64, 0.34, 0.045), MATERIALS.wood);
  s.fill(ring(0.7, 0.26, 0.14, 0.07), MATERIALS.gold);
  s.fill(sphere(0.7, 0.26, 0.09), tones(main), { outlined: true });
  s.dot(0.67, 0.22, '#ffffff');
};

const chest: Draw = (s) => {
  s.fill(box(0.1, 0.42, 0.9, 0.86, 0.02, true), MATERIALS.wood);
  s.fill(box(0.1, 0.16, 0.9, 0.44, 0.1), MATERIALS.wood, { outlined: true });
  for (const u of [0.2, 0.8]) s.fill(box(u - 0.05, 0.16, u + 0.05, 0.86, 0, true), MATERIALS.gold, { outlined: true });
  s.fill(box(0.42, 0.36, 0.58, 0.56, 0.02, true), MATERIALS.gold, { outlined: true });
  s.dot(0.5, 0.48, OUTLINE);
};

const barrel: Draw = (s) => {
  const body = custom(
    (u, v) => v >= 0.1 && v <= 0.9 && Math.abs(u - 0.5) <= 0.3 + 0.06 * Math.sin(Math.PI * ((v - 0.1) / 0.8)),
    (u) => box(0.14, 0, 0.86, 1).light(u, 0.5),
  );
  s.fill(body, MATERIALS.wood);
  for (const v of [0.24, 0.72]) {
    s.fill(custom((u, vv) => body.contains(u, vv) && Math.abs(vv - v) < 0.045, (u) => 0.9 - u * 0.8), MATERIALS.steel);
  }
  s.fill(sphere(0.5, 0.12, 0.3, 0.05), [MATERIALS.wood[1], MATERIALS.wood[2]]);
};

const crate: Draw = (s) => {
  s.fill(box(0.12, 0.12, 0.88, 0.88, 0, true), MATERIALS.wood);
  const dark = MATERIALS.wood[0];
  s.line(0.2, 0.2, 0.8, 0.8, dark).line(0.8, 0.2, 0.2, 0.8, dark);
  s.fill(box(0.12, 0.12, 0.88, 0.2, 0, true), [MATERIALS.wood[2], MATERIALS.wood[3]], { outlined: true });
  s.fill(box(0.12, 0.8, 0.88, 0.88, 0, true), [MATERIALS.wood[1], MATERIALS.wood[2]], { outlined: true });
};

const torch: Draw = (s) => {
  s.fill(capsule(0.5, 0.46, 0.5, 0.9, 0.06), MATERIALS.wood);
  s.fill(box(0.4, 0.4, 0.6, 0.5, 0.02), MATERIALS.steel, { outlined: true });
  const flame = custom(
    (u, v) => v <= 0.4 && v >= 0.06 && Math.abs(u - 0.5) <= 0.16 * Math.sin(Math.PI * ((v - 0.06) / 0.36) ** 0.7),
    (u, v) => 1 - Math.abs(u - 0.5) * 3 - (0.4 - v) * 0.8,
  );
  s.fill(flame, ['#c2331f', '#f07a22', '#ffc646', '#fff6c0']);
};

const plant: Draw = (s) => {
  s.fill(polygon([
    [0.28, 0.6],
    [0.72, 0.6],
    [0.64, 0.92],
    [0.36, 0.92],
  ]), ['#6e3222', '#a4502e', '#cc7446', '#e89c6a']);
  s.fill(sphere(0.5, 0.38, 0.3, 0.26), MATERIALS.leaf, { outlined: true });
  s.fill(sphere(0.3, 0.5, 0.14), MATERIALS.leaf).fill(sphere(0.7, 0.48, 0.14), MATERIALS.leaf);
};

const slime: Draw = (s, main) => {
  const body = custom(
    (u, v) => v <= 0.9 && ((u - 0.5) / 0.42) ** 2 + ((v - 0.9) / 0.66) ** 2 <= 1,
    (u, v) => sphere(0.5, 0.78, 0.44, 0.5).light(u, v),
  );
  s.fill(body, tones(main));
  s.fill(box(0.34, 0.5, 0.42, 0.66, 0.03), [OUTLINE]).fill(box(0.58, 0.5, 0.66, 0.66, 0.03), [OUTLINE]);
  s.dot(0.36, 0.53, '#ffffff').dot(0.6, 0.53, '#ffffff');
  s.dot(0.24, 0.42, '#ffffff').dot(0.28, 0.38, '#ffffff');
};

const ghost: Draw = (s, main) => {
  const body = custom(
    (u, v) => {
      if (v < 0.45) return ((u - 0.5) / 0.36) ** 2 + ((v - 0.45) / 0.36) ** 2 <= 1;
      const wave = 0.86 + 0.05 * Math.sin((u - 0.14) * Math.PI * 5.5);
      return Math.abs(u - 0.5) <= 0.36 && v <= wave;
    },
    (u, v) => 0.95 - (u - 0.14) * 0.9 - v * 0.2,
  );
  s.fill(body, ramp(mix(main, '#ffffff', 0.7), 4, 0.35));
  s.fill(sphere(0.4, 0.42, 0.05, 0.08), [OUTLINE]).fill(sphere(0.6, 0.42, 0.05, 0.08), [OUTLINE]);
  s.fill(sphere(0.5, 0.6, 0.06, 0.05), [OUTLINE]);
};

const bat: Draw = (s, main) => {
  const c = tones(main);
  const wing = (dir: number) =>
    polygon(
      [
        [0.5 + dir * 0.06, 0.4],
        [0.5 + dir * 0.24, 0.26],
        [0.5 + dir * 0.46, 0.3],
        [0.5 + dir * 0.42, 0.62],
        [0.5 + dir * 0.32, 0.52],
        [0.5 + dir * 0.22, 0.64],
        [0.5 + dir * 0.12, 0.56],
      ],
      (u, v) => 0.75 - Math.abs(u - 0.5) * 0.6 - (v - 0.3) * 0.6,
    );
  s.fill(wing(-1), c).fill(wing(1), c);
  s.fill(polygon([[0.37, 0.4], [0.38, 0.22], [0.47, 0.34]]), c).fill(polygon([[0.63, 0.4], [0.62, 0.22], [0.53, 0.34]]), c);
  s.fill(sphere(0.5, 0.48, 0.17, 0.18), c, { outlined: true });
  s.dot(0.44, 0.46, '#ffe066').dot(0.56, 0.46, '#ffe066');
  s.dot(0.46, 0.58, '#ffffff').dot(0.54, 0.58, '#ffffff');
};

export const ITEM_DRAWERS = {
  potion,
  sword,
  shield,
  key,
  coin,
  gem,
  heart,
  scroll,
  mushroom,
  apple,
  bomb,
  ring: ringItem,
  book,
  staff,
} satisfies Record<string, Draw>;

export const PROP_DRAWERS = { chest, barrel, crate, torch, plant } satisfies Record<string, Draw>;
export const CREATURE_DRAWERS = { slime, ghost, bat } satisfies Record<string, Draw>;

export type ItemName = keyof typeof ITEM_DRAWERS;

/** Couleur principale conseillée pour chaque motif. */
export const DEFAULT_COLORS: Record<string, readonly string[]> = {
  potion: ['#e0344a', '#3a7ae0', '#3cc46a', '#a24ee0'],
  sword: ['#5a3a8a', '#8a2a2a', '#2a4a8a'],
  shield: ['#b8323c', '#2f5fb0', '#2f8a4a'],
  key: ['#f0bd3c'],
  coin: ['#f0bd3c'],
  gem: ['#e0344a', '#2f8ae8', '#34c47a', '#b04ee8', '#f0c030'],
  heart: ['#e8344a'],
  scroll: ['#c0303a'],
  mushroom: ['#d83838', '#8a4ad8'],
  apple: ['#d8322a', '#7cc43a'],
  bomb: ['#2c3150'],
  ring: ['#2f8ae8', '#e0344a', '#34c47a'],
  book: ['#8a2a3a', '#2a4a8a', '#2a6a4a'],
  staff: ['#3aa0e8', '#b04ee8'],
  chest: ['#a86d3c'],
  barrel: ['#a86d3c'],
  crate: ['#a86d3c'],
  torch: ['#f07a22'],
  plant: ['#55b04c'],
  slime: ['#4cc46a', '#3a8ae8', '#e8506a', '#b060e0'],
  ghost: ['#b8d8f8', '#d0c0f0'],
  bat: ['#6a4a9a', '#4a4a6a'],
};

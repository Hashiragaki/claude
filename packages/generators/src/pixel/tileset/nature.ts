import { mix, shade } from '../../shared/color';
import { blob, foliage, ramp5 } from './paint';
import { T, Tile } from './tile';

const SNOW = ['#9aaac4', '#c8d6ea', '#eef4fa', '#ffffff'];

function leafTones(t: Tile): string[] {
  return ramp5(t.pal.leaf, t.pal.leafDark);
}

/** Calotte de neige sur le haut d'une forme déjà dessinée. */
function snowCap(t: Tile, depth = 2): void {
  for (let x = 0; x < T; x++) {
    let first = -1;
    for (let y = 0; y < T; y++) {
      if (t.filled(x, y) && t.get(x, y)[3] === 255) {
        first = y;
        break;
      }
    }
    if (first < 0) continue;
    const d = depth - (x % 3 === 0 ? 1 : 0);
    for (let i = 0; i < d; i++) t.set(x, first + i, i === 0 ? '#ffffff' : '#dfe9f5');
  }
}

/** Sapin : étages triangulaires. */
function pine(t: Tile, snowy: boolean): void {
  const tones = leafTones(t);
  const tiers: [number, number, number][] = [
    [1, 6, 3],
    [4, 10, 5],
    [8, 15, 7],
  ];
  for (const [top, bottom, half] of tiers) {
    for (let y = top; y <= bottom; y++) {
      const w = Math.round(((y - top + 1) / (bottom - top + 1)) * half);
      for (let x = 8 - w; x <= 7 + w; x++) {
        const rel = (x - (8 - w)) / Math.max(1, 2 * w);
        const light = 0.85 - rel * 0.7 - (y - top) / 30 + (y === bottom ? -0.2 : 0);
        t.set(x, y, tones[Math.max(0, Math.min(4, Math.round(light * 4)))] as string);
      }
    }
    if (snowy) {
      for (let y = top; y <= bottom; y++) {
        const w = Math.round(((y - top + 1) / (bottom - top + 1)) * half);
        if ((y - top) % 3 === 0) t.hline(8 - w, 7 + w - 1, y, y === top ? '#ffffff' : '#e8f0f8');
      }
    }
  }
}

export function drawTreeTop(t: Tile): void {
  const theme = t.theme;
  const tones = leafTones(t);
  switch (theme) {
    case 'forest':
    case 'snow':
      pine(t, theme === 'snow');
      break;
    case 'desert': {
      t.rect(7, 10, 2, 6, t.pal.wood);
      t.vline(8, 10, 15, t.pal.woodDark);
      const fronds: [number, number, number, boolean][] = [
        [-7, -8, 6, false],
        [7, -8, 6, false],
        [-8, -3, 9, true],
        [8, -3, 9, true],
        [-2, -9, 5, true],
        [3, -9, 5, true],
      ];
      for (const [dx, dy, g, front] of fronds) {
        const main = (front ? tones[3] : tones[1]) as string;
        const under = (front ? tones[1] : tones[0]) as string;
        for (let i = 0; i <= 14; i++) {
          const k = i / 14;
          const x = Math.round(8 + dx * k);
          const y = Math.round(9 + dy * k + g * k * k);
          t.set(x, y, main);
          t.set(x, y + 1, under);
          if (i > 3 && i % 3 === 0) t.set(x + (dx < 0 ? 1 : -1), y + 2, under);
        }
      }
      blob(t, 7, 10.5, 1.4, 1.4, ramp5(t.pal.wood, t.pal.woodDark));
      blob(t, 9.5, 10.5, 1.4, 1.4, ramp5(t.pal.wood, t.pal.woodDark));
      break;
    }
    case 'dungeon': {
      const { stone, stoneDark } = t.pal;
      for (let y = 5; y < T; y++) {
        for (let x = 4; x <= 11; x++) t.set(x, y, x === 4 ? shade(stone, 0.2) : x >= 10 ? stoneDark : x % 2 === 1 ? mix(stone, stoneDark, 0.3) : stone);
      }
      t.rect(2, 1, 12, 2, shade(stone, 0.15));
      t.rect(3, 3, 10, 2, stone);
      t.hline(2, 13, 1, shade(stone, 0.35));
      t.hline(3, 12, 4, stoneDark);
      t.hline(2, 13, 2, mix(stone, stoneDark, 0.4));
      break;
    }
    case 'interior': {
      foliage(
        t,
        [
          [5, 5, 3.5],
          [11, 5, 3.5],
          [8, 3, 3.2],
          [8, 8, 4],
          [4, 9, 2.6],
          [12, 9, 2.6],
        ],
        tones,
      );
      for (const [x, len] of [
        [3, 5],
        [6, 4],
        [10, 6],
        [13, 4],
      ] as const) {
        for (let i = 0; i < len; i++) {
          t.set(x + (i % 2), 11 + i, i % 2 === 0 ? (tones[2] as string) : (tones[1] as string));
        }
      }
      t.rect(6, 13, 4, 3, tones[1] as string);
      t.hline(6, 9, 13, tones[3] as string);
      break;
    }
    case 'cave': {
      const cap = ramp5(t.pal.leaf, t.pal.leafDark);
      blob(t, 8, 9, 7.5, 6.5, cap);
      for (let x = 0; x < T; x++) for (let y = 11; y < T; y++) if (t.filled(x, y)) t.clear(x, y);
      t.hline(1, 14, 11, t.pal.leafDark);
      t.hline(2, 13, 12, shade(t.pal.leafDark, -0.3));
      for (const [x, y] of [
        [5, 5],
        [10, 4],
        [8, 8],
        [12, 8],
        [3, 9],
      ] as const) {
        t.set(x, y, t.pal.accent);
        t.set(x + 1, y, shade(t.pal.accent, 0.4));
      }
      const stem = '#e4dccb';
      t.rect(6, 13, 4, 3, stem);
      t.vline(9, 13, 15, shade(stem, -0.25));
      break;
    }
    default:
      foliage(
        t,
        [
          [5, 6, 4],
          [11, 6, 4],
          [8, 4, 4.2],
          [4, 10, 3.6],
          [12, 10, 3.6],
          [8, 10, 4.4],
          [8, 14, 3],
        ],
        tones,
      );
      if (theme === 'village') {
        for (const [x, y] of [
          [5, 5],
          [11, 9],
          [7, 11],
        ] as const) {
          t.set(x, y, '#e8443c');
          t.set(x, y - 1, '#ff9a80');
        }
      }
  }
  t.outlined();
}

export function drawTreeTrunk(t: Tile): void {
  const { wood, woodDark } = t.pal;
  const theme = t.theme;
  const bark = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 ? shade(wood, 0.18) : x === x1 ? woodDark : wood;
        t.set(x, y, (x + y * 2) % 5 === 0 && x !== x0 ? mix(wood, woodDark, 0.6) : edge);
      }
    }
  };
  switch (theme) {
    case 'desert':
      for (let y = 0; y < 14; y++) {
        const x0 = 6 + Math.round(Math.sin(y / 5) * 0.8);
        for (let x = x0; x < x0 + 4; x++) t.set(x, y, y % 3 === 2 ? woodDark : x === x0 ? shade(wood, 0.2) : wood);
      }
      break;
    case 'dungeon': {
      const { stone, stoneDark } = t.pal;
      for (let y = 0; y < 12; y++) {
        for (let x = 4; x <= 11; x++) t.set(x, y, x === 4 ? shade(stone, 0.2) : x >= 10 ? stoneDark : x % 2 === 1 ? mix(stone, stoneDark, 0.3) : stone);
      }
      t.rect(3, 12, 10, 2, stone);
      t.rect(2, 14, 12, 2, shade(stone, 0.1));
      t.hline(3, 12, 12, shade(stone, 0.3));
      t.hline(2, 13, 14, shade(stone, 0.35));
      t.hline(2, 13, 15, stoneDark);
      break;
    }
    case 'interior': {
      const tones = leafTones(t);
      t.vline(7, 0, 8, tones[1] as string);
      t.vline(8, 0, 8, tones[0] as string);
      t.set(6, 3, tones[2] as string);
      t.set(9, 5, tones[2] as string);
      const pot = ['#6e3222', '#a4502e', '#cc7446', '#e89c6a'];
      t.rect(3, 9, 10, 2, pot[2] as string);
      t.hline(3, 12, 9, pot[3] as string);
      for (let y = 11; y < 16; y++) {
        const inset = Math.floor((y - 11) / 2);
        for (let x = 4 + inset; x <= 11 - inset; x++) t.set(x, y, x <= 5 + inset ? (pot[2] as string) : x >= 10 - inset ? (pot[0] as string) : (pot[1] as string));
      }
      break;
    }
    case 'cave': {
      const stem = '#e4dccb';
      for (let y = 0; y < 16; y++) {
        const flare = y > 11 ? y - 11 : 0;
        for (let x = 6 - flare; x <= 9 + flare; x++) t.set(x, y, x === 6 - flare ? '#fffaf0' : x >= 9 + flare ? shade(stem, -0.3) : stem);
      }
      t.hline(5, 10, 4, shade(stem, -0.15));
      t.hline(5, 10, 3, '#fffaf0');
      break;
    }
    default: {
      const narrow = theme === 'forest' || theme === 'snow';
      const x0 = narrow ? 7 : 6;
      bark(x0, 9, 0, 13);
      t.set(x0 - 1, 12, wood);
      t.set(x0 - 2, 13, woodDark);
      t.set(10, 12, woodDark);
      t.set(11, 13, woodDark);
      t.hline(x0 - 1, 10, 13, woodDark);
      if (!narrow) blob(t, 8, -0.5, 4.5, 2.2, leafTones(t).slice(0, 3));
    }
  }
  t.outlined();
  t.shadow(8, 14.5, 5.5, 1.5);
}

export function drawBush(t: Tile): void {
  const tones = leafTones(t);
  switch (t.theme) {
    case 'dungeon':
    case 'cave': {
      const rock = ramp5(t.pal.stone, t.pal.stoneDark);
      blob(t, 5, 11, 3.5, 2.8, rock);
      blob(t, 11, 11.5, 3, 2.5, rock);
      blob(t, 8, 8.5, 3, 2.6, rock);
      if (t.theme === 'cave') {
        for (const [x, y, c] of [
          [3, 7, t.pal.accent],
          [12, 7, '#f0a0d0'],
          [8, 4, t.pal.accent],
        ] as const) {
          t.vline(x, y + 1, y + 3, '#e4dccb');
          blob(t, x, y, 1.8, 1.2, ramp5(c, shade(c, -0.4)));
        }
      } else {
        t.set(6, 9, '#e8e0cc');
        t.set(7, 9, '#e8e0cc');
        t.set(7, 8, '#c8bea8');
      }
      break;
    }
    case 'desert': {
      const cactus = ramp5(t.pal.leaf, t.pal.leafDark);
      const col = (x0: number, y0: number, y1: number) => {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x < x0 + 3; x++) t.set(x, y, cactus[x === x0 ? 3 : x === x0 + 2 ? 1 : 2] as string);
        }
        t.set(x0 + 1, y0 - 1, cactus[2] as string);
      };
      col(6, 3, 14);
      col(2, 6, 10);
      t.hline(4, 5, 10, cactus[2] as string);
      col(11, 5, 9);
      t.hline(9, 10, 9, cactus[1] as string);
      for (const [x, y] of [
        [7, 5],
        [7, 9],
        [3, 8],
        [12, 7],
      ] as const) t.set(x, y, '#f4ecd0');
      t.set(7, 2, t.pal.accent);
      break;
    }
    case 'interior': {
      foliage(
        t,
        [
          [8, 5, 3.4],
          [5, 7, 2.8],
          [11, 7, 2.8],
        ],
        tones,
      );
      const pot = ['#6e3222', '#a4502e', '#cc7446'];
      for (let y = 10; y < 15; y++) {
        const inset = Math.floor((y - 10) / 3);
        for (let x = 5 + inset; x <= 10 - inset; x++) t.set(x, y, x === 5 + inset ? (pot[2] as string) : x === 10 - inset ? (pot[0] as string) : (pot[1] as string));
      }
      t.hline(4, 11, 10, pot[2] as string);
      break;
    }
    default:
      foliage(
        t,
        [
          [5, 9, 3.6],
          [11, 9, 3.6],
          [8, 7, 4],
          [8, 11, 3.6],
        ],
        tones,
      );
      if (t.theme === 'snow') snowCap(t, 2);
      if (t.theme === 'village') {
        for (const [x, y] of [
          [5, 8],
          [10, 7],
          [8, 11],
          [12, 10],
        ] as const) t.set(x, y, t.pal.accent === '#f0c83c' ? '#d8344a' : t.pal.accent);
      }
  }
  t.outlined();
  t.shadow(8, 14.6, 6, 1.4);
}

export function drawRock(t: Tile): void {
  if (t.theme === 'interior') {
    // Vase décoratif
    const c = ramp5(t.pal.stone, t.pal.stoneDark);
    blob(t, 8, 10, 4.5, 4, c);
    t.rect(6, 3, 4, 4, c[2] as string);
    t.vline(9, 3, 6, c[1] as string);
    t.rect(5, 2, 6, 1, c[3] as string);
    t.hline(4, 11, 10, t.pal.accent);
    t.hline(5, 10, 11, shade(t.pal.accent, -0.3));
    t.outlined();
    t.shadow(8, 14.6, 5, 1.2);
    return;
  }
  const c = ramp5(t.pal.stone, t.pal.stoneDark);
  blob(t, 8, 9.5, 6.2, 5, c, { bumps: 3, bumpAmp: 0.08, phase: 1 });
  blob(t, 11.5, 11.5, 3, 2.4, c, { onlyEmpty: true });
  t.line(6, 8, 8, 11, c[1] as string);
  t.set(9, 11, c[1] as string);
  t.set(5, 6, c[4] as string);
  t.set(6, 6, c[4] as string);
  if (t.theme === 'snow') snowCap(t, 3);
  if (t.theme === 'desert') {
    t.hline(3, 13, 10, c[1] as string);
    t.hline(4, 12, 11, c[3] as string);
  }
  if (t.theme === 'cave') {
    const a = t.pal.accent;
    t.vline(10, 4, 7, a);
    t.vline(11, 5, 7, shade(a, -0.35));
    t.set(10, 3, shade(a, 0.5));
    t.vline(8, 5, 7, shade(a, 0.2));
  }
  if (t.theme === 'forest') {
    t.set(4, 8, t.pal.leaf);
    t.set(5, 7, t.pal.leaf);
    t.set(6, 7, t.pal.leafDark);
  }
  t.outlined();
  t.shadow(8, 14.8, 6.5, 1.3);
}

export function drawFlowers(t: Tile): void {
  const theme = t.theme;
  const stem = theme === 'dungeon' ? t.pal.leafDark : t.pal.leaf;
  if (theme === 'cave' || theme === 'dungeon') {
    const glowColor = theme === 'cave' ? t.pal.accent : '#6ee0c8';
    const spots: [number, number, number][] = [
      [4, 11, 4],
      [8, 12, 6],
      [12, 11, 3],
      [10, 14, 2],
    ];
    for (const [x, y, h] of spots) {
      if (theme === 'cave') {
        for (let i = 0; i < h; i++) {
          t.set(x, y - i, i === h - 1 ? shade(glowColor, 0.55) : glowColor);
          t.set(x + 1, y - i + 1, shade(glowColor, -0.35));
        }
      } else {
        t.vline(x, y - h + 2, y, '#d8d0c0');
        blob(t, x, y - h + 1, 1.8, 1.2, ramp5(glowColor, shade(glowColor, -0.45)));
      }
    }
    t.outlined();
    return;
  }
  if (theme === 'interior') {
    const vase = ramp5(t.pal.waterLight, t.pal.water);
    blob(t, 8, 12, 3.2, 3, vase);
    t.rect(7, 8, 2, 2, vase[2] as string);
    for (const [x, y, c] of [
      [5, 4, t.pal.accent],
      [8, 3, '#e8506a'],
      [11, 5, '#f4f0f0'],
      [7, 6, '#b070e0'],
    ] as const) {
      t.line(8, 8, x, y + 1, stem);
      blob(t, x, y, 1.6, 1.5, ramp5(c, shade(c, -0.4)));
    }
    t.outlined();
    t.shadow(8, 15, 4, 1);
    return;
  }
  const palette =
    theme === 'snow'
      ? ['#f4f8ff', '#8ab4f0', '#f4f8ff']
      : theme === 'desert'
        ? [t.pal.accent, '#f0a0c8', '#f4d060']
        : [t.pal.accent, '#f4f0f0', theme === 'forest' ? '#9a70e0' : '#e8506a'];
  const heads: [number, number][] = [
    [4, 6],
    [9, 4],
    [12, 8],
    [6, 10],
    [10, 11],
  ];
  heads.forEach(([x, y], i) => {
    t.vline(x, y + 1, Math.min(15, y + 4), stem);
    if (i % 2 === 0) t.set(x + 1, y + 3, shade(stem, 0.2));
  });
  heads.forEach(([x, y], i) => {
    const c = palette[i % palette.length] as string;
    t.set(x, y - 1, c);
    t.set(x - 1, y, c);
    t.set(x + 1, y, shade(c, -0.15));
    t.set(x, y + 1, shade(c, -0.3));
    t.set(x, y, theme === 'snow' ? '#f0d060' : '#f8e070');
  });
  t.outlined();
}

export function drawLog(t: Tile): void {
  const { wood, woodDark } = t.pal;
  const theme = t.theme;
  if (theme === 'dungeon') {
    const bone = ['#8a8070', '#b8ae98', '#e0d8c4', '#f8f2e4'];
    blob(t, 8, 7, 3.5, 3.2, bone);
    t.rect(6, 9, 5, 2, bone[2] as string);
    t.set(6, 7, t.pal.outline);
    t.set(7, 7, t.pal.outline);
    t.set(9, 7, t.pal.outline);
    t.set(10, 7, t.pal.outline);
    t.set(8, 9, t.pal.outline);
    t.line(2, 13, 13, 11, bone[2] as string);
    t.line(3, 11, 12, 14, bone[1] as string);
    for (const [x, y] of [
      [2, 13],
      [13, 11],
      [3, 11],
      [12, 14],
    ] as const) t.set(x, y, bone[3] as string);
    t.outlined();
    t.shadow(8, 14.8, 6, 1.2);
    return;
  }
  if (theme === 'cave') {
    const steel = ['#3e4252', '#5c6274', '#8a90a4', '#b8bece'];
    t.rect(2, 6, 12, 6, steel[2] as string);
    t.rect(3, 7, 10, 4, steel[1] as string);
    t.hline(2, 13, 6, steel[3] as string);
    for (const [x, y, c] of [
      [5, 5, t.pal.accent],
      [7, 4, shade(t.pal.accent, 0.3)],
      [9, 5, '#f0c040'],
      [11, 5, t.pal.accent],
    ] as const) blob(t, x, y, 1.6, 1.4, ramp5(c, shade(c, -0.4)));
    for (const x of [4, 11]) blob(t, x, 12.5, 1.6, 1.6, steel);
    t.outlined();
    t.shadow(8, 14.6, 6, 1.2);
    return;
  }
  const logRow = (y0: number, x0: number, x1: number) => {
    for (let y = y0; y < y0 + 5; y++) {
      for (let x = x0; x < x1; x++) {
        const ly = y - y0;
        t.set(x, y, ly === 0 ? shade(wood, 0.2) : ly === 4 ? woodDark : (x * 3 + ly) % 7 === 0 ? mix(wood, woodDark, 0.5) : wood);
      }
    }
    const end = ['#c89a5e', '#e8c088', '#b07a44'];
    blob(t, x1, y0 + 2, 1.8, 2.4, [end[2] as string, end[0] as string, end[1] as string]);
    t.set(x1, y0 + 2, woodDark);
  };
  if (theme === 'interior') {
    logRow(10, 2, 12);
    logRow(6, 3, 11);
    logRow(2, 5, 10);
  } else {
    logRow(7, 2, 12);
    if (theme === 'forest') {
      t.set(5, 6, t.pal.leaf);
      t.set(6, 6, t.pal.leafDark);
      t.set(9, 6, t.pal.accent);
    }
    if (theme === 'snow') snowCap(t, 2);
  }
  t.outlined();
  t.shadow(8, 14.6, 6.5, 1.3);
}

export function drawSign(t: Tile): void {
  const { wood, woodDark, outline, accent } = t.pal;
  if (t.theme === 'interior') {
    const gold = ['#8a5a1a', '#c08a2a', '#f0c050', '#fff0a0'];
    t.rect(1, 3, 14, 11, gold[1] as string);
    t.hline(1, 14, 3, gold[2] as string);
    t.vline(1, 3, 13, gold[2] as string);
    t.rect(3, 5, 10, 7, '#8ac8f0');
    t.rect(3, 9, 10, 3, '#5aa04a');
    for (let x = 3; x < 13; x++) if (x > 5 && x < 10) t.set(x, 8, '#5aa04a');
    t.set(10, 6, '#fff0a0');
    t.set(11, 6, '#f0c050');
    t.outlined();
    return;
  }
  t.rect(7, 8, 2, 7, wood);
  t.vline(8, 8, 14, woodDark);
  t.rect(2, 3, 12, 6, wood);
  t.hline(2, 13, 3, shade(wood, 0.25));
  t.hline(2, 13, 8, woodDark);
  t.hline(3, 12, 5, mix(wood, woodDark, 0.35));
  if (t.theme === 'dungeon') {
    t.rect(7, 4, 3, 2, '#e8e0cc');
    t.set(7, 5, outline);
    t.set(9, 5, outline);
    t.set(8, 6, '#e8e0cc');
  } else {
    t.hline(5, 10, 6, woodDark);
    t.set(9, 5, woodDark);
    t.set(9, 7, woodDark);
    t.set(11, 6, woodDark);
  }
  if (t.theme === 'snow') t.hline(2, 13, 2, '#f4f8fc');
  t.outlined();
  t.shadow(8, 15, 3.5, 0.9);
}

export function drawCrate(t: Tile): void {
  const { wood, woodDark } = t.pal;
  t.rect(2, 3, 12, 12, wood);
  for (let y = 3; y < 15; y++) if ((y - 3) % 4 === 3) t.hline(3, 12, y, mix(wood, woodDark, 0.6));
  t.rect(2, 3, 12, 2, shade(wood, 0.15));
  t.rect(2, 13, 12, 2, mix(wood, woodDark, 0.3));
  t.rect(2, 3, 2, 12, shade(wood, 0.1));
  t.rect(12, 3, 2, 12, mix(wood, woodDark, 0.4));
  t.line(4, 5, 11, 12, woodDark);
  t.line(4, 6, 10, 12, shade(wood, 0.15));
  t.hline(2, 13, 3, shade(wood, 0.35));
  if (t.theme === 'snow') t.hline(2, 13, 2, '#f4f8fc');
  t.outlined();
  t.shadow(8, 15.2, 6.5, 1);
}


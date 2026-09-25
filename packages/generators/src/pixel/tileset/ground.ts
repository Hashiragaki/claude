import { mix, shade } from '../../shared/color';
import { T, Tile, hash2 } from './tile';

/** Motif périodique doux (période 16 px) dans [-1, 1], pour des taches raccordables. */
function wave(t: Tile, x: number, y: number, k: number): number {
  const p = (i: number) => hash2(i, k, t.salt) * Math.PI * 2;
  const a = (2 * Math.PI) / T;
  return (Math.sin(a * x + p(1)) + Math.sin(a * y + p(2)) + Math.sin(a * (x + y) + p(3)) * 0.8) / 2.8;
}

/**
 * Pavés irréguliers raccordables (Voronoï sur une grille jitterée de `n × n` cellules).
 * Chaque pierre reçoit un ton, un biseau clair en haut à gauche et sombre en bas à droite.
 */
export function cobbles(t: Tile, n: number, stone: string[], mortar: string, jitter = 0.7): void {
  const cell = T / n;
  const seeds: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = (t.rnd(i, j, 11) - 0.5) * jitter;
      const jy = (t.rnd(i, j, 12) - 0.5) * jitter;
      seeds.push([(i + 0.5 + jx) * cell, (j + 0.5 + jy) * cell, Math.floor(t.rnd(i, j, 13) * stone.length)]);
    }
  }
  const [light, dark] = [shade(stone[0] as string, 0.25), shade(stone[0] as string, -0.3)];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best: [number, number, number] = seeds[0] as [number, number, number];
      for (const s of seeds) {
        for (const ox of [-T, 0, T]) {
          for (const oy of [-T, 0, T]) {
            const dx = x + 0.5 - (s[0] + ox);
            const dy = y + 0.5 - (s[1] + oy);
            const d = Math.hypot(dx, dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = [s[0] + ox, s[1] + oy, s[2]];
            } else if (d < d2) d2 = d;
          }
        }
      }
      const edge = d2 - d1;
      if (edge < 1.1) {
        t.set(x, y, mortar);
        continue;
      }
      const base = stone[best[2]] as string;
      const dir = x + 0.5 - best[0] + (y + 0.5 - best[1]);
      if (edge < 2.3 && dir < -1) t.set(x, y, stone.length > 1 ? mix(base, light, 0.6) : light);
      else if (edge < 2.3 && dir > 1) t.set(x, y, mix(base, dark, 0.55));
      else t.set(x, y, base);
    }
  }
}

function grass(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  t.fill(ground);
  if (variant === 1) {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const w = wave(t, x, y, 5);
        if (w > 0.35 || (w > 0.2 && (x + y) % 2 === 0)) t.set(x, y, mix(ground, groundDark, 0.55));
      }
    }
  }
  t.speckle(mix(ground, groundDark, 0.5), 0.06, 1).speckle(mix(ground, groundLight, 0.5), 0.04, 2);
  t.scatter(8, 3, (x, y, r) => {
    if (r < 0.85) t.tuft(x, y, groundDark, groundLight);
  });
  t.scatter(8, 7, (x, y, r) => {
    if (r < 0.5) t.tuft(x + 4, y + 4, groundDark, groundLight);
  });
}

function flowerPatch(t: Tile): void {
  const colors = [t.pal.accent, '#f4f0f0', shade(t.pal.accent, -0.1)];
  const spots: [number, number][] = [
    [3, 4],
    [11, 2],
    [8, 10],
    [14, 12],
  ];
  spots.forEach(([sx, sy], i) => {
    if (t.rnd(i, 1, 21) < 0.2) return;
    const petal = colors[i % colors.length] as string;
    const cx = sx + Math.floor(t.rnd(i, 2, 21) * 2);
    const cy = sy + Math.floor(t.rnd(i, 3, 21) * 2);
    t.wset(cx, cy - 1, petal);
    t.wset(cx - 1, cy, petal);
    t.wset(cx + 1, cy, petal);
    t.wset(cx, cy + 1, shade(petal, -0.25));
    t.wset(cx, cy, '#f8e070');
    t.wset(cx + 1, cy + 2, t.pal.groundDark);
  });
}

function sand(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  t.fill(ground);
  const step = variant === 1 ? 4 : 6;
  for (let x = 0; x < T; x++) {
    const off = Math.round(1.5 * Math.sin((2 * Math.PI * x) / T + t.rnd(0, 0, 3) * 6));
    for (let y0 = 0; y0 < T; y0 += step) {
      if (t.rnd(x, y0, 4) < 0.18) continue;
      t.wset(x, y0 + off + 2, mix(ground, groundDark, 0.7));
      t.wset(x, y0 + off + 1, groundLight);
    }
  }
  t.speckle(mix(ground, groundDark, 0.4), 0.05, 5).speckle(groundLight, 0.03, 6);
  if (variant === 2) {
    t.scatter(8, 8, (x, y, r) => {
      if (r < 0.6) {
        t.wset(x, y, t.pal.stone);
        t.wset(x + 1, y, t.pal.stoneDark);
        t.wset(x, y - 1, shade(t.pal.stone, 0.25));
      } else {
        t.wset(x, y, '#f2ecdc');
        t.wset(x + 1, y + 1, '#f2ecdc');
        t.wset(x + 2, y + 2, '#d8cdb4');
      }
    });
  }
}

function snow(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  t.fill(ground);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const w = wave(t, x, y, variant + 9);
      if (w > (variant === 1 ? 0.15 : 0.4)) t.set(x, y, mix(ground, groundDark, 0.35));
      else if (w < -0.55) t.set(x, y, groundLight);
    }
  }
  t.speckle(mix(ground, groundDark, 0.6), 0.03, 7).speckle(groundLight, 0.04, 8);
  if (variant === 1) {
    t.scatter(8, 9, (x, y, r) => {
      if (r < 0.7) {
        t.wset(x, y, mix(ground, groundDark, 0.8));
        t.wset(x, y + 1, mix(ground, groundDark, 0.6));
      }
    });
  }
  if (variant === 2) {
    t.scatter(8, 10, (x, y, r) => {
      if (r < 0.8) t.tuft(x, y, t.pal.leafDark, t.pal.leaf);
    });
  }
}

function flagstones(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  const size = 8;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const shift = variant === 1 && Math.floor(y / size) % 2 === 1 ? size / 2 : 0;
      const bx = Math.floor((x + shift) / size);
      const by = Math.floor(y / size);
      const lx = (x + shift) % size;
      const ly = y % size;
      const v = t.rnd(bx % 2, by, 14);
      const base = v < 0.33 ? ground : v < 0.66 ? mix(ground, groundLight, 0.25) : mix(ground, groundDark, 0.2);
      if (lx === size - 1 || ly === size - 1) t.set(x, y, groundDark);
      else if (lx === 0 || ly === 0) t.set(x, y, mix(base, groundLight, 0.5));
      else if (lx === size - 2 || ly === size - 2) t.set(x, y, mix(base, groundDark, 0.3));
      else t.set(x, y, base);
    }
  }
  t.speckle(mix(ground, groundDark, 0.5), 0.04, 15);
  if (variant === 1) {
    t.line(3, 2, 5, 5, groundDark);
    t.set(6, 5, groundDark);
    t.line(10, 10, 12, 13, groundDark);
  }
  if (variant === 2) {
    t.scatter(8, 16, (x, y, r) => {
      if (r < 0.7) {
        const moss = r < 0.35 ? t.pal.leaf : t.pal.leafDark;
        t.wset(x, y, moss);
        t.wset(x + 1, y, moss);
        t.wset(x, y + 1, t.pal.leafDark);
      }
    });
    t.set(9, 4, '#e8e0cc');
    t.set(10, 5, '#e8e0cc');
    t.set(11, 5, '#c8bea8');
  }
}

function planks(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  if (variant === 2) {
    // Parquet en vannerie : blocs 4 × 4 alternant horizontal / vertical.
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const horizontal = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
        const along = horizontal ? y % 4 : x % 4;
        const base = (Math.floor(x / 4) * 3 + Math.floor(y / 4)) % 3 === 0 ? mix(ground, groundLight, 0.25) : ground;
        t.set(x, y, along === 3 ? groundDark : along === 0 ? mix(base, groundLight, 0.35) : base);
      }
    }
    return;
  }
  const h = 4;
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / h);
    const joint = (row * (variant === 1 ? 7 : 5) + 3) % T;
    const tint = t.rnd(row, 0, 20 + variant);
    const base = tint < 0.33 ? ground : tint < 0.66 ? mix(ground, groundLight, 0.18) : mix(ground, groundDark, 0.15);
    for (let x = 0; x < T; x++) {
      const ly = y % h;
      if (ly === h - 1) t.set(x, y, groundDark);
      else if (x === joint) t.set(x, y, mix(base, groundDark, 0.8));
      else if (ly === 0) t.set(x, y, mix(base, groundLight, 0.4));
      else t.set(x, y, base);
    }
  }
  t.scatter(8, 22 + variant, (x, y, r) => {
    const yy = Math.floor(y / 4) * 4 + 1 + (r < 0.5 ? 0 : 1);
    for (let i = 0; i < 3; i++) t.wset(x + i, yy, mix(ground, groundDark, 0.45));
  });
}

function dirt(t: Tile, variant: 0 | 1 | 2): void {
  const { ground, groundDark, groundLight } = t.pal;
  t.fill(ground);
  if (variant === 1) {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) if (wave(t, x, y, 30) > 0.25) t.set(x, y, mix(ground, groundDark, 0.45));
    }
    t.line(2, 3, 6, 6, groundDark);
    t.line(6, 6, 6, 9, groundDark);
    t.line(11, 11, 14, 12, groundDark);
  }
  t.speckle(groundDark, 0.07, 31).speckle(groundLight, 0.05, 32);
  t.scatter(8, 33, (x, y, r) => {
    if (r > 0.75) return;
    t.wset(x, y, t.pal.stone);
    t.wset(x + 1, y, t.pal.stoneDark);
    t.wset(x, y - 1, shade(t.pal.stone, 0.3));
    t.wset(x, y + 1, groundDark);
  });
  if (variant === 2) {
    const c = t.pal.accent;
    for (const [x, y, h] of [
      [4, 6, 3],
      [11, 12, 2],
    ] as const) {
      for (let i = 0; i < h; i++) {
        t.set(x, y - i, i === h - 1 ? shade(c, 0.45) : c);
        t.set(x + 1, y - i + 1, shade(c, -0.3));
      }
      t.set(x - 1, y, shade(c, 0.2));
      t.hline(x - 1, x + 2, y + 1, groundDark);
    }
  }
}

/** Sol, sol (variante) et sol (détail) selon le thème. */
export function drawGround(t: Tile, variant: 0 | 1 | 2): void {
  switch (t.theme) {
    case 'village':
      grass(t, variant === 1 ? 1 : 0);
      if (variant === 2) flowerPatch(t);
      break;
    case 'forest':
      grass(t, variant === 1 ? 1 : 0);
      if (variant === 1) {
        t.scatter(8, 40, (x, y, r) => {
          if (r < 0.7) {
            t.wset(x, y, t.pal.wood);
            t.wset(x + 1, y, t.pal.woodDark);
          }
        });
      }
      if (variant === 2) {
        t.scatter(16, 41, (x, y) => {
          const cx = x % 12 + 2;
          const cy = y % 10 + 4;
          t.set(cx, cy, '#efe4cc');
          t.set(cx, cy - 1, t.pal.accent);
          t.set(cx - 1, cy - 1, t.pal.accent);
          t.set(cx + 1, cy - 1, shade(t.pal.accent, -0.3));
          t.set(cx - 1, cy - 2, shade(t.pal.accent, 0.3));
          t.set(cx, cy - 2, t.pal.accent);
        });
        flowerPatch(t);
      }
      break;
    case 'desert':
      sand(t, variant);
      break;
    case 'snow':
      snow(t, variant);
      break;
    case 'dungeon':
      flagstones(t, variant);
      break;
    case 'interior':
      planks(t, variant);
      break;
    case 'cave':
      dirt(t, variant);
      break;
  }
}

/** Chemin et chemin (variante). */
export function drawPath(t: Tile, alt: boolean): void {
  const { path, pathDark, stone, stoneDark } = t.pal;
  const theme = t.theme;
  if (!alt) {
    if (theme === 'interior') {
      // Tapis de couloir tissé (motif en losanges, période 8).
      t.fill(path);
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const dx = Math.abs((x % 8) - 3.5);
          const dy = Math.abs((y % 8) - 3.5);
          const dd = dx + dy;
          if (dd > 3.4 && dd < 4.6) t.set(x, y, pathDark);
          else if (dd < 1.2) t.set(x, y, t.pal.accent);
          else if ((x + y) % 2 === 0 && dd < 3) t.set(x, y, mix(path, pathDark, 0.25));
        }
      }
      return;
    }
    if (theme === 'dungeon') {
      cobbles(t, 4, [path, mix(path, pathDark, 0.3), shade(path, 0.08)], pathDark);
      return;
    }
    t.fill(path);
    t.speckle(pathDark, 0.08, 50).speckle(shade(path, 0.2), 0.06, 51);
    if (theme === 'snow') {
      t.fill(mix(t.pal.ground, path, 0.55));
      t.speckle(t.pal.groundLight, 0.06, 52).speckle(mix(path, pathDark, 0.4), 0.05, 58);
      for (const [x, y] of [
        [3, 1],
        [7, 5],
        [3, 9],
        [7, 13],
      ] as const) {
        t.rect(x, y, 2, 3, pathDark);
        t.set(x, y, mix(path, pathDark, 0.5));
      }
      return;
    }
    if (theme === 'desert') {
      t.line(1, 4, 5, 6, pathDark);
      t.line(5, 6, 8, 5, pathDark);
      t.line(10, 12, 13, 10, pathDark);
    }
    t.scatter(8, 53, (x, y, r) => {
      if (r > 0.8) return;
      t.wset(x, y, stone);
      t.wset(x + 1, y, stoneDark);
      t.wset(x, y - 1, shade(stone, 0.3));
    });
    if (theme === 'forest') {
      t.scatter(8, 54, (x, y, r) => {
        if (r < 0.6) {
          t.wset(x, y, r < 0.3 ? t.pal.accent : t.pal.leaf);
          t.wset(x + 1, y + 1, t.pal.leafDark);
        }
      });
    }
    return;
  }
  switch (theme) {
    case 'village':
    case 'snow':
      cobbles(t, 4, [stone, mix(stone, stoneDark, 0.25), shade(stone, 0.1)], stoneDark);
      if (theme === 'snow') {
        for (let y = 0; y < T; y++) {
          for (let x = 0; x < T; x++) if (t.rnd(x, y, 55) < 0.5 && y > 0 && t.get(x, y - 1)[0] < t.get(x, y)[0] - 20) t.set(x, y, '#f4f8fc');
        }
      }
      break;
    case 'forest':
      t.fill(path);
      t.speckle(pathDark, 0.08, 56);
      for (const [cx, cy, r] of [
        [4, 4, 3],
        [11, 11, 3.4],
      ] as const) {
        t.ellipse(cx, cy + 1, r, r - 0.6, stoneDark);
        t.ellipse(cx, cy, r, r - 0.8, stone);
        t.set(cx - 1, cy - 1, shade(stone, 0.3));
        t.set(cx - 2, cy, shade(stone, 0.2));
      }
      break;
    case 'dungeon':
      t.fill(stoneDark);
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          if (x % 4 === 0 || y % 4 === 0) t.set(x, y, x % 4 === 0 && y % 4 === 0 ? shade(stone, 0.2) : stone);
          else if (x % 4 === 1 || y % 4 === 1) t.set(x, y, mix(stoneDark, t.pal.outline, 0.5));
          else t.set(x, y, t.pal.outline);
        }
      }
      break;
    case 'interior':
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
          const base = checker ? stone : shade(stone, 0.3);
          t.set(x, y, x % 8 === 7 || y % 8 === 7 ? stoneDark : base);
        }
      }
      t.set(2, 2, shade(stone, 0.5));
      t.set(10, 10, shade(stone, 0.5));
      break;
    case 'desert':
      cobbles(t, 2, [stone, shade(stone, 0.08), mix(stone, stoneDark, 0.2)], stoneDark, 0.35);
      break;
    case 'cave':
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const ly = y % 4;
          const joint = x === (Math.floor(y / 4) * 6 + 2) % T;
          t.set(x, y, ly === 3 || joint ? t.pal.woodDark : ly === 0 ? shade(t.pal.wood, 0.2) : t.pal.wood);
        }
      }
      t.speckle(t.pal.woodDark, 0.04, 57);
      break;
  }
}

/** Eau et eau profonde : bandes ondulées sombres et crêtes claires (raccordables). */
export function drawWater(t: Tile, deep: boolean): void {
  const { water, waterLight } = t.pal;
  const base = deep ? shade(water, -0.35) : water;
  const dark = shade(base, -0.18);
  const phase = t.rnd(0, 0, 65) * Math.PI * 2;
  t.fill(base);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const band = Math.sin(((2 * Math.PI) / 8) * y + 1.3 * Math.sin(((2 * Math.PI) / T) * x + phase));
      if (band > 0.8) t.set(x, y, dark);
      else if (band < -0.92 && !deep) t.set(x, y, mix(base, waterLight, 0.18));
    }
  }
  const light = deep ? mix(base, waterLight, 0.4) : waterLight;
  const crests: [number, number][] = [
    [2, 3],
    [10, 6],
    [5, 11],
    [13, 14],
  ];
  crests.forEach(([cx, cy], i) => {
    if (deep && i % 2 === 1) return;
    const x = cx + Math.floor(t.rnd(i, 0, 66) * 3);
    const y = cy;
    t.wset(x, y + 1, light);
    t.wset(x + 1, y, light);
    t.wset(x + 2, y, light);
    t.wset(x + 3, y + 1, light);
  });
  if (!deep) {
    t.wset(7, 1, '#ffffff');
    t.wset(1, 9, mix(waterLight, '#ffffff', 0.5));
  }
  if (t.theme === 'snow' && !deep) {
    t.ellipse(12, 10, 2.6, 1.6, '#f4f8fc');
    t.hline(10, 14, 11, t.pal.groundDark);
    t.set(11, 9, '#ffffff');
  }
  if (t.theme === 'dungeon' || t.theme === 'cave') {
    for (const [x, y] of [
      [4, 7],
      [12, 2],
    ] as const) {
      t.set(x, y, light);
      t.set(x + 1, y - 1, mix(base, light, 0.5));
    }
  }
}

/** Vide : noir profond légèrement teinté. */
export function drawVoid(t: Tile): void {
  t.fill(mix(t.pal.outline, '#000000', 0.35));
}

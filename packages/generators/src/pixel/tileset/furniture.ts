import { mix, shade } from '../../shared/color';
import { blob, flame, glow, ramp5 } from './paint';
import { T, Tile } from './tile';

export function drawTable(t: Tile): void {
  const { wood, woodDark, accent } = t.pal;
  const stone = t.theme === 'dungeon';
  const top = stone ? t.pal.stone : wood;
  const dark = stone ? t.pal.stoneDark : woodDark;
  for (const x of [2, 12]) {
    t.rect(x, 10, 2, 5, dark);
    t.vline(x, 10, 14, mix(top, dark, 0.4));
  }
  t.rect(1, 3, 14, 6, top);
  t.hline(1, 14, 3, shade(top, 0.25));
  for (let y = 4; y < 9; y++) if (y % 2 === 0) t.hline(2, 13, y, mix(top, dark, 0.15));
  t.rect(1, 9, 14, 2, dark);
  if (t.theme === 'interior' || t.theme === 'village') {
    t.rect(4, 3, 8, 7, shade(accent, 0.45));
    t.hline(4, 11, 3, shade(accent, 0.6));
    for (let x = 4; x < 12; x += 2) t.set(x, 9, accent);
  }
  if (stone || t.theme === 'cave') {
    t.rect(7, 3, 2, 3, '#f4ecd8');
    flame(t, 7, 2, 2, t.theme === 'cave' ? '#f4a232' : accent);
  } else {
    const mug = ramp5(t.pal.stone, t.pal.stoneDark);
    blob(t, 6, 5.5, 1.6, 1.4, mug);
    blob(t, 10, 6, 2, 1.2, ramp5(shade(wood, 0.3), wood));
  }
  if (t.theme === 'snow') t.hline(1, 14, 2, '#f4f8fc');
  t.outlined();
  t.shadow(8, 15, 7, 1);
}

export function drawChair(t: Tile): void {
  const { wood, woodDark, accent } = t.pal;
  t.rect(4, 1, 8, 7, wood);
  t.rect(5, 2, 6, 4, mix(wood, woodDark, 0.35));
  t.hline(4, 11, 1, shade(wood, 0.25));
  for (const x of [4, 11]) t.vline(x, 1, 14, x === 4 ? shade(wood, 0.1) : woodDark);
  t.rect(4, 8, 8, 3, t.theme === 'interior' ? accent : shade(wood, 0.15));
  t.hline(4, 11, 8, t.theme === 'interior' ? shade(accent, 0.3) : shade(wood, 0.3));
  t.hline(4, 11, 11, woodDark);
  t.vline(5, 12, 14, woodDark);
  t.vline(10, 12, 14, woodDark);
  t.outlined();
  t.shadow(8, 15, 5, 1);
}

export function drawBed(t: Tile): void {
  const { wood, woodDark, accent } = t.pal;
  const theme = t.theme;
  if (theme === 'dungeon' || theme === 'cave') {
    const straw =
      theme === 'dungeon' ? ['#8a6a2a', '#b8943e', '#dcbc5e', '#f0dc8a'] : ['#4a3424', '#6e5036', '#94704c', '#b8946a'];
    t.rect(2, 3, 12, 12, straw[1] as string);
    for (let y = 3; y < 15; y++)
      for (let x = 2; x < 14; x++) if (t.rnd(x, y, 90) < 0.25) t.set(x, y, straw[(x + y) % 2 === 0 ? 2 : 0] as string);
    t.rect(4, 4, 8, 3, '#d8d0bc');
    t.hline(4, 11, 4, '#f0ead8');
    if (theme === 'cave') {
      for (let y = 8; y < 14; y++) t.hline(3, 12, y, y % 2 === 0 ? (straw[2] as string) : (straw[1] as string));
    }
    t.outlined();
    t.shadow(8, 15.2, 6.5, 0.9);
    return;
  }
  t.rect(2, 1, 12, 14, woodDark);
  t.rect(2, 1, 12, 2, wood);
  t.hline(2, 13, 1, shade(wood, 0.3));
  t.rect(3, 3, 10, 11, '#f4f0e8');
  t.rect(4, 4, 8, 3, '#ffffff');
  t.hline(4, 11, 6, '#d8d4dc');
  const blanket = theme === 'snow' ? '#c84a4a' : accent === '#f0c83c' ? '#4a78c8' : accent;
  t.rect(3, 8, 10, 6, blanket);
  t.hline(3, 12, 8, shade(blanket, 0.35));
  t.hline(3, 12, 9, shade(blanket, 0.15));
  t.vline(12, 8, 13, shade(blanket, -0.3));
  t.hline(3, 12, 13, shade(blanket, -0.25));
  t.rect(2, 14, 12, 1, wood);
  t.outlined();
  t.shadow(8, 15.4, 6.5, 0.8);
}

export function drawShelf(t: Tile): void {
  const { wood, woodDark, accent, outline } = t.pal;
  t.rect(1, 1, 14, 14, woodDark);
  t.rect(2, 2, 12, 12, mix(woodDark, outline, 0.45));
  t.hline(1, 14, 1, shade(wood, 0.2));
  t.vline(1, 1, 14, wood);
  for (const y of [5, 9, 13]) {
    t.hline(2, 13, y, wood);
    t.hline(2, 13, y + 1, woodDark);
  }
  const books = [accent, '#4a78c8', '#c84a4a', '#5aa04a', '#e0c070', '#8a5ac0'];
  const jars = t.theme === 'dungeon' || t.theme === 'cave';
  for (const [row, y] of [
    [0, 2],
    [1, 6],
    [2, 10],
  ] as const) {
    let x = 2;
    let i = row * 2;
    while (x < 13) {
      if (jars) {
        const c = [t.pal.accent, '#6ee0c8', '#c84a8a', '#e8e0cc'][i % 4] as string;
        blob(t, x + 1, y + 1.8, 1.2, 1.6, ramp5(c, shade(c, -0.45)));
        t.set(x + 1, y, t.pal.stone);
        x += 3;
      } else {
        const c = books[i % books.length] as string;
        const w = 1 + (i % 3 === 0 ? 1 : 0);
        const h = 3 - (i % 4 === 1 ? 1 : 0);
        for (let dx = 0; dx < w; dx++) t.vline(x + dx, y + 3 - h, y + 2, dx === 0 ? c : shade(c, -0.25));
        t.set(x, y + 3 - h, shade(c, 0.3));
        x += w + (i % 5 === 4 ? 1 : 0);
      }
      i++;
    }
  }
  t.outlined();
}

export function drawBarrel(t: Tile): void {
  const { wood, woodDark, stone, stoneDark } = t.pal;
  for (let y = 3; y <= 14; y++) {
    const bulge = Math.round(Math.sin(((y - 3) / 11) * Math.PI) * 1.5);
    const x0 = 3 - bulge;
    const x1 = 12 + bulge;
    for (let x = x0; x <= x1; x++) {
      const k = (x - x0) / (x1 - x0);
      t.set(
        x,
        y,
        k < 0.2 ? shade(wood, 0.2) : k > 0.8 ? woodDark : (x - x0) % 3 === 2 ? mix(wood, woodDark, 0.4) : wood,
      );
    }
  }
  for (const y of [5, 12]) {
    const bulge = Math.round(Math.sin(((y - 3) / 11) * Math.PI) * 1.5);
    t.hline(3 - bulge, 12 + bulge, y, stone);
    t.set(3 - bulge, y, shade(stone, 0.3));
    t.set(12 + bulge, y, stoneDark);
  }
  blob(t, 7.5, 2.8, 4.6, 1.6, [woodDark, mix(wood, woodDark, 0.4), wood, shade(wood, 0.2)]);
  t.hline(4, 11, 3, mix(wood, woodDark, 0.5));
  if (t.theme === 'snow') t.hline(4, 11, 2, '#f4f8fc');
  t.outlined();
  t.shadow(8, 15.2, 6, 0.9);
}

export function drawTorch(t: Tile): void {
  const { wood, woodDark, stone, stoneDark, accent } = t.pal;
  const fire = t.theme === 'cave' ? '#f4a232' : t.theme === 'snow' || t.theme === 'desert' ? '#f4a232' : accent;
  switch (t.theme) {
    case 'village':
    case 'snow': {
      t.rect(7, 7, 2, 9, stoneDark);
      t.vline(7, 7, 15, stone);
      t.rect(5, 1, 6, 1, stoneDark);
      t.rect(5, 2, 6, 5, stoneDark);
      t.rect(6, 3, 4, 3, '#ffe38a');
      t.set(6, 3, '#fff8d8');
      t.hline(4, 11, 1, stone);
      t.set(7, 0, stoneDark);
      t.set(8, 0, stoneDark);
      if (t.theme === 'snow') t.hline(4, 11, 0, '#f4f8fc');
      t.outlined();
      glow(t, 8, 4.5, 4.5, '#ffd860');
      return;
    }
    case 'desert': {
      t.line(4, 15, 7, 9, woodDark);
      t.line(12, 15, 9, 9, woodDark);
      t.vline(8, 10, 15, wood);
      blob(t, 8, 8.5, 4.5, 2, ramp5(stone, stoneDark));
      flame(t, 8, 7, 5, fire);
      t.set(6, 6, fire);
      t.set(10, 6, fire);
      t.outlined();
      glow(t, 8, 5, 5, '#ffb040');
      return;
    }
    case 'interior': {
      const brass = ['#6a4a1a', '#a87a2a', '#e0b050', '#fff0a0'];
      t.rect(7, 8, 2, 7, brass[1] as string);
      t.vline(7, 8, 14, brass[2] as string);
      t.rect(5, 14, 6, 1, brass[1] as string);
      t.hline(4, 11, 15, brass[0] as string);
      t.rect(4, 7, 8, 1, brass[2] as string);
      for (const x of [4, 7, 11]) {
        t.rect(x, 4, x === 7 ? 2 : 1, 3, '#f4ecd8');
        flame(t, x, 3, 2, '#ffb040');
      }
      t.outlined();
      glow(t, 8, 3.5, 3.5, '#ffd860');
      return;
    }
    case 'forest': {
      t.rect(7, 6, 2, 10, wood);
      t.vline(8, 6, 15, woodDark);
      t.rect(6, 5, 4, 2, stoneDark);
      flame(t, 8, 4, 4, '#f4a232');
      t.outlined();
      glow(t, 8, 3.5, 3.5, '#ffb040');
      return;
    }
    default: {
      t.rect(6, 10, 4, 2, stone);
      t.hline(6, 9, 11, stoneDark);
      t.vline(7, 12, 14, stoneDark);
      t.rect(7, 6, 2, 5, wood);
      t.vline(8, 6, 10, woodDark);
      flame(t, 8, 5, 5, fire);
      t.outlined();
      glow(t, 8, 4, 4, '#ffb040');
    }
  }
}

export function drawRug(t: Tile): void {
  const { path, pathDark, accent } = t.pal;
  const theme = t.theme;
  if (theme === 'snow' || theme === 'cave') {
    const fur = ['#5a3e2a', '#7a5638', '#9c7650', '#c09a70'];
    blob(t, 8, 8.5, 6.8, 5.2, fur, { bumps: 9, bumpAmp: 0.1 });
    for (const [x, y] of [
      [2, 4],
      [13, 4],
      [2, 13],
      [13, 13],
    ] as const)
      blob(t, x, y, 1.6, 1.6, fur);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) if (t.filled(x, y) && t.rnd(x, y, 91) < 0.15) t.set(x, y, fur[1] as string);
    t.outlined();
    return;
  }
  const fields: Record<string, string> = {
    desert: accent,
    dungeon: '#7a2a34',
    village: t.pal.roof,
    forest: t.pal.leafDark,
  };
  const field = fields[theme] ?? path;
  const border = theme === 'desert' ? '#f0e0b8' : theme === 'dungeon' ? '#c89a3a' : accent;
  t.rect(1, 2, 14, 12, border);
  t.rect(2, 3, 12, 10, field);
  for (let y = 3; y < 13; y++) {
    for (let x = 2; x < 14; x++) {
      if (theme === 'desert') {
        if (y % 3 === 0) t.set(x, y, (x + y) % 4 < 2 ? '#2a4a6a' : '#f0e0b8');
      } else {
        const d = Math.abs(x + 0.5 - 8) + Math.abs(y + 0.5 - 8);
        if (d > 3 && d < 4.2) t.set(x, y, border);
        else if (d < 1.5) t.set(x, y, shade(border, 0.3));
        else if (x === 2 || y === 3) t.set(x, y, mix(field, pathDark, 0.4));
      }
    }
  }
  for (let x = 1; x < 15; x += 2) {
    t.set(x, 1, shade(border, -0.2));
    t.set(x, 14, shade(border, -0.2));
  }
  if (theme === 'dungeon') {
    t.clear(13, 12);
    t.clear(14, 13);
    t.clear(14, 12);
    t.clear(1, 2);
  }
}

import { mix, shade } from '../../shared/color';
import { cobbles } from './ground';
import { T, Tile } from './tile';

/** Rangées de briques décalées (raccordables si `w` divise 16). */
function bricks(t: Tile, y0: number, y1: number, h: number, w: number, face: string, mortar: string, k = 70): void {
  const light = mix(face, '#ffffff', 0.18);
  const dark = mix(face, mortar, 0.35);
  for (let y = y0; y <= y1; y++) {
    const row = Math.floor((y - y0) / h);
    const ly = (y - y0) % h;
    const off = row % 2 === 0 ? 0 : w / 2;
    for (let x = 0; x < T; x++) {
      const lx = (x + off) % w;
      const brick = Math.floor((x + off) / w);
      const tint = t.rnd(brick, row, k);
      const base = tint < 0.25 ? shade(face, -0.08) : tint > 0.8 ? shade(face, 0.06) : face;
      if (ly === h - 1 || lx === w - 1) t.set(x, y, mortar);
      else if (ly === 0 || lx === 0) t.set(x, y, mix(base, light, 0.6));
      else if (ly === h - 2) t.set(x, y, mix(base, dark, 0.5));
      else t.set(x, y, base);
    }
  }
}

/** Rondins horizontaux (chalet). */
function logs(t: Tile, y0: number, y1: number, wood: string, dark: string): void {
  for (let y = y0; y <= y1; y++) {
    const ly = (y - y0) % 4;
    for (let x = 0; x < T; x++) {
      t.set(x, y, ly === 0 ? shade(wood, 0.22) : ly === 3 ? dark : ly === 2 ? shade(wood, -0.1) : wood);
    }
  }
  t.scatter(8, 71, (x, y) => {
    const yy = y0 + Math.floor((y - y0) / 4) * 4 + 1;
    if (yy <= y1) t.hline(x, x + 2, yy, mix(wood, dark, 0.5));
  });
}

/** Paroi rocheuse (grottes). */
function rockFace(t: Tile, face: string, dark: string): void {
  cobbles(t, 2, [face, shade(face, 0.07), shade(face, -0.06)], dark, 0.9);
  t.speckle(mix(face, dark, 0.5), 0.05, 72);
}

/** Face de mur selon le thème (raccordable horizontalement). */
export function wallFace(t: Tile): void {
  const { wall, wallDark, wood, woodDark, stone, stoneDark } = t.pal;
  switch (t.theme) {
    case 'village':
      t.rect(0, 0, T, T, wall);
      t.speckle(mix(wall, wallDark, 0.35), 0.06, 73);
      t.rect(0, 0, T, 2, wood);
      t.hline(0, 15, 0, shade(wood, 0.2));
      t.hline(0, 15, 2, mix(wall, wallDark, 0.6));
      t.rect(0, 0, 2, 13, wood);
      t.vline(1, 0, 12, woodDark);
      bricks(t, 12, 15, 4, 8, stone, stoneDark);
      break;
    case 'forest':
    case 'snow':
      logs(t, 0, 15, wall, wallDark);
      break;
    case 'dungeon':
      bricks(t, 0, 15, 4, 8, wall, wallDark);
      break;
    case 'desert':
      bricks(t, 0, 15, 5, 16, wall, wallDark);
      t.speckle(mix(wall, wallDark, 0.3), 0.05, 74);
      break;
    case 'interior':
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < T; x++)
          t.set(x, y, x % 4 === 0 ? mix(wall, wallDark, 0.3) : x % 4 === 2 ? shade(wall, 0.05) : wall);
      }
      t.hline(0, 15, 10, shade(wood, 0.25));
      for (let y = 11; y < 15; y++) {
        for (let x = 0; x < T; x++) t.set(x, y, x % 8 === 0 ? woodDark : x % 8 === 1 ? shade(wood, 0.15) : wood);
      }
      t.hline(0, 15, 15, woodDark);
      break;
    case 'cave':
      rockFace(t, wall, wallDark);
      break;
  }
}

export function drawWall(t: Tile): void {
  wallFace(t);
}

/** Dessus de mur vu de haut, avec un rebord vers le bas. */
export function drawWallTop(t: Tile): void {
  const { wall, wallDark, roof, roofDark } = t.pal;
  switch (t.theme) {
    case 'forest': {
      t.fill(t.pal.ground);
      t.speckle(t.pal.groundDark, 0.08, 75).speckle(t.pal.groundLight, 0.05, 76);
      for (let x = 0; x < T; x++) {
        const drop = 12 + (x % 5 === 0 ? 1 : 0);
        t.set(x, drop, t.pal.groundDark);
        for (let y = drop + 1; y < T; y++) t.set(x, y, y === drop + 1 ? shade(wall, 0.2) : wall);
      }
      break;
    }
    case 'snow': {
      t.fill(t.pal.ground);
      t.speckle(t.pal.groundDark, 0.05, 77);
      for (let x = 0; x < T; x++) {
        const drip = 12 + (x % 4 === 1 ? 2 : x % 4 === 2 ? 1 : 0);
        for (let y = drip; y < T; y++) t.set(x, y, y === drip ? t.pal.groundDark : wallDark);
      }
      break;
    }
    case 'dungeon':
    case 'cave': {
      t.fill(roof);
      t.speckle(roofDark, 0.12, 78).speckle(shade(roof, 0.12), 0.06, 79);
      t.hline(0, 15, 13, shade(wall, 0.25));
      t.hline(0, 15, 14, wall);
      t.hline(0, 15, 15, wallDark);
      break;
    }
    case 'interior': {
      t.fill(roof);
      for (let y = 0; y < 12; y++) for (let x = 0; x < T; x++) if (x % 4 === 3) t.set(x, y, roofDark);
      t.hline(0, 15, 12, shade(t.pal.wood, 0.3));
      t.hline(0, 15, 13, t.pal.wood);
      t.rect(0, 14, T, 2, t.pal.woodDark);
      break;
    }
    default: {
      const cap = shade(wall, 0.12);
      bricks(t, 0, 11, 6, 8, cap, wallDark, 80);
      t.hline(0, 15, 12, shade(wall, 0.35));
      t.rect(0, 13, T, 2, wall);
      t.hline(0, 15, 15, wallDark);
    }
  }
}

/** Fenêtre (ou équivalent thématique) sur une face de mur. */
export function drawWallWindow(t: Tile): void {
  wallFace(t);
  const { wood, woodDark, stone, stoneDark, waterLight, outline, accent } = t.pal;
  const glass = (x0: number, y0: number, w: number, h: number, lit = false) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const k = (y - y0) / h;
        const c = lit ? mix('#ffe9a0', '#f0a040', k) : mix(shade(waterLight, 0.35), shade(waterLight, -0.3), k);
        t.set(x, y, c);
      }
    }
    if (!lit) {
      t.line(x0 + 1, y0 + h - 2, x0 + w - 2, y0 + 1, shade(waterLight, 0.55));
      t.set(x0 + 1, y0 + 1, '#ffffff');
    }
  };
  switch (t.theme) {
    case 'dungeon': {
      t.rect(4, 3, 8, 9, stoneDark);
      t.rect(5, 4, 6, 8, outline);
      t.hline(6, 9, 3, stoneDark);
      for (const x of [6, 9]) t.vline(x, 4, 11, stone);
      t.hline(4, 11, 12, shade(stone, 0.2));
      break;
    }
    case 'cave': {
      for (const [x, y, h] of [
        [5, 9, 5],
        [8, 11, 7],
        [11, 8, 4],
      ] as const) {
        for (let i = 0; i < h; i++) {
          t.set(x, y - i, i === h - 1 ? shade(accent, 0.5) : accent);
          t.set(x + 1, y - i + 1, shade(accent, -0.35));
        }
        t.set(x - 1, y - 1, shade(accent, 0.25));
      }
      break;
    }
    case 'desert': {
      t.rect(4, 4, 8, 9, outline);
      t.rect(5, 3, 6, 1, outline);
      for (let x = 3; x <= 12; x++) t.set(x, 2, x % 2 === 0 ? accent : '#f4ecd8');
      t.hline(3, 12, 3, shade(accent, -0.3));
      t.hline(3, 12, 13, shade(t.pal.wall, 0.25));
      break;
    }
    default: {
      const lit = t.theme === 'snow';
      t.rect(3, 2, 10, 11, woodDark);
      glass(4, 3, 8, 9, lit);
      t.vline(7, 3, 11, wood);
      t.vline(8, 3, 11, woodDark);
      t.hline(4, 11, 7, wood);
      t.hline(2, 13, 12, shade(stone, 0.25));
      t.hline(2, 13, 13, stoneDark);
      if (t.theme === 'interior') {
        for (let y = 1; y < 12; y++) {
          t.set(2, y, accent);
          t.set(3, y, y % 3 === 0 ? shade(accent, -0.3) : accent);
          t.set(12, y, y % 3 === 0 ? shade(accent, -0.3) : accent);
          t.set(13, y, shade(accent, -0.2));
        }
        t.hline(1, 14, 1, woodDark);
      }
      if (t.theme === 'village') {
        t.rect(3, 13, 10, 2, wood);
        t.hline(3, 12, 14, woodDark);
        for (const x of [4, 7, 10]) {
          t.set(x, 12, accent);
          t.set(x + 1, 12, '#f4f0f0');
        }
      }
      if (lit) {
        t.hline(2, 13, 12, '#f4f8fc');
        t.set(4, 3, '#ffffff');
        t.set(11, 3, '#ffffff');
      }
    }
  }
}

/** Porte (ou entrée) dans une face de mur. */
export function drawDoor(t: Tile): void {
  wallFace(t);
  const { wood, woodDark, stone, stoneDark, outline, accent } = t.pal;
  switch (t.theme) {
    case 'cave': {
      t.rect(4, 3, 8, 13, outline);
      t.rect(5, 5, 6, 11, mix(outline, '#000000', 0.4));
      for (const x of [2, 12]) {
        t.rect(x, 2, 2, 14, wood);
        t.vline(x + 1, 2, 15, woodDark);
      }
      t.rect(2, 1, 12, 2, wood);
      t.hline(2, 13, 1, shade(wood, 0.25));
      t.hline(2, 13, 3, woodDark);
      break;
    }
    case 'desert': {
      t.rect(4, 3, 8, 13, outline);
      t.rect(5, 2, 6, 1, outline);
      for (let y = 3; y < 12; y++) {
        for (let x = 4; x < 12; x++)
          if ((x + Math.floor(y / 3)) % 3 !== 0) t.set(x, y, x < 8 ? accent : shade(accent, -0.2));
      }
      t.hline(4, 11, 3, shade(accent, -0.4));
      break;
    }
    case 'dungeon': {
      t.rect(3, 2, 10, 14, stoneDark);
      t.rect(4, 3, 8, 13, wood);
      t.hline(5, 10, 2, stoneDark);
      for (const x of [6, 9]) t.vline(x, 3, 15, woodDark);
      for (const y of [5, 11]) {
        t.hline(4, 11, y, stone);
        t.set(5, y, shade(stone, 0.4));
        t.set(10, y, shade(stone, 0.4));
      }
      t.set(10, 9, accent);
      break;
    }
    default: {
      t.rect(3, 2, 10, 14, woodDark);
      t.rect(4, 3, 8, 13, wood);
      for (const x of [6, 9]) t.vline(x, 3, 15, mix(wood, woodDark, 0.6));
      t.hline(4, 11, 3, shade(wood, 0.2));
      if (t.theme === 'interior') {
        t.rect(5, 5, 3, 4, shade(wood, 0.12));
        t.rect(8, 5, 3, 4, shade(wood, 0.12));
        t.rect(5, 10, 3, 4, shade(wood, 0.12));
        t.rect(8, 10, 3, 4, shade(wood, 0.12));
      }
      t.set(10, 9, accent);
      t.set(10, 10, shade(accent, -0.3));
      if (t.theme === 'forest') {
        t.hline(5, 10, 2, woodDark);
        t.set(3, 2, t.pal.wall);
        t.set(12, 2, t.pal.wall);
      }
      if (t.theme === 'snow') {
        t.hline(2, 13, 1, '#f4f8fc');
        t.hline(3, 12, 2, t.pal.groundDark);
      }
    }
  }
}

/** Texture de toit (ou de plafond) raccordable. */
export function roofTexture(t: Tile, rows = T): void {
  const { roof, roofDark } = t.pal;
  const light = shade(roof, 0.2);
  switch (t.theme) {
    case 'village':
      for (let y = 0; y < rows; y++) {
        const row = Math.floor(y / 4);
        const ly = y % 4;
        for (let x = 0; x < T; x++) {
          const lx = (x + (row % 2) * 2) % 4;
          const edge = ly === 3 || (ly === 2 && (lx === 0 || lx === 3));
          t.set(x, y, edge ? roofDark : ly === 0 ? light : lx === 0 ? mix(roof, roofDark, 0.4) : roof);
        }
      }
      break;
    case 'forest':
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < T; x++) {
          const band = y % 5 === 4;
          const streak = t.rnd(x, Math.floor(y / 5), 81);
          t.set(x, y, band ? roofDark : streak < 0.3 ? mix(roof, roofDark, 0.5) : streak > 0.8 ? light : roof);
        }
      }
      break;
    case 'desert':
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < T; x++) {
          const lx = x % 4;
          const ly = (y + (Math.floor(x / 4) % 2) * 3) % 6;
          t.set(x, y, ly === 5 ? roofDark : lx === 0 ? light : lx === 3 ? mix(roof, roofDark, 0.6) : roof);
        }
      }
      break;
    case 'snow':
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < T; x++) {
          const w = Math.sin(((x + y * 0.5) * Math.PI * 2) / 8);
          t.set(x, y, y % 5 === 4 && w > 0 ? roofDark : y % 5 === 3 && w > 0.3 ? mix(roof, roofDark, 0.4) : roof);
        }
      }
      t.speckle('#ffffff', 0.05, 82);
      break;
    case 'cave':
      cobbles(t, 2, [roof, shade(roof, 0.06), shade(roof, -0.05)], roofDark, 0.9);
      break;
    case 'interior':
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < T; x++) t.set(x, y, x % 8 === 7 ? roofDark : x % 8 === 0 ? light : roof);
      }
      break;
    case 'dungeon':
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < T; x++) {
          const edge = y % 8 === 7 || (x + (Math.floor(y / 8) % 2) * 4) % 8 === 7;
          t.set(x, y, edge ? roofDark : roof);
        }
      }
      t.speckle(shade(roof, 0.1), 0.05, 83);
      break;
  }
}

export function drawRoof(t: Tile): void {
  roofTexture(t);
}

/** Bord de toit : fin du toit, avant-toit, puis ombre portée semi-transparente. */
export function drawRoofEdge(t: Tile): void {
  roofTexture(t, 11);
  const { roofDark, woodDark, outline } = t.pal;
  const trim = t.theme === 'cave' || t.theme === 'dungeon' ? roofDark : woodDark;
  t.hline(0, 15, 11, shade(trim, 0.2));
  t.hline(0, 15, 12, trim);
  t.hline(0, 15, 13, outline);
  if (t.theme === 'snow') {
    t.hline(0, 15, 11, '#f4f8fc');
    for (const [x, len] of [
      [1, 2],
      [4, 1],
      [6, 3],
      [10, 2],
      [13, 1],
    ] as const) {
      for (let i = 0; i < len; i++) t.set(x, 14 + i, i === len - 1 ? '#c4eaf8' : '#e8f6fc');
    }
  }
  if (t.theme === 'cave') {
    for (const [x, len] of [
      [2, 2],
      [7, 3],
      [12, 2],
    ] as const) {
      for (let i = 0; i < len; i++) {
        t.set(x, 14 + i, t.pal.roof);
        if (i < len - 1) t.set(x + 1, 14 + i, roofDark);
      }
    }
  }
  const shadow = `${mix(outline, '#000000', 0.3)}55`;
  for (let x = 0; x < T; x++) for (let y = 14; y < T; y++) if (t.alpha(x, y) === 0) t.set(x, y, shadow);
}

/** Escalier : marches claires, contremarches sombres, bords latéraux. */
export function drawStairs(t: Tile): void {
  const woody = t.theme === 'interior' || t.theme === 'forest';
  const face = woody ? t.pal.wood : t.pal.stone;
  const dark = woody ? t.pal.woodDark : t.pal.stoneDark;
  for (let step = 0; step < 4; step++) {
    const y0 = step * 4;
    const k = t.theme === 'dungeon' ? step * 0.12 : 0;
    const top = mix(shade(face, 0.15), t.pal.outline, k);
    const riser = mix(dark, t.pal.outline, k);
    t.rect(0, y0, T, 2, top);
    t.hline(0, 15, y0, shade(top, 0.2));
    t.rect(0, y0 + 2, T, 2, riser);
    t.hline(0, 15, y0 + 3, mix(riser, t.pal.outline, 0.4));
    if (t.theme === 'snow') t.hline(1, 14, y0, '#f4f8fc');
  }
  t.rect(0, 0, 2, T, dark);
  t.rect(14, 0, 2, T, dark);
  t.vline(1, 0, 15, shade(dark, 0.15));
  t.vline(14, 0, 15, mix(dark, t.pal.outline, 0.3));
}

/** Barrière (fond transparent, raccordable horizontalement). */
export function drawFence(t: Tile): void {
  const { wood, woodDark, stone, stoneDark, outline } = t.pal;
  switch (t.theme) {
    case 'dungeon': {
      for (const x of [1, 5, 9, 13]) {
        t.vline(x, 2, 15, stone);
        t.vline(x + 1, 3, 15, stoneDark);
        t.set(x, 1, shade(stone, 0.3));
      }
      for (const y of [4, 12]) t.hline(0, 15, y, stone);
      for (const y of [5, 13]) t.hline(0, 15, y, stoneDark);
      break;
    }
    case 'interior': {
      t.rect(0, 3, T, 2, shade(wood, 0.2));
      t.hline(0, 15, 5, woodDark);
      for (const x of [1, 5, 9, 13]) {
        t.vline(x, 6, 13, wood);
        t.vline(x + 1, 6, 13, woodDark);
        t.set(x, 9, shade(wood, 0.3));
      }
      t.rect(0, 14, T, 2, woodDark);
      break;
    }
    case 'desert':
    case 'cave': {
      for (const x of [3, 12]) {
        t.rect(x, 3, 2, 12, wood);
        t.vline(x + 1, 3, 14, woodDark);
        t.set(x, 3, shade(wood, 0.3));
      }
      const rope = t.theme === 'desert' ? '#d8c08a' : shade(wood, 0.35);
      for (let x = 0; x < T; x++) {
        const sag = Math.round(1.5 * Math.sin(((x + 4) / 9) * Math.PI) ** 2);
        if (x !== 3 && x !== 4 && x !== 12 && x !== 13) {
          t.set(x, 6 + sag, rope);
          t.set(x, 10 + sag, rope);
        }
      }
      break;
    }
    default: {
      const snowy = t.theme === 'snow';
      const rail = (y: number) => {
        t.hline(0, 15, y, shade(wood, 0.15));
        t.hline(0, 15, y + 1, woodDark);
      };
      rail(6);
      rail(11);
      for (const x of [2, 10]) {
        t.rect(x, 3, 3, 12, wood);
        t.vline(x + 2, 3, 14, woodDark);
        t.vline(x, 3, 14, shade(wood, 0.2));
        t.set(x + 1, 2, wood);
        if (snowy) {
          t.hline(x, x + 2, 2, '#f4f8fc');
          t.set(x + 1, 1, '#f4f8fc');
        }
      }
      if (snowy) {
        t.hline(0, 1, 5, '#f4f8fc');
        t.hline(5, 9, 5, '#f4f8fc');
        t.hline(13, 15, 5, '#f4f8fc');
      }
      if (t.theme === 'forest') {
        t.hline(0, 15, 7, mix(wood, woodDark, 0.5));
        t.hline(0, 15, 12, mix(wood, woodDark, 0.5));
      }
    }
  }
  t.outlined(outline);
  t.shadow(8, 15.2, 8, 1.2, 0.22);
}

/** Pont vertical (planches horizontales, garde-fous), fond transparent sur les côtés. */
export function drawBridge(t: Tile): void {
  const { wood, woodDark, stone, stoneDark, outline } = t.pal;
  if (t.theme === 'dungeon') {
    for (let y = 0; y < T; y++) {
      for (let x = 2; x <= 13; x++) {
        const edge = y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 3) % 6 === 0;
        t.set(x, y, edge ? stoneDark : y % 4 === 0 ? shade(stone, 0.2) : stone);
      }
    }
    for (const x of [1, 14]) t.vline(x, 0, 15, stoneDark);
    return;
  }
  const rope = t.theme === 'cave';
  for (let y = 0; y < T; y++) {
    const ly = y % 4;
    if (rope && ly === 3) continue;
    for (let x = 2; x <= 13; x++) {
      const tone =
        ly === 0 ? shade(wood, 0.2) : ly === 3 ? woodDark : (x + y * 3) % 7 === 0 ? mix(wood, woodDark, 0.5) : wood;
      t.set(x, y, tone);
    }
  }
  for (const x of [1, 14]) {
    t.vline(x, 0, 15, rope ? shade(wood, 0.35) : woodDark);
    if (!rope) t.vline(x === 1 ? 0 : 15, 0, 15, x === 1 ? shade(wood, 0.15) : woodDark);
  }
  if (t.theme === 'snow') {
    t.vline(0, 0, 15, '#f4f8fc');
    t.vline(15, 0, 15, '#dce8f4');
  }
  for (let y = 0; y < T; y++) {
    if (!t.filled(0, y)) t.set(0, y, outline);
    if (!t.filled(15, y)) t.set(15, y, outline);
  }
}

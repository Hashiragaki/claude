import { mix, outlineOf, shade } from '../../shared/color';
import { PixelCanvas } from '../canvas';
import {
  ACCESSORIES,
  BACK_HAIR,
  FRONT_HAIR,
  HEADS,
  type Accessory,
  type Facing,
  type HairStyle,
  type Template,
} from './templates';

export type OutfitStyle = 'tunic' | 'robe' | 'armor' | 'dress';
export type Direction = 'down' | 'left' | 'right' | 'up';

/** Apparence complète d'un personnage de charset. */
export interface CharsetLook {
  skinTone: string;
  hairColor: string;
  outfitColor: string;
  hairStyle: HairStyle;
  outfitStyle: OutfitStyle;
  accessory: Accessory;
  outlineColor?: string;
  accentColor?: string;
}

export const FRAME_W = 16;
export const FRAME_H = 24;
/** Ordre des lignes de la planche. */
export const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];
/** Colonnes : pas A, repos, pas B. */
export const STEPS = [1, 0, -1] as const;

/** Trois tons : ombre, base, lumière. */
type Tones = [string, string, string];

const tones3 = (c: string, dark = 0.32, light = 0.22): Tones => [shade(c, -dark), c, shade(c, light)];

interface Colors {
  skin: Tones;
  hair: Tones;
  outfit: Tones;
  accent: Tones;
  pants: Tones;
  boots: Tones;
  steel: Tones;
  gold: Tones;
  leather: Tones;
  outline: string;
  eye: string;
}

function resolveColors(look: CharsetLook): Colors {
  const accent = look.accentColor ?? mix(shade(look.outfitColor, 0.1), '#f0c040', 0.55);
  return {
    skin: tones3(look.skinTone, 0.2, 0.12),
    hair: tones3(look.hairColor, 0.34, 0.26),
    outfit: tones3(look.outfitColor),
    accent: tones3(accent),
    pants: tones3(mix(shade(look.outfitColor, -0.45), '#3b3346', 0.55), 0.3, 0.18),
    boots: ['#2e1f1a', '#4e3426', '#6e4c34'],
    steel: ['#5a6078', '#9aa3b8', '#d4dae6'],
    gold: ['#b0701e', '#f0b83a', '#fff0a0'],
    leather: ['#3e2618', '#5e3c24', '#7e5634'],
    outline: look.outlineColor ?? outlineOf(look.outfitColor),
    eye: '#1c1424',
  };
}

type Painter = (x: number, y: number, color: string) => void;

function drawTemplate(p: Painter, tpl: Template | undefined, dy: number, map: Record<string, string>): void {
  if (!tpl) return;
  tpl.rows.forEach((row, j) => {
    for (let x = 0; x < row.length; x++) {
      const color = map[row[x] as string];
      if (color) p(x, tpl.y0 + j + dy, color);
    }
  });
}

interface FrameState {
  facing: Facing;
  /** 1 = pas A, 0 = repos, -1 = pas B. */
  step: number;
  bob: number;
}

/** Jambes (vue de face ou de dos). */
function drawLegsFront(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const pants = look.outfitStyle === 'armor' ? c.steel : c.pants;
  const boots = look.outfitStyle === 'armor' ? ([c.steel[0], c.steel[0], c.steel[1]] as Tones) : c.boots;
  const hip = 18 + s.bob;
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 5 : 9;
    const lifted = (s.step === 1 && side === 0) || (s.step === -1 && side === 1);
    const bottom = lifted ? 21 : 22;
    for (let y = hip; y <= bottom - 2; y++) {
      p(x0, y, side === 0 ? pants[1] : pants[0]);
      p(x0 + 1, y, side === 0 ? pants[1] : pants[0]);
    }
    for (let y = bottom - 1; y <= bottom; y++) {
      p(x0, y, boots[1]);
      p(x0 + 1, y, side === 0 ? boots[1] : boots[0]);
    }
    p(x0, bottom - 1, boots[2]);
    if (s.facing === 'down') p(side === 0 ? x0 - 1 : x0 + 2, bottom, boots[0]);
  }
  // Bassin
  for (let x = 5; x <= 10; x++) p(x, hip, x >= 9 ? pants[0] : pants[1]);
}

/** Jambes de profil (vers la droite). */
function drawLegsSide(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const pants = look.outfitStyle === 'armor' ? c.steel : c.pants;
  const boots = look.outfitStyle === 'armor' ? ([c.steel[0], c.steel[0], c.steel[1]] as Tones) : c.boots;
  const hip = 18 + s.bob;
  for (let x = 6; x <= 10; x++) p(x, hip, pants[1]);
  if (s.step === 0) {
    for (let y = hip + 1; y <= 20; y++) {
      p(7, y, pants[0]);
      p(8, y, pants[1]);
      p(9, y, pants[1]);
    }
    for (const y of [21, 22]) for (let x = 7; x <= 9; x++) p(x, y, boots[1]);
    p(10, 22, boots[1]);
    p(7, 21, boots[2]);
    return;
  }
  // Jambe arrière (plus sombre) puis jambe avant.
  const back: [number, number][] = [
    [7, hip + 1],
    [6, hip + 2],
    [6, hip + 3],
  ];
  for (const [x, y] of back) {
    p(x, y, pants[0]);
    p(x + 1, y, pants[0]);
  }
  p(5, 21, boots[0]);
  p(6, 21, boots[0]);
  p(5, 22, boots[0]);
  p(6, 22, boots[0]);
  p(4, 22, boots[0]);
  const front: [number, number][] = [
    [8, hip + 1],
    [9, hip + 2],
    [9, hip + 3],
  ];
  for (const [x, y] of front) {
    p(x, y, pants[1]);
    p(x + 1, y, pants[1]);
  }
  for (const y of [21, 22]) {
    p(9, y, boots[1]);
    p(10, y, boots[1]);
  }
  p(11, 22, boots[1]);
  p(9, 21, boots[2]);
}

function torsoColors(look: CharsetLook, c: Colors): Tones {
  return look.outfitStyle === 'armor' ? c.steel : c.outfit;
}

/** Torse, ceinture et bas de vêtement (vue de face / dos). */
function drawTorsoFront(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const t = torsoColors(look, c);
  const top = 13 + s.bob;
  const style = look.outfitStyle;
  for (let y = top; y <= top + 4; y++) {
    for (let x = 5; x <= 10; x++) p(x, y, x === 5 ? t[2] : x === 10 ? t[0] : t[1]);
  }
  if (style === 'armor') {
    for (let y = top + 1; y <= top + 4; y++) {
      p(7, y, c.outfit[1]);
      p(8, y, c.outfit[0]);
    }
    p(6, top, t[2]);
  } else if (s.facing === 'down' && style !== 'dress') {
    p(7, top, c.skin[0]);
    p(8, top, c.skin[0]);
  }
  if (style === 'dress') {
    for (let x = 5; x <= 10; x++) p(x, top + 3, x === 10 ? c.accent[0] : c.accent[1]);
    if (s.facing === 'down') p(7, top + 3, c.accent[2]);
  } else {
    const belt = style === 'robe' ? c.accent : c.leather;
    for (let x = 5; x <= 10; x++) p(x, top + 3, x === 10 ? belt[0] : belt[1]);
    if (s.facing === 'down') {
      p(7, top + 3, c.gold[1]);
      p(8, top + 3, c.gold[0]);
    }
  }
}

function drawTorsoSide(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const t = torsoColors(look, c);
  const top = 13 + s.bob;
  for (let y = top; y <= top + 4; y++) {
    for (let x = 6; x <= 10; x++) p(x, y, x === 6 ? t[0] : x === 10 ? t[2] : t[1]);
  }
  if (look.outfitStyle === 'armor') for (let y = top + 1; y <= top + 4; y++) p(10, y, c.outfit[1]);
  const belt = look.outfitStyle === 'dress' || look.outfitStyle === 'robe' ? c.accent : c.leather;
  for (let x = 6; x <= 10; x++) p(x, top + 3, belt[x === 6 ? 0 : 1]);
}

/** Jupe ou robe longue : couvre les jambes, l'ourlet se balance pendant la marche. */
function drawSkirt(p: Painter, s: FrameState, c: Colors, look: CharsetLook, side: boolean): void {
  const o = c.outfit;
  const long = look.outfitStyle === 'robe';
  const top = 17 + s.bob;
  const bottom = long ? 21 : 20;
  for (let y = top; y <= bottom; y++) {
    const spread = Math.min(2, Math.floor((y - top + (long ? 0 : 2)) / 2));
    let x0 = (side ? 6 : 5) - spread;
    let x1 = 10 + spread - (side ? 1 : 0);
    if (y >= bottom - 1 && s.step !== 0) {
      if (side) x0 -= 1;
      else {
        x0 -= s.step;
        x1 -= s.step;
      }
    }
    const hem = y === bottom;
    for (let x = x0; x <= x1; x++) {
      const tone = x === x0 ? 2 : x === x1 ? 0 : 1;
      p(x, y, hem ? c.accent[tone === 2 ? 1 : tone] : o[tone]);
    }
  }
  const shoe = long ? c.boots : ([c.accent[0], c.accent[0], c.accent[1]] as Tones);
  if (side) {
    const fx = s.step === 0 ? 8 : 10;
    if (!long) p(fx, 21, c.skin[0]);
    p(fx, 22, shoe[1]);
    p(fx + 1, 22, shoe[1]);
    if (s.step !== 0) {
      if (!long) p(6, 21, c.skin[0]);
      p(5, 22, shoe[0]);
      p(6, 22, shoe[0]);
    }
    return;
  }
  for (const [x0, show] of [
    [5, s.step !== -1],
    [9, s.step !== 1],
  ] as const) {
    if (!show) continue;
    if (!long) {
      p(x0, 21, c.skin[1]);
      p(x0 + 1, 21, c.skin[0]);
    }
    p(x0, 22, shoe[1]);
    p(x0 + 1, 22, shoe[0]);
  }
}

/** Bras (vue de face / dos) avec balancement. */
function drawArmsFront(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const sleeve = look.outfitStyle === 'armor' ? c.steel : c.outfit;
  const top = 13 + s.bob;
  for (const side of [0, 1]) {
    const x = side === 0 ? 4 : 11;
    const swing = s.step === 0 ? 0 : (side === 0 ? s.step : -s.step) * (s.facing === 'up' ? -1 : 1);
    const len = 3 + (swing > 0 ? 1 : swing < 0 ? -1 : 0);
    for (let y = top; y < top + len; y++) p(x, y, side === 0 ? sleeve[1] : sleeve[0]);
    p(x, top + len, side === 0 ? c.skin[1] : c.skin[0]);
    if (look.outfitStyle === 'armor') {
      p(x, top, c.accent[1]);
      p(side === 0 ? x - 1 : x + 1, top, c.accent[0]);
    }
    if (look.outfitStyle === 'robe') p(side === 0 ? x - 1 : x + 1, top + len - 1, sleeve[0]);
  }
}

function drawArmSide(p: Painter, s: FrameState, c: Colors, look: CharsetLook): void {
  const sleeve = look.outfitStyle === 'armor' ? c.steel : c.outfit;
  const top = 13 + s.bob;
  const path: [number, number][] =
    s.step === 0
      ? [
          [8, top],
          [8, top + 1],
          [8, top + 2],
          [8, top + 3],
        ]
      : s.step === 1
        ? [
            [8, top],
            [8, top + 1],
            [9, top + 2],
            [10, top + 3],
          ]
        : [
            [8, top],
            [7, top + 1],
            [6, top + 2],
            [5, top + 3],
          ];
  path.forEach(([x, y], i) => {
    if (i === path.length - 1) p(x, y, c.skin[1]);
    else p(x, y, i === 0 ? sleeve[2] : sleeve[1]);
  });
  if (look.outfitStyle === 'armor') {
    p(7, top, c.accent[1]);
    p(8, top, c.accent[2]);
    p(9, top, c.accent[1]);
  }
}

function headMap(c: Colors, look: CharsetLook): Record<string, string> {
  const hood = look.hairStyle === 'hood';
  const cloth = hood ? c.outfit : c.accent;
  return {
    S: c.skin[1],
    s: c.skin[0],
    K: c.skin[2],
    E: c.eye,
    H: c.hair[1],
    h: c.hair[0],
    L: c.hair[2],
    M: cloth[1],
    m: cloth[0],
    Q: cloth[2],
  };
}

function accessoryMap(look: CharsetLook, c: Colors): Record<string, string> {
  const base = look.accessory === 'helmet' ? c.steel : c.accent;
  return {
    M: base[1],
    m: base[0],
    Q: base[2],
    Y: look.accessory === 'hat' ? shade(base[0], -0.3) : c.gold[1],
    y: look.accessory === 'hat' ? shade(base[0], -0.45) : c.gold[0],
    R: '#e0344a',
    X: '#2a2438',
    W: '#dff4ff',
  };
}

/** Dessine une frame de 16 × 24 (vers la droite pour `left`, puis retournée). */
export function drawCharsetFrame(look: CharsetLook, direction: Direction, step: number): PixelCanvas {
  const c = resolveColors(look);
  const facing: Facing = direction === 'left' ? 'right' : direction;
  const frame = new PixelCanvas(FRAME_W, FRAME_H);
  const p: Painter = (x, y, color) => frame.set(x, y, color);
  const s: FrameState = { facing, step, bob: step === 0 ? 0 : -1 };
  const side = facing === 'right';
  const covered = look.outfitStyle === 'robe' || look.outfitStyle === 'dress';
  const hMap = headMap(c, look);

  if (facing !== 'up') drawTemplate(p, BACK_HAIR[look.hairStyle]?.[facing], s.bob, hMap);
  if (!covered) (side ? drawLegsSide : drawLegsFront)(p, s, c, look);
  if (side) {
    drawTorsoSide(p, s, c, look);
    if (covered) drawSkirt(p, s, c, look, true);
    drawArmSide(p, s, c, look);
  } else {
    drawArmsFront(p, s, c, look);
    drawTorsoFront(p, s, c, look);
    if (covered) drawSkirt(p, s, c, look, false);
  }
  drawTemplate(p, HEADS[facing], s.bob, hMap);
  drawTemplate(p, FRONT_HAIR[look.hairStyle][facing], s.bob, hMap);
  if (facing === 'up') drawTemplate(p, BACK_HAIR[look.hairStyle]?.up, s.bob, hMap);
  if (look.accessory !== 'none') {
    drawTemplate(p, ACCESSORIES[look.accessory][facing], s.bob, accessoryMap(look, c));
  }
  frame.outline(c.outline);
  return direction === 'left' ? frame.flipX() : frame;
}

/** Planche complète 48 × 96 : lignes bas, gauche, droite, haut ; colonnes pas A, repos, pas B. */
export function drawCharsetSheet(look: CharsetLook): PixelCanvas {
  const sheet = new PixelCanvas(FRAME_W * 3, FRAME_H * 4);
  DIRECTIONS.forEach((dir, row) => {
    STEPS.forEach((step, col) => {
      sheet.draw(drawCharsetFrame(look, dir, step), col * FRAME_W, row * FRAME_H);
    });
  });
  return sheet;
}

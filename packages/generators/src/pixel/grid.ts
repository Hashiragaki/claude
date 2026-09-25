import { z } from 'zod';
import { parseColor, toHex } from '../shared/color';
import { PixelCanvas } from './canvas';

/** Couleur de palette pixel-art : `#rrggbb`, `#rrggbbaa` ou `transparent`. */
export const pixelColorSchema = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|transparent)$/,
    'Couleur attendue : « #rrggbb », « #rrggbbaa » ou « transparent ».',
  );

/** Clé de palette : un seul caractère ASCII visible (pas d'espace). */
export const paletteKeySchema = z
  .string()
  .regex(/^[!-~]$/, 'Chaque clé de palette doit être un seul caractère ASCII visible (ex. « . », « a », « 1 »).');

export const pixelPaletteSchema = z.record(paletteKeySchema, pixelColorSchema);

export interface PixelGrid {
  palette: Record<string, string>;
  rows: string[];
}

/**
 * Vérifie une grille (nombre de lignes, longueur, caractères connus) et signale chaque problème
 * avec un message clair en français, pour que Claude puisse corriger sa réponse.
 */
export function checkGrid(
  grid: PixelGrid,
  width: number,
  height: number,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  if (grid.rows.length !== height) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'rows'],
      message: `« rows » doit contenir exactement ${height} lignes (hauteur), reçu ${grid.rows.length}.`,
    });
  }
  let reported = 0;
  grid.rows.forEach((row, i) => {
    if (reported >= 8) return;
    if (row.length !== width) {
      reported++;
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'rows', i],
        message: `La ligne ${i} fait ${row.length} caractères au lieu de ${width} (largeur).`,
      });
    }
    const unknown = [...new Set(row)].filter((ch) => !(ch in grid.palette));
    if (unknown.length > 0) {
      reported++;
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'rows', i],
        message:
          `La ligne ${i} utilise des caractères absents de « palette » : ${unknown.map((c) => `« ${c} »`).join(', ')}. ` +
          'Ajoutez-les à la palette ou remplacez-les.',
      });
    }
  });
}

/** Dessine une grille de caractères sur une toile, à la position donnée. */
export function drawGrid(canvas: PixelCanvas, grid: PixelGrid, dx = 0, dy = 0): void {
  const colors = new Map(Object.entries(grid.palette).map(([k, v]) => [k, parseColor(v)]));
  grid.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors.get(row[x] as string);
      if (c && c[3] > 0) canvas.set(dx + x, dy + y, c);
    }
  });
}

/** Grille → pixels RVBA (les caractères inconnus sont transparents). */
export function gridToRgba(grid: PixelGrid, width: number, height: number): Uint8Array {
  const canvas = new PixelCanvas(width, height);
  drawGrid(canvas, grid);
  return canvas.data;
}

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=-~^:;!?<>()[]{}/|';

/** Toile → grille de caractères (`.` = transparent). Au-delà de ~90 couleurs, lève une erreur. */
export function canvasToGrid(canvas: PixelCanvas): PixelGrid {
  const palette: Record<string, string> = {};
  const byColor = new Map<string, string>();
  const rows: string[] = [];
  let used = false;
  for (let y = 0; y < canvas.height; y++) {
    let row = '';
    for (let x = 0; x < canvas.width; x++) {
      const c = canvas.get(x, y);
      if (c[3] === 0) {
        row += '.';
        used = true;
        continue;
      }
      const hex = toHex(c);
      let key = byColor.get(hex);
      if (!key) {
        key = KEY_CHARS[byColor.size];
        if (!key) throw new Error('Trop de couleurs pour une grille pixel-art');
        byColor.set(hex, key);
        palette[key] = hex;
      }
      row += key;
    }
    rows.push(row);
  }
  return { palette: used ? { '.': 'transparent', ...palette } : palette, rows };
}

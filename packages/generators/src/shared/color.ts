import { z } from 'zod';

/** Couleur RVBA, composantes 0–255. */
export type Rgba = [number, number, number, number];

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX_ANY = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Schéma d'une couleur `#rrggbb` (utilisable dans les specs envoyées à Claude). */
export const hexColorSchema = z.string().regex(HEX6, 'Couleur attendue au format « #rrggbb » (ex. « #3a7bd5 »).');

export function isHexColor(value: string): boolean {
  return HEX_ANY.test(value);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Convertit `#rgb`, `#rrggbb`, `#rrggbbaa` ou `transparent` en RVBA. */
export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'none') return [0, 0, 0, 0];
  if (!HEX_ANY.test(v)) throw new Error(`Couleur invalide : « ${value} »`);
  let hex = v.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), hex.length === 8 ? n(6) : 255];
}

const byte = (v: number) =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, '0');

/** RVB(A) → `#rrggbb` (ou `#rrggbbaa` si l'alpha n'est pas opaque). */
export function toHex(rgba: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 255] = rgba;
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 255 ? byte(a) : ''}`;
}

/** Mélange linéaire de deux couleurs (`t = 0` → `a`, `t = 1` → `b`). */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return toHex(ca.map((v, i) => v + ((cb[i] ?? 0) - v) * t));
}

/** Couleur avec une opacité donnée, au format `#rrggbbaa`. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return toHex([r, g, b, Math.round(clamp(alpha, 0, 1) * 255)]);
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function toHsl(color: string): Hsl {
  const [r8, g8, b8] = parseColor(color);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** Teinte (degrés), saturation et luminosité (0–1) → `#rrggbb`. */
export function hsl(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  if (ss === 0) return toHex([ll * 255, ll * 255, ll * 255]);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex([channel(hh + 1 / 3) * 255, channel(hh) * 255, channel(hh - 1 / 3) * 255]);
}

/** Déplace une teinte vers une teinte cible par le chemin le plus court. */
function shiftHue(h: number, target: number, amount: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + d * amount;
}

/**
 * Ombre ou éclaire une couleur « façon peintre » : les ombres glissent vers le bleu-violet et
 * gagnent en saturation, les lumières glissent vers le jaune. `amount` ∈ [-1, 1].
 */
export function shade(color: string, amount: number): string {
  const { h, s, l } = toHsl(color);
  if (amount >= 0) {
    const nh = s > 0.05 ? shiftHue(h, 55, amount * 0.35) : h;
    return hsl(nh, s * (1 - amount * 0.15), l + (1 - l) * amount);
  }
  const a = -amount;
  const nh = s > 0.05 ? shiftHue(h, 250, a * 0.3) : h;
  return hsl(nh, clamp(s + a * 0.12, 0, 1), l * (1 - a));
}

export const lighten = (color: string, amount: number) => shade(color, Math.abs(amount));
export const darken = (color: string, amount: number) => shade(color, -Math.abs(amount));

/** Rampe de tons du plus sombre au plus clair, centrée sur la couleur de base. */
export function ramp(color: string, steps = 4, spread = 0.45): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i / (steps - 1)) * 2 - 1;
    out.push(Math.abs(t) < 1e-6 ? normalizeHex(color) : shade(color, t * spread));
  }
  return out;
}

export function normalizeHex(color: string): string {
  return toHex(parseColor(color));
}

/** Luminance relative (0 = noir, 1 = blanc). */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgba;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Couleur de contour sombre dérivée d'une couleur de base (jamais un noir pur). */
export function outlineOf(color: string): string {
  const { h, s } = toHsl(color);
  return hsl(shiftHue(h, 260, 0.4), clamp(s * 0.6 + 0.15, 0, 0.6), 0.13);
}

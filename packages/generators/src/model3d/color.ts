import type { Rng } from '@forge/core';

/** Couleurs : conversions hexadécimal / HSL / linéaire et variations aléatoires légères. */

export type Rgb = [number, number, number];

/** `#rgb` ou `#rrggbb` → composantes sRGB dans [0, 1]. */
export function parseHex(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB → linéaire (espace attendu par glTF pour baseColorFactor et emissiveFactor). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): Rgb {
  const [r, g, b] = parseHex(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function rgbToHsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** Variation légère de teinte, saturation et luminosité (couleurs « vivantes » d'une graine à l'autre). */
export function jitter(hex: string, rng: Rng, amount = 1): string {
  const [h, s, l] = rgbToHsl(parseHex(hex));
  return toHex(
    hslToRgb([
      h + rng.float(-0.02, 0.02) * amount,
      clamp01(s + rng.float(-0.06, 0.06) * amount),
      clamp01(l + rng.float(-0.05, 0.05) * amount),
    ]),
  );
}

/** Éclaircit (`amount` > 0) ou assombrit (`amount` < 0) une couleur en luminosité HSL. */
export function shade(hex: string, amount: number): string {
  const [h, s, l] = rgbToHsl(parseHex(hex));
  return toHex(hslToRgb([h, s, clamp01(l + amount)]));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

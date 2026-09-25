/**
 * Outils réservés aux tests : contexte de rendu basé sur resvg et décodeur PNG minimal
 * (RVBA 8 bits, tous filtres) pour vérifier les pixels produits.
 *
 * Le décodage lui-même vit dans `../encode/png` (utilisé aussi par la critique visuelle
 * côté serveur) ; ce module ne fait que garder la forme historique attendue par les tests
 * (`DecodedPng.data` plutôt que `.rgba`).
 */
import { Resvg } from '@resvg/resvg-js';
import { decodePng as decodePngRgba } from '../encode/png';
import type { RenderContext } from '../types';

export const resvgContext: RenderContext = {
  async rasterizeSvg(svg, width) {
    return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } })
      .render()
      .asPng();
  },
};

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array | string): bytes is Uint8Array {
  return typeof bytes !== 'string' && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Décode un PNG RVBA 8 bits non entrelacé. */
export function decodePng(png: Uint8Array): DecodedPng {
  const { width, height, rgba } = decodePngRgba(png);
  return { width, height, data: rgba };
}

/** Alpha d'un pixel décodé. */
export function alphaAt(img: DecodedPng, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3] as number;
}

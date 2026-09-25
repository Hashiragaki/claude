/**
 * Outils réservés aux tests : contexte de rendu basé sur resvg et décodeur PNG minimal
 * (RVBA 8 bits, tous filtres) pour vérifier les pixels produits.
 */
import { Resvg } from '@resvg/resvg-js';
import { unzlibSync } from 'fflate';
import type { RenderContext } from '../types';

export const resvgContext: RenderContext = {
  async rasterizeSvg(svg, width) {
    return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
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
  if (!isPng(png)) throw new Error('Signature PNG absente');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('Seuls les PNG RVBA 8 bits sont gérés');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of idat) {
    joined.set(c, p);
    p += c.length;
  }
  const raw = unzlibSync(joined);
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= 4 ? (out[y * stride + x - 4] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= 4 && y > 0 ? (out[(y - 1) * stride + x - 4] as number) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, data: out };
}

/** Alpha d'un pixel décodé. */
export function alphaAt(img: DecodedPng, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3] as number;
}

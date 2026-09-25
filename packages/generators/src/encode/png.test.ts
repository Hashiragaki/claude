import { describe, expect, it } from 'vitest';
import { decodePng, isPng } from '../shared/test-utils';
import { crc32, decodePng as decodePngRgba, encodePng, readPngSize, upscalePngNearest } from './png';

describe('encodePng', () => {
  it('produit un PNG valide aux bonnes dimensions', () => {
    const rgba = new Uint8Array(3 * 2 * 4).fill(255);
    const png = encodePng(3, 2, rgba);
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 3, height: 2 });
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('conserve exactement les pixels (aller-retour)', () => {
    const w = 7;
    const h = 5;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 3) * 11) & 0xff;
    const decoded = decodePng(encodePng(w, h, rgba));
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(Array.from(decoded.data)).toEqual(Array.from(rgba));
  });

  it('écrit des CRC corrects pour chaque bloc', () => {
    const png = encodePng(2, 2, new Uint8Array(16).fill(128));
    let offset = 8;
    while (offset < png.length) {
      const length = new DataView(png.buffer, png.byteOffset).getUint32(offset);
      const stored = new DataView(png.buffer, png.byteOffset).getUint32(offset + 8 + length);
      expect(crc32(png, offset + 4, offset + 8 + length)).toBe(stored);
      offset += 12 + length;
    }
  });

  it('calcule le CRC-32 standard', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('refuse des dimensions ou des données incohérentes', () => {
    expect(() => encodePng(0, 2, new Uint8Array(0))).toThrow(/Dimensions/);
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/incohérente/);
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('decodePng', () => {
  it('conserve exactement les pixels (aller-retour, canal RVBA)', () => {
    const w = 6;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 53 + (i >> 2) * 7) & 0xff;
    const decoded = decodePngRgba(encodePng(w, h, rgba));
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it('refuse une signature PNG absente', () => {
    expect(() => decodePngRgba(new Uint8Array([1, 2, 3]))).toThrow(/Signature/);
  });
});

describe('upscalePngNearest', () => {
  it('agrandit un PNG ×3 au plus proche voisin (dimensions et pixels)', () => {
    // 2×2, un pixel de chaque couleur : le motif ×3 doit rester des blocs 3×3 uniformes.
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 255, //
      0, 0, 255, 255, 255, 255, 0, 128,
    ]);
    const png = encodePng(2, 2, rgba);
    const upscaled = upscalePngNearest(png, 3);
    expect(readPngSize(upscaled)).toEqual({ width: 6, height: 6 });
    const decoded = decodePngRgba(upscaled);
    expect(decoded.width).toBe(6);
    expect(decoded.height).toBe(6);
    const pixelAt = (x: number, y: number) => Array.from(decoded.rgba.subarray((y * 6 + x) * 4, (y * 6 + x) * 4 + 4));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) expect(pixelAt(x, y)).toEqual([255, 0, 0, 255]);
    for (let y = 0; y < 3; y++) for (let x = 3; x < 6; x++) expect(pixelAt(x, y)).toEqual([0, 255, 0, 255]);
    for (let y = 3; y < 6; y++) for (let x = 0; x < 3; x++) expect(pixelAt(x, y)).toEqual([0, 0, 255, 255]);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) expect(pixelAt(x, y)).toEqual([255, 255, 0, 128]);
  });

  it('refuse un facteur d\'agrandissement invalide', () => {
    const png = encodePng(2, 2, new Uint8Array(16).fill(200));
    expect(() => upscalePngNearest(png, 0)).toThrow(/agrandissement/);
    expect(() => upscalePngNearest(png, 1.5)).toThrow(/agrandissement/);
  });
});

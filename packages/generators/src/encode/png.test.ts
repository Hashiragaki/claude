import { describe, expect, it } from 'vitest';
import { decodePng, isPng } from '../shared/test-utils';
import { crc32, encodePng, readPngSize } from './png';

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

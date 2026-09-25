import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from './wav';

const ascii = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

describe('encodeWav', () => {
  it('écrit un en-tête RIFF/WAVE PCM 16 bits cohérent (mono)', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWav(samples, 44100);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0)).toBe('RIFF');
    expect(ascii(wav, 8)).toBe('WAVE');
    expect(ascii(wav, 12)).toBe('fmt ');
    expect(ascii(wav, 36)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(view.getInt16(44 + 2, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(44 + 6, true)).toBe(32767);
  });

  it('entrelace deux canaux et écrête hors de [-1, 1]', () => {
    const left = new Float32Array([2, -3, Number.NaN]);
    const right = new Float32Array([0.25, 0, -1]);
    const wav = encodeWav([left, right], 32000);
    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint32(28, true)).toBe(32000 * 4);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(Math.round(0.25 * 32767));
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(0);
    expect(view.getInt16(54, true)).toBe(-32768);
  });

  it('rejette un nombre de canaux, des longueurs ou une fréquence invalides', () => {
    const a = new Float32Array(4);
    expect(() => encodeWav([a, a, a], 44100)).toThrow(/1 ou 2 canaux/);
    expect(() => encodeWav([], 44100)).toThrow(/1 ou 2 canaux/);
    expect(() => encodeWav([a, new Float32Array(3)], 44100)).toThrow(/même longueur/);
    expect(() => encodeWav(a, 100)).toThrow(/fréquence/);
  });

  it('se relit avec decodeWav', () => {
    const left = new Float32Array([0, 0.5, -0.25]);
    const right = new Float32Array([1, -1, 0.125]);
    const decoded = decodeWav(encodeWav([left, right], 22050));
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.channels).toHaveLength(2);
    decoded.channels[0].forEach((v, i) => expect(v).toBeCloseTo(left[i], 3));
    decoded.channels[1].forEach((v, i) => expect(v).toBeCloseTo(right[i], 3));
    expect(() => decodeWav(new Uint8Array(10))).toThrow(/RIFF/);
  });
});

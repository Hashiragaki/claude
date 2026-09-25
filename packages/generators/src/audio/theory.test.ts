import { describe, expect, it } from 'vitest';
import {
  adaptScale,
  chordPitchClasses,
  degreeToMidi,
  nearestChordDegree,
  parseRoman,
  SCALES,
  voiceChord,
} from './theory';

describe('théorie musicale', () => {
  it('analyse les chiffrages romains', () => {
    expect(chordPitchClasses(parseRoman('I'))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(parseRoman('vi'))).toEqual([9, 0, 4]);
    expect(chordPitchClasses(parseRoman('bVII'))).toEqual([10, 2, 5]);
    expect(chordPitchClasses(parseRoman('ii°'))).toEqual([2, 5, 8]);
    expect(chordPitchClasses(parseRoman('V7'))).toEqual([7, 11, 2, 5]);
    expect(chordPitchClasses(parseRoman('IVmaj7'))).toEqual([5, 9, 0, 4]);
    expect(() => parseRoman('VIII')).toThrow(/inconnu/);
  });

  it('adapte la gamme aux notes étrangères de l’accord', () => {
    // V en mineur naturel : la sensible (11) remplace la septième mineure (10).
    expect(adaptScale(SCALES.minor, parseRoman('V'))).toEqual([0, 2, 3, 5, 7, 8, 11]);
    // bII en mineur harmonique : le 2e degré est abaissé, la tonique reste.
    expect(adaptScale(SCALES.harmonicMinor, parseRoman('bII'))).toEqual([0, 1, 3, 5, 7, 8, 11]);
    // bVII en mineur harmonique : retour à la septième mineure.
    expect(adaptScale(SCALES.harmonicMinor, parseRoman('bVII'))).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });

  it('place les degrés et cale les notes sur l’accord', () => {
    expect(degreeToMidi(60, SCALES.major, 0)).toBe(60);
    expect(degreeToMidi(60, SCALES.major, 7)).toBe(72);
    expect(degreeToMidi(60, SCALES.major, -1)).toBe(59);
    // Ré (degré 1) sur un accord de do : glisse vers do (degré 0).
    expect(nearestChordDegree(60, SCALES.major, [0, 4, 7], 1)).toBe(0);
  });

  it('enchaîne les accords avec un minimum de mouvement', () => {
    const c = voiceChord(60, [0, 4, 7], null, 55, 72, 62);
    const f = voiceChord(60, [5, 9, 0], c, 55, 72, 62);
    const moved = f.reduce((sum, n, i) => sum + Math.abs(n - c[i]), 0);
    expect(moved).toBeLessThanOrEqual(3);
    expect(f.map((n) => n % 12).sort((a, b) => a - b)).toEqual([0, 5, 9]);
  });
});

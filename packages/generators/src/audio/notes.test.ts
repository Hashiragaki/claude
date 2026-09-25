import { describe, expect, it } from 'vitest';
import {
  formatTokens,
  midiToNoteName,
  parseDrumTrack,
  parseNoteName,
  parsePitchedTrack,
  pitchesToBody,
  tokenize,
} from './notes';

describe('notation des notes', () => {
  it('convertit noms de notes et hauteurs MIDI', () => {
    expect(parseNoteName('C4')).toBe(60);
    expect(parseNoteName('A4')).toBe(69);
    expect(parseNoteName('F#3')).toBe(54);
    expect(parseNoteName('Bb2')).toBe(46);
    expect(parseNoteName('bb2')).toBe(46);
    expect(parseNoteName('H4')).toBeNull();
    expect(parseNoteName('C10')).toBeNull();
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(36)).toBe('C2');
  });

  it('analyse durées, silences, accords et barres de mesure', () => {
    expect(tokenize(' C4:2 | R  E4 ')).toEqual(['C4:2', 'R', 'E4']);
    const track = parsePitchedTrack('C4:2 R:2 C4+E4+G4:4 | Bb3');
    expect(track.errors).toEqual([]);
    expect(track.totalSteps).toBe(9);
    expect(track.events).toEqual([
      { step: 0, length: 2, pitches: [60] },
      { step: 4, length: 4, pitches: [60, 64, 67] },
      { step: 8, length: 1, pitches: [58] },
    ]);
  });

  it('analyse les pistes de batterie et leurs combinaisons', () => {
    const drums = parseDrumTrack('K+H:2 h:2 S+H R:3');
    expect(drums.errors).toEqual([]);
    expect(drums.totalSteps).toBe(8);
    expect(drums.events.map((e) => e.hits)).toEqual([['K', 'H'], ['H'], ['S', 'H']]);
  });

  it('explique chaque jeton invalide en français', () => {
    expect(parsePitchedTrack('C4 X4:2').errors[0]).toMatch(/« X4:2 ».*note « X4 » inconnue/);
    expect(parsePitchedTrack('C4:0').errors[0]).toMatch(/durée après « : »/);
    expect(parsePitchedTrack('K:2').errors[0]).toMatch(/batterie/);
    expect(parsePitchedTrack('').errors[0]).toMatch(/vide/);
    expect(parseDrumTrack('K C4').errors[0]).toMatch(/« C4 ».*drums.*notes sont interdites/);
    expect(parseDrumTrack('K:2:3').errors[0]).toMatch(/un seul « : »/);
  });

  it('sérialise des évènements en comblant les trous par des silences', () => {
    const notes = formatTokens(
      [
        { step: 2, length: 2, body: pitchesToBody([60, 64]) },
        { step: 4, length: 1, body: 'D4' },
      ],
      16,
    );
    expect(notes).toBe('R:2 C4+E4:2 D4 R:11');
    const back = parsePitchedTrack(notes);
    expect(back.totalSteps).toBe(16);
    expect(back.events[0].pitches).toEqual([60, 64]);
    expect(formatTokens([], 300)).toBe('R:256 R:44');
  });
});

import { describe, expect, it } from 'vitest';
import { luminance, mix, outlineOf, parseColor, shade, toHex, toHsl } from './color';
import { matchKeyword, normalizeText } from './keywords';
import { colorFromText, eyeColorFromText, hairColorFromText, outfitColorFromText } from './palettes';
import { editMessage, requestMessage } from './prompt';

describe('couleurs', () => {
  it('lit et écrit les formats hexadécimaux', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseColor('#11223380')).toEqual([17, 34, 51, 128]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(toHex([17, 34, 51])).toBe('#112233');
    expect(toHex([17, 34, 51, 128])).toBe('#11223380');
    expect(() => parseColor('rouge')).toThrow(/Couleur invalide/);
  });

  it('mélange et ombre dans le bon sens', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    const base = '#3a7bd5';
    expect(luminance(shade(base, 0.4))).toBeGreaterThan(luminance(base));
    expect(luminance(shade(base, -0.4))).toBeLessThan(luminance(base));
    expect(toHsl(outlineOf('#f0c040')).l).toBeLessThan(0.2);
  });
});

describe('mots-clés', () => {
  it('ignore accents, casse et pluriels', () => {
    expect(normalizeText('Épée Œuvre')).toBe('epee oeuvre');
    const table = { sword: ['épée', 'sword'], key: ['clé', 'key'] };
    expect(matchKeyword('Deux ÉPÉES rouillées', table)).toBe('sword');
    expect(matchKeyword('une clé puis une épée', table)).toBe('key');
    expect(matchKeyword('rien à voir', table)).toBeUndefined();
    expect(matchKeyword('clémentine', table)).toBeUndefined();
  });

  it('reconnaît les couleurs de tenue, cheveux et yeux', () => {
    expect(colorFromText('une potion bleue')).toBeDefined();
    expect(hairColorFromText('Une fille blonde')).toBe('#e2b95a');
    expect(hairColorFromText('cheveux roux')).toBe('#c2562c');
    expect(eyeColorFromText('aux yeux verts')).toBe(colorFromText('vert'));
    expect(outfitColorFromText('cheveux noirs et robe rouge')).toBe(colorFromText('rouge'));
  });
});

describe('prompts', () => {
  it('intègre la description et les paramètres', () => {
    const msg = requestMessage('a thing', 'Un chat', { prompt: 'Un chat', width: 32, palette: ['#ff0000'] });
    expect(msg).toContain('Un chat');
    expect(msg).toContain('width: 32');
    expect(msg).toContain('#ff0000');
    const edit = editMessage({ a: 1 }, 'plus sombre', { style: 'soft' });
    expect(edit).toContain('{"a":1}');
    expect(edit).toContain('plus sombre');
  });
});

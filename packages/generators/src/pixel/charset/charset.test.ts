import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { alphaAt, decodePng, resvgContext } from '../../shared/test-utils';
import { drawCharsetFrame, drawCharsetSheet } from './draw';
import { charsetGenerator as gen, type CharsetSpec } from './generator';
import { CHARSET_ACCESSORIES, CHARSET_HAIR_STYLES, CHARSET_OUTFITS } from './generator';

const claudeLikeSpec: CharsetSpec = {
  skinTone: '#f0c8a0',
  hairColor: '#3a2a4a',
  outfitColor: '#2f6fb0',
  hairStyle: 'ponytail',
  outfitStyle: 'tunic',
  accessory: 'none',
  accentColor: '#e8b040',
};

function frameBytes(canvas: { data: Uint8Array }): number[] {
  return Array.from(canvas.data);
}

describe('charset — paramètres et schémas', () => {
  it('applique les valeurs par défaut', () => {
    expect(gen.paramsSchema.parse({})).toEqual({ prompt: '' });
    expect(() => z.toJSONSchema(gen.specSchema)).not.toThrow();
    expect(() => z.toJSONSchema(gen.paramsSchema)).not.toThrow();
  });

  it('rejette les valeurs invalides', () => {
    const r = gen.specSchema.safeParse({ ...claudeLikeSpec, skinTone: 'beige', hairStyle: 'afro' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/#rrggbb/);
  });

  it('est déterministe et suit la description', () => {
    const params = gen.paramsSchema.parse({ prompt: 'Un chevalier en armure' });
    const a = gen.procedural(params, new Rng(7));
    expect(gen.procedural(params, new Rng(7))).toEqual(a);
    expect(gen.specSchema.safeParse(a).success).toBe(true);
    expect(a.outfitStyle).toBe('armor');
    expect(a.accessory).toBe('helmet');
    const mage = gen.procedural(gen.paramsSchema.parse({ prompt: 'une sorcière' }), new Rng(1));
    expect(mage.outfitStyle).toBe('robe');
    const imposed = gen.procedural(gen.paramsSchema.parse({ prompt: 'chevalier', hairStyle: 'bald', skinTone: '#8d5a3b' }), new Rng(1));
    expect(imposed.hairStyle).toBe('bald');
    expect(imposed.skinTone).toBe('#8d5a3b');
  });
});

describe('charset — dessin', () => {
  it('produit une planche 48 × 96 (3 × 4 frames de 16 × 24)', async () => {
    const result = await gen.render(claudeLikeSpec, gen.paramsSchema.parse({}), resvgContext);
    const img = decodePng(result.files.find((f) => f.role === 'main')!.data as Uint8Array);
    expect([img.width, img.height]).toEqual([48, 96]);
    expect(result.info).toEqual({ frameWidth: 16, frameHeight: 24, columns: 3, rows: 4, pixelArt: true });
    expect(JSON.parse(result.files.find((f) => f.role === 'source')!.data as string)).toEqual(claudeLikeSpec);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        expect(alphaAt(img, col * 16, row * 24)).toBe(0);
        let filled = 0;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) if (alphaAt(img, col * 16 + x, row * 24 + y) > 0) filled++;
        expect(filled).toBeGreaterThan(120);
      }
    }
  });

  it('anime la marche et oriente correctement le personnage', () => {
    const idle = drawCharsetFrame(claudeLikeSpec, 'down', 0);
    const stepA = drawCharsetFrame(claudeLikeSpec, 'down', 1);
    const stepB = drawCharsetFrame(claudeLikeSpec, 'down', -1);
    expect(frameBytes(stepA)).not.toEqual(frameBytes(idle));
    expect(frameBytes(stepB)).not.toEqual(frameBytes(stepA));
    const right = drawCharsetFrame(claudeLikeSpec, 'right', 0);
    const left = drawCharsetFrame(claudeLikeSpec, 'left', 0);
    expect(frameBytes(left)).toEqual(frameBytes(right.flipX()));
    expect(frameBytes(drawCharsetFrame(claudeLikeSpec, 'up', 0))).not.toEqual(frameBytes(idle));
  });

  it('dessine toutes les combinaisons sans erreur', () => {
    for (const hairStyle of CHARSET_HAIR_STYLES) {
      for (const outfitStyle of CHARSET_OUTFITS) {
        for (const accessory of CHARSET_ACCESSORIES) {
          const sheet = drawCharsetSheet({ ...claudeLikeSpec, hairStyle, outfitStyle, accessory });
          expect(sheet.width).toBe(48);
        }
      }
    }
  });

  it('rend un charset procédural de modèle de projet', async () => {
    const spec = gen.procedural(gen.paramsSchema.parse({ prompt: 'Héroïne aux cheveux roux' }), new Rng(2024));
    expect(spec.hairColor).toBe('#c2562c');
    const result = await gen.render(spec, gen.paramsSchema.parse({}), resvgContext);
    expect(decodePng(result.files[0]!.data as Uint8Array).width).toBe(48);
  });
});

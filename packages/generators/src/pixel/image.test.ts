import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodePng, isPng, resvgContext } from '../shared/test-utils';
import { imagePixelGenerator as gen, pixelSpecToRgba, type ImagePixelSpec } from './image';

const claudeLikeSpec: ImagePixelSpec = {
  width: 8,
  height: 8,
  palette: { '.': 'transparent', o: '#1c1424', r: '#d83a3a', l: '#ff8a7a', w: '#ffffff' },
  rows: ['........', '.oo..oo.', 'orrooRro', 'orwrrrro', 'orrrrrro', '.orrrro.', '..orro..', '...oo...'].map((r) =>
    r.replace('R', 'l'),
  ),
};

describe('image.pixel — paramètres et schémas', () => {
  it('applique les valeurs par défaut', () => {
    expect(gen.paramsSchema.parse({})).toEqual({ prompt: '', width: 16, height: 16, subject: 'item' });
    expect(gen.paramsSchema.parse({ prompt: 'une épée' }).prompt).toBe('une épée');
  });

  it('exporte un schéma JSON pour l’outil de Claude', () => {
    const schema = z.toJSONSchema(gen.specSchema) as { type: string; required: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['width', 'height', 'palette', 'rows']));
    expect(() => z.toJSONSchema(gen.paramsSchema)).not.toThrow();
  });

  it('rejette une grille incohérente avec des messages explicites', () => {
    const bad = { ...claudeLikeSpec, rows: [...claudeLikeSpec.rows.slice(0, 7), 'oozz'] };
    const result = gen.specSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join('\n') ?? '';
    expect(messages).toMatch(/La ligne 7 fait 4 caractères au lieu de 8/);
    expect(messages).toMatch(/absents de « palette » : « z »/);
    const short = gen.specSchema.safeParse({ ...claudeLikeSpec, rows: claudeLikeSpec.rows.slice(0, 3) });
    expect(short.error?.issues[0]?.message).toMatch(/exactement 8 lignes/);
    const badColor = gen.specSchema.safeParse({ ...claudeLikeSpec, palette: { ...claudeLikeSpec.palette, r: 'red' } });
    expect(badColor.error?.issues[0]?.message).toMatch(/#rrggbb/);
  });
});

describe('image.pixel — procédural et rendu', () => {
  it('est déterministe et produit une spec valide', () => {
    for (const subject of ['item', 'icon', 'creature', 'prop', 'character'] as const) {
      const params = gen.paramsSchema.parse({ subject });
      const a = gen.procedural(params, new Rng(42));
      const b = gen.procedural(params, new Rng(42));
      expect(a).toEqual(b);
      expect(gen.specSchema.safeParse(a).success).toBe(true);
    }
  });

  it('choisit le motif selon les mots-clés', () => {
    const potion = gen.procedural(gen.paramsSchema.parse({ prompt: 'Potion de soin rouge' }), new Rng(1));
    const sword = gen.procedural(gen.paramsSchema.parse({ prompt: 'Une épée légendaire' }), new Rng(1));
    expect(potion.rows).not.toEqual(sword.rows);
  });

  it('respecte toutes les tailles de 8 à 64 pixels', () => {
    for (const [width, height] of [
      [8, 8],
      [16, 32],
      [64, 64],
      [24, 12],
    ] as const) {
      const spec = gen.procedural(gen.paramsSchema.parse({ width, height, prompt: 'gemme' }), new Rng(3));
      expect(gen.specSchema.safeParse(spec).success).toBe(true);
      expect(spec.rows).toHaveLength(height);
    }
  });

  it('convertit la grille en pixels RVBA', () => {
    const rgba = pixelSpecToRgba(claudeLikeSpec);
    expect(rgba).toHaveLength(8 * 8 * 4);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    const i = (3 * 8 + 2) * 4; // ligne 3, colonne 2 : « w »
    expect(Array.from(rgba.subarray(i, i + 4))).toEqual([255, 255, 255, 255]);
  });

  it('rend un PNG à la taille native et la source JSON', async () => {
    const result = await gen.render(claudeLikeSpec, gen.paramsSchema.parse({}), resvgContext);
    const main = result.files.find((f) => f.role === 'main');
    const source = result.files.find((f) => f.role === 'source');
    expect(main?.mime).toBe('image/png');
    expect(isPng(main!.data)).toBe(true);
    const img = decodePng(main!.data as Uint8Array);
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(Array.from(img.data)).toEqual(Array.from(pixelSpecToRgba(claudeLikeSpec)));
    expect(JSON.parse(source!.data as string)).toEqual(claudeLikeSpec);
    expect(result.info).toEqual({ width: 8, height: 8, pixelArt: true });
  });

  it('fournit des prompts en intégrant les paramètres', () => {
    const params = gen.paramsSchema.parse({ prompt: 'un champignon', width: 24, height: 24 });
    expect(gen.buildPrompt(params)).toContain('un champignon');
    expect(gen.buildPrompt(params)).toContain('24');
    expect(gen.buildEditPrompt(claudeLikeSpec, 'plus bleu', params)).toContain('plus bleu');
    expect(gen.systemPrompt).toMatch(/transparent/);
  });
});

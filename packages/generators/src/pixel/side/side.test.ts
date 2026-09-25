import { PLATFORM_TILE_ROLES, Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Rgba } from '../../shared/color';
import { alphaAt, decodePng, resvgContext } from '../../shared/test-utils';
import { sideTilesetGenerator as gen } from './generator';
import { SIDE_TILESET_THEMES } from './palette';
import { drawTile } from './tiles';

const TRANSPARENT_ROLES = ['platform', 'spikes', 'bridge', 'cloud', 'bush', 'flower', 'sign', 'fence'];

/** Source de pixels lisible par coordonnées (tuile dessinée ou toile synthétique de test). */
interface PixelSource {
  get(x: number, y: number): Rgba;
}

interface AxisSeam {
  baseline: number;
  wrap: number;
  maxInternal: number;
}

/** Écart RGB absolu moyen (sur R, G, B) entre deux pixels (voir `pixel/tileset/tileset.test.ts`). */
function pixelDiff(a: Rgba, b: Rgba): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

/** Score de raccord d'une tuile `size × size`, même méthode que le tileset vu de dessus. */
function seamScore(rgba: PixelSource, x0: number, y0: number, size = 16): { horizontal: AxisSeam; vertical: AxisSeam } {
  const at = (x: number, y: number) => rgba.get(x0 + x, y0 + y);
  const lineDiff = (horizontal: boolean, i: number, j: number) => {
    let sum = 0;
    for (let k = 0; k < size; k++) sum += horizontal ? pixelDiff(at(i, k), at(j, k)) : pixelDiff(at(k, i), at(k, j));
    return sum / size;
  };
  const axis = (horizontal: boolean): AxisSeam => {
    let total = 0;
    let maxInternal = 0;
    for (let i = 0; i < size - 1; i++) {
      const d = lineDiff(horizontal, i, i + 1);
      total += d;
      maxInternal = Math.max(maxInternal, d);
    }
    return { baseline: total / (size - 1), wrap: lineDiff(horizontal, size - 1, 0), maxInternal };
  };
  return { horizontal: axis(true), vertical: axis(false) };
}

function isSeamless({ horizontal, vertical }: ReturnType<typeof seamScore>): boolean {
  const ok = (a: AxisSeam) => a.wrap <= Math.max(2 * a.baseline, a.baseline + 12, 1.15 * a.maxInternal + 2);
  return ok(horizontal) && ok(vertical);
}

describe('tileset.side — paramètres et schémas', () => {
  it('applique les valeurs par défaut et accepte { prompt }', () => {
    expect(gen.paramsSchema.parse({})).toEqual({ theme: 'grassland', prompt: '' });
    expect(gen.paramsSchema.parse({ prompt: 'une planche de lave' })).toEqual({
      theme: 'grassland',
      prompt: 'une planche de lave',
    });
    expect(() => z.toJSONSchema(gen.specSchema, { io: 'input' })).not.toThrow();
    expect(() => z.toJSONSchema(gen.paramsSchema, { io: 'input' })).not.toThrow();
  });
});

describe('tileset.side — rendu', () => {
  it.each(SIDE_TILESET_THEMES)('rend le thème « %s » (PNG 128 × 32 + métadonnées « side »)', async (theme) => {
    const params = gen.paramsSchema.parse({ theme });
    const spec = gen.procedural(params, new Rng(1));
    expect(gen.specSchema.safeParse(spec).success).toBe(true);
    // Déterminisme : la spec ne dépend pas de la graine (thème -> palette fixe), mais on vérifie
    // tout de même la stabilité d'un appel à l'autre.
    expect(gen.procedural(gen.paramsSchema.parse({ theme }), new Rng(42))).toEqual(spec);

    const result1 = await gen.render(spec, params, resvgContext);
    const result2 = await gen.render(spec, params, resvgContext);
    const png1 = result1.files.find((f) => f.role === 'main')!.data as Uint8Array;
    const png2 = result2.files.find((f) => f.role === 'main')!.data as Uint8Array;
    expect(Array.from(png1)).toEqual(Array.from(png2));

    const img = decodePng(png1);
    expect([img.width, img.height]).toEqual([128, 32]);

    const info = JSON.parse(result1.files.find((f) => f.role === 'tiles')!.data as string) as {
      tileSize: number;
      columns: number;
      theme: string;
      layout: string;
      tiles: { id: string }[];
    };
    expect(info.layout).toBe('side');
    expect(info.tileSize).toBe(16);
    expect(info.columns).toBe(8);
    expect(info.tiles).toHaveLength(16);
    expect(info.tiles.map((t) => t.id)).toEqual(PLATFORM_TILE_ROLES.map((r) => r.id));

    expect(result1.info).toEqual({ width: 128, height: 32, tileSize: 16, columns: 8, pixelArt: true });

    // Chaque rôle a au moins un pixel non transparent.
    for (const role of PLATFORM_TILE_ROLES) {
      const x0 = (role.index % 8) * 16;
      const y0 = Math.floor(role.index / 8) * 16;
      let opaque = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (alphaAt(img, x0 + x, y0 + y) > 0) opaque++;
      expect(opaque, `${theme}/${role.id} ne doit pas être vide`).toBeGreaterThan(0);
    }

    // platform/spikes/bridge/cloud/décors ont des pixels transparents.
    for (const roleId of TRANSPARENT_ROLES) {
      const role = PLATFORM_TILE_ROLES.find((r) => r.id === roleId)!;
      const x0 = (role.index % 8) * 16;
      const y0 = Math.floor(role.index / 8) * 16;
      let transparent = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (alphaAt(img, x0 + x, y0 + y) === 0) transparent++;
      expect(transparent, `${theme}/${roleId} doit avoir un fond transparent`).toBeGreaterThan(0);
    }
  });

  it('la tuile « fill » se raccorde horizontalement et verticalement, dans tous les thèmes', async () => {
    for (const theme of SIDE_TILESET_THEMES) {
      const params = gen.paramsSchema.parse({ theme });
      const spec = gen.procedural(params, new Rng(1));
      const t = drawTile('fill', theme, spec.palette);
      const score = seamScore(t, 0, 0);
      expect.soft(isSeamless(score), `${theme}/fill : ${JSON.stringify(score)}`).toBe(true);
    }
  });

  it('dessine chaque rôle de façon distincte, dans chaque thème', () => {
    for (const theme of SIDE_TILESET_THEMES) {
      const palette = gen.procedural(gen.paramsSchema.parse({ theme }), new Rng(1)).palette;
      const seen = new Map<string, string>();
      for (const role of PLATFORM_TILE_ROLES) {
        const key = Array.from(drawTile(role.id, theme, palette).data).join(',');
        expect(seen.get(key), `${theme} : ${role.id} identique à ${seen.get(key)}`).toBeUndefined();
        seen.set(key, role.id);
      }
    }
  });

  it('fournit un prompt système décrivant les 16 rôles et le thème demandé', () => {
    for (const role of PLATFORM_TILE_ROLES) expect(gen.systemPrompt).toContain(role.id);
    const params = gen.paramsSchema.parse({ theme: 'cave', prompt: 'une grotte de cristal' });
    expect(gen.buildPrompt(params)).toContain('cave');
  });
});

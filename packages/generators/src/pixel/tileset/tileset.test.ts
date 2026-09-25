import { Rng, TILE, TILE_ROLES, type TilesetInfo } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { alphaAt, decodePng, resvgContext } from '../../shared/test-utils';
import { tilesetGenerator as gen, type TilesetSpec } from './generator';
import { THEME_PALETTES, TILESET_THEMES } from './palettes';
import { drawTile } from './render';

const OPAQUE = ['ground', 'ground_alt', 'ground_detail', 'path', 'path_alt', 'water', 'deep_water', 'wall', 'wall_window', 'door', 'roof', 'stairs', 'void'];
const DECOR = ['fence', 'tree_top', 'tree_trunk', 'bush', 'rock', 'flowers', 'log', 'sign', 'crate', 'table', 'chair', 'bed', 'shelf', 'barrel', 'torch', 'rug'];
const SEAMLESS = ['ground', 'ground_alt', 'ground_detail', 'path', 'path_alt', 'water', 'deep_water'];

describe('tileset — paramètres et schémas', () => {
  it('applique les valeurs par défaut', () => {
    expect(gen.paramsSchema.parse({})).toEqual({ prompt: '', theme: 'village', tileSize: 16 });
    expect(() => z.toJSONSchema(gen.specSchema)).not.toThrow();
    expect(() => z.toJSONSchema(gen.paramsSchema)).not.toThrow();
  });

  it('valide les tuiles dessinées à la main', () => {
    const tile = { palette: { '.': 'transparent', a: '#336699' }, rows: Array.from({ length: 16 }, () => 'a'.repeat(16)) };
    const ok = gen.specSchema.safeParse({ theme: 'forest', palette: THEME_PALETTES.forest, customTiles: { rock: tile } });
    expect(ok.success).toBe(true);
    const bad = gen.specSchema.safeParse({
      theme: 'forest',
      palette: THEME_PALETTES.forest,
      customTiles: { rock: { ...tile, rows: tile.rows.slice(0, 15) }, unknown_role: tile },
    });
    expect(bad.success).toBe(false);
    const messages = bad.error?.issues.map((i) => i.message).join('\n') ?? '';
    expect(messages).toMatch(/exactement 16 lignes/);
    const missing = gen.specSchema.safeParse({ theme: 'forest', palette: { ...THEME_PALETTES.forest, water: undefined } });
    expect(missing.success).toBe(false);
  });
});

describe('tileset — rendu', () => {
  it.each(TILESET_THEMES)('rend le thème « %s » (PNG 128 × 64 + métadonnées)', async (theme) => {
    const spec = gen.procedural(gen.paramsSchema.parse({ theme }), new Rng(1));
    expect(gen.specSchema.safeParse(spec).success).toBe(true);
    expect(gen.procedural(gen.paramsSchema.parse({ theme }), new Rng(99))).toEqual(spec);
    const result = await gen.render(spec, gen.paramsSchema.parse({ theme }), resvgContext);
    const img = decodePng(result.files.find((f) => f.role === 'main')!.data as Uint8Array);
    expect([img.width, img.height]).toEqual([128, 64]);
    const info = JSON.parse(result.files.find((f) => f.role === 'tiles')!.data as string) as TilesetInfo;
    expect(info.tiles).toHaveLength(32);
    expect(info.tiles.map((t) => t.id)).toEqual(TILE_ROLES.map((r) => r.id));
    expect(info).toMatchObject({ tileSize: 16, columns: 8, theme });
    expect(result.info).toEqual({ tileSize: 16, columns: 8, rows: 4, pixelArt: true, theme });

    const tileAlpha = (role: string, x: number, y: number) => {
      const index = TILE[role as keyof typeof TILE];
      return alphaAt(img, (index % 8) * 16 + x, Math.floor(index / 8) * 16 + y);
    };
    for (const role of OPAQUE) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(tileAlpha(role, x, y)).toBe(255);
    }
    for (const role of DECOR) {
      let transparent = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (tileAlpha(role, x, y) === 0) transparent++;
      expect(transparent, `${theme}/${role} doit avoir un fond transparent`).toBeGreaterThan(0);
    }
  });

  it('dessine chaque rôle de façon distincte dans chaque thème', () => {
    for (const theme of TILESET_THEMES) {
      const seen = new Map<string, string>();
      for (const role of TILE_ROLES) {
        const key = Array.from(drawTile(role.id, theme, THEME_PALETTES[theme]).data).join(',');
        expect(seen.get(key), `${theme} : ${role.id} identique à ${seen.get(key)}`).toBeUndefined();
        seen.set(key, role.id);
      }
    }
  });

  it('adapte le sol au thème', () => {
    const grounds = TILESET_THEMES.map((theme) => Array.from(drawTile('ground', theme, THEME_PALETTES[theme]).data).join(','));
    expect(new Set(grounds).size).toBe(TILESET_THEMES.length);
  });

  it('produit des sols, chemins et eaux sans bord visible', () => {
    // Un raccord propre : l'écart entre colonnes/lignes opposées ne dépasse pas l'écart moyen intérieur.
    for (const theme of TILESET_THEMES) {
      for (const role of SEAMLESS) {
        const t = drawTile(role, theme, THEME_PALETTES[theme]);
        const diff = (x1: number, y1: number, x2: number, y2: number) => {
          const a = t.get(x1, y1);
          const b = t.get(x2, y2);
          return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        };
        let edge = 0;
        let inner = 0;
        for (let i = 0; i < 16; i++) {
          edge += diff(15, i, 0, i) + diff(i, 15, i, 0);
          inner += diff(7, i, 8, i) + diff(i, 7, i, 8);
        }
        expect(edge, `${theme}/${role}`).toBeLessThanOrEqual(inner * 1.6 + 400);
      }
    }
  });

  it('accepte une spec de style Claude avec une tuile personnalisée', async () => {
    const custom = {
      palette: { '.': 'transparent', s: '#8a8a9a', d: '#4a4a5a' },
      rows: Array.from({ length: 16 }, (_, y) => (y < 4 ? '.'.repeat(16) : `..${'s'.repeat(11)}d..`.slice(0, 16))),
    };
    const spec: TilesetSpec = {
      theme: 'snow',
      palette: { ...THEME_PALETTES.snow, accent: '#e05a7a', roof: '#d8e4f0' },
      customTiles: { rock: custom },
    };
    expect(gen.specSchema.safeParse(spec).success).toBe(true);
    const result = await gen.render(spec, gen.paramsSchema.parse({ theme: 'snow' }), resvgContext);
    const img = decodePng(result.files[0]!.data as Uint8Array);
    const index = TILE.rock;
    expect(alphaAt(img, (index % 8) * 16 + 5, Math.floor(index / 8) * 16 + 1)).toBe(0);
    expect(alphaAt(img, (index % 8) * 16 + 5, Math.floor(index / 8) * 16 + 8)).toBe(255);
  });

  it('fournit un prompt système décrivant les 32 rôles', () => {
    for (const role of TILE_ROLES) expect(gen.systemPrompt).toContain(role.id);
    expect(gen.buildPrompt(gen.paramsSchema.parse({ theme: 'cave', prompt: 'grotte de cristal' }))).toContain('cave');
  });
});

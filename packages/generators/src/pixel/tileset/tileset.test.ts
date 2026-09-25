import { Rng, TILE, TILE_ROLES, type TilesetInfo } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Rgba } from '../../shared/color';
import { alphaAt, decodePng, resvgContext } from '../../shared/test-utils';
import { PixelCanvas } from '../canvas';
import { tilesetGenerator as gen, type TilesetSpec } from './generator';
import { THEME_PALETTES, TILESET_THEMES } from './palettes';
import { drawTile } from './render';

const OPAQUE = [
  'ground', 'ground_alt', 'ground_detail', 'path', 'path_alt', 'water', 'deep_water',
  'wall', 'wall_window', 'door', 'roof', 'stairs', 'void',
];
const DECOR = [
  'fence', 'tree_top', 'tree_trunk', 'bush', 'rock', 'flowers', 'log', 'sign',
  'crate', 'table', 'chair', 'bed', 'shelf', 'barrel', 'torch', 'rug',
];
const SEAMLESS = ['ground', 'ground_alt', 'ground_detail', 'path', 'path_alt', 'water', 'deep_water'];

/** Source de pixels lisible par coordonnées (tuile dessinée ou toile synthétique de test). */
interface PixelSource {
  get(x: number, y: number): Rgba;
}

interface AxisSeam {
  /** Écart RGB absolu moyen entre colonnes/lignes internes voisines. */
  baseline: number;
  /** Écart RGB absolu moyen entre les deux bords opposés (le raccord). */
  wrap: number;
  /** Plus fort écart moyen entre deux colonnes/lignes internes voisines (joints d'un motif en blocs). */
  maxInternal: number;
}

/** Écart RGB absolu moyen (sur R, G, B) entre deux pixels. */
function pixelDiff(a: Rgba, b: Rgba): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

/**
 * Score de raccord d'une tuile `size × size` (16 par défaut) lue dans `rgba` à partir de
 * `(x0, y0)`. Compare l'écart au raccord (bords opposés) à l'écart moyen entre colonnes/lignes
 * internes voisines, sans jamais comparer un bord au centre : robuste aux textures bruitées
 * (mouchetures, motifs de fleurs près du bord…) qui provoquaient de faux positifs.
 */
function seamScore(rgba: PixelSource, x0: number, y0: number, size = 16): { horizontal: AxisSeam; vertical: AxisSeam } {
  const at = (x: number, y: number) => rgba.get(x0 + x, y0 + y);
  /** Écart moyen entre la « ligne » i et la « ligne » j d'un axe (colonnes si horizontal). */
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

/**
 * Une tuile est « raccordable » si le raccord ne dépasse pas (largement) l'écart interne moyen, ou s'il
 * ressemble à un joint déjà présent à l'intérieur de la tuile (dalles, planches, pavés : le joint du bord
 * répète la période du motif, il est donc invisible en pavage).
 */
function isSeamless({ horizontal, vertical }: ReturnType<typeof seamScore>): boolean {
  const ok = (a: AxisSeam) => a.wrap <= Math.max(2 * a.baseline, a.baseline + 12, 1.15 * a.maxInternal + 2);
  return ok(horizontal) && ok(vertical);
}

describe('tileset — paramètres et schémas', () => {
  it('applique les valeurs par défaut', () => {
    expect(gen.paramsSchema.parse({})).toEqual({ prompt: '', theme: 'village', tileSize: 16 });
    expect(() => z.toJSONSchema(gen.specSchema)).not.toThrow();
    expect(() => z.toJSONSchema(gen.paramsSchema)).not.toThrow();
  });

  it('valide les tuiles dessinées à la main', () => {
    const tile = {
      palette: { '.': 'transparent', a: '#336699' },
      rows: Array.from({ length: 16 }, () => 'a'.repeat(16)),
    };
    const ok = gen.specSchema.safeParse({
      theme: 'forest',
      palette: THEME_PALETTES.forest,
      customTiles: { rock: tile },
    });
    expect(ok.success).toBe(true);
    const bad = gen.specSchema.safeParse({
      theme: 'forest',
      palette: THEME_PALETTES.forest,
      customTiles: { rock: { ...tile, rows: tile.rows.slice(0, 15) }, unknown_role: tile },
    });
    expect(bad.success).toBe(false);
    const messages = bad.error?.issues.map((i) => i.message).join('\n') ?? '';
    expect(messages).toMatch(/exactement 16 lignes/);
    const missing = gen.specSchema.safeParse({
      theme: 'forest',
      palette: { ...THEME_PALETTES.forest, water: undefined },
    });
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
    const grounds = TILESET_THEMES.map((theme) =>
      Array.from(drawTile('ground', theme, THEME_PALETTES[theme]).data).join(','),
    );
    expect(new Set(grounds).size).toBe(TILESET_THEMES.length);
  });

  it('produit des sols, chemins et eaux sans bord visible', () => {
    // Un raccord propre : l'écart au raccord ne dépasse pas (largement) l'écart interne moyen,
    // sans comparer les bords au centre (ce qui donnait un faux positif sur forest/ground_detail,
    // dont les fleurs près du bord n'ont rien à voir avec le raccord du pavage 3 × 3).
    for (const theme of TILESET_THEMES) {
      for (const role of SEAMLESS) {
        const t = drawTile(role, theme, THEME_PALETTES[theme]);
        const score = seamScore(t, 0, 0);
        expect.soft(isSeamless(score), `${theme}/${role} : ${JSON.stringify(score)}`).toBe(true);
      }
    }
  });

  it('détecte un dégradé horizontal comme non raccordable (contrôle négatif)', () => {
    const gradient = new PixelCanvas(16, 16);
    for (let x = 0; x < 16; x++) {
      const v = Math.round((x / 15) * 255);
      for (let y = 0; y < 16; y++) gradient.set(x, y, [v, v, v, 255]);
    }
    const score = seamScore(gradient, 0, 0);
    // Marche d'escalier interne ≈ 17 (255 / 15) ; raccord = saut complet 255 → 0, bien au-delà.
    expect(score.horizontal.baseline).toBeCloseTo(17, 0);
    expect(score.horizontal.wrap).toBeCloseTo(255, 0);
    expect(isSeamless(score)).toBe(false);
  });

  it('reconnaît une tuile uniforme comme raccordable (contrôle positif)', () => {
    const uniform = new PixelCanvas(16, 16);
    uniform.rect(0, 0, 16, 16, '#4a7a4a');
    const score = seamScore(uniform, 0, 0);
    expect(score).toEqual({
      horizontal: { baseline: 0, wrap: 0, maxInternal: 0 },
      vertical: { baseline: 0, wrap: 0, maxInternal: 0 },
    });
    expect(isSeamless(score)).toBe(true);
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

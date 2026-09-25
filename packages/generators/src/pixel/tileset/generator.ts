import { TILE_ROLES, TILESET_COLUMNS, TILE_SIZE, type TilesetInfo } from '@forge/core';
import { z } from 'zod';
import { jsonFile, pngFile } from '../../shared/files';
import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../../shared/prompt';
import type { GeneratorDefinition } from '../../types';
import { checkGrid, pixelPaletteSchema } from '../grid';
import { THEME_PALETTES, TILESET_THEMES, tilesetPaletteSchema } from './palettes';
import { drawTileset } from './render';

export const tilesetParamsSchema = z.object({
  prompt: z.string().default('').describe('Description du tileset'),
  theme: z.enum(TILESET_THEMES).default('village').describe('Thème'),
  tileSize: z.literal(16).default(16).describe('Taille des tuiles (fixe : 16 px)'),
});

export type TilesetParams = z.output<typeof tilesetParamsSchema>;

const ROLE_IDS = TILE_ROLES.map((r) => r.id) as [string, ...string[]];

const customTileSchema = z.object({
  palette: pixelPaletteSchema.describe('One visible ASCII character -> "#rrggbb", "#rrggbbaa" or "transparent"'),
  rows: z.array(z.string()).describe('Exactly 16 strings of exactly 16 characters'),
});

export const tilesetSpecSchema = z
  .object({
    theme: z.enum(TILESET_THEMES),
    palette: tilesetPaletteSchema,
    customTiles: z
      .partialRecord(z.enum(ROLE_IDS), customTileSchema)
      .optional()
      .describe('Optional hand-drawn 16x16 tiles that replace the procedural drawing of some roles'),
  })
  .superRefine((spec, ctx) => {
    for (const [role, tile] of Object.entries(spec.customTiles ?? {})) {
      if (tile) checkGrid(tile, TILE_SIZE, TILE_SIZE, ctx, ['customTiles', role]);
    }
  });

export type TilesetSpec = z.output<typeof tilesetSpecSchema>;

/** Métadonnées du tileset (fichier annexe `tiles`). */
export function tilesetInfo(theme: string): TilesetInfo {
  return { tileSize: TILE_SIZE, columns: TILESET_COLUMNS, theme, tiles: TILE_ROLES.map((r) => ({ ...r })) };
}

const ROLE_LIST = TILE_ROLES.map((r) => `${r.index}. ${r.id} (${r.layer}${r.passable ? ', passable' : ''})`).join('\n');

const SYSTEM_PROMPT = `You are the art director of tilesets for Forge, a web RPG engine. Every tileset uses the SAME
standard layout of ${TILE_ROLES.length} tiles of 16x16 px (${TILESET_COLUMNS} columns, PNG ${TILESET_COLUMNS * 16}x${Math.ceil(TILE_ROLES.length / TILESET_COLUMNS) * 16}), so maps stay valid when
a tileset is regenerated. The engine draws every tile procedurally in the chosen theme, with YOUR palette: your main job is
to pick a beautiful, coherent 19-color palette. You may optionally hand-draw a few tiles.

Roles (index. id (layer)):
${ROLE_LIST}

Spec:
- theme: ${TILESET_THEMES.map((t) => `"${t}"`).join(' | ')} (use the requested theme). It decides how roles are drawn,
  e.g. dungeon ground = stone flagstones, interior ground = wooden planks, snow ground = snow, cave tree_top = giant mushroom.
- palette: all 19 keys, "#rrggbb" each: ground, groundDark, groundLight (floor ramp), path, pathDark, water, waterLight,
  wall, wallDark, roof, roofDark, wood, woodDark, leaf, leafDark, stone, stoneDark, accent, outline.
- customTiles (optional, use sparingly, only when the description asks for something specific): { "<roleId>": { "palette":
  { ".": "transparent", "a": "#rrggbb", ... }, "rows": [16 strings of 16 chars] } }. Ground/path/water tiles must tile
  seamlessly (left edge continues the right edge, top continues bottom); decor tiles keep a transparent background.

Palette art direction:
- Each "Dark" color is a real shadow of its base (darker AND slightly shifted toward blue/purple), each "Light" a highlight
  (lighter, slightly warmer). Keep 20-35% lightness difference inside a ramp so tiles read clearly.
- Floors must stay calm (moderate saturation) so characters and decor stand out; accent is the only very saturated color.
- outline is a very dark tinted color (never pure #000000), used for decor outlines and the void tile.
- Keep the whole palette harmonious (shared temperature, limited hues). Example for "village":
${JSON.stringify(THEME_PALETTES.village)}
${FRENCH_AUDIENCE_NOTE}`;

export const tilesetGenerator: GeneratorDefinition<TilesetParams, TilesetSpec> = {
  id: 'tileset',
  kind: 'tileset',
  label: 'Tileset (tuiles 16 × 16)',
  description:
    'Jeu de 32 tuiles 16 × 16 à la disposition standard Forge (sols, eau, murs, toits, nature, mobilier) dans un thème.',
  paramsSchema: tilesetParamsSchema,
  specSchema: tilesetSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    return requestMessage(`a "${params.theme}" tileset`, params.prompt, params, [
      `Use theme "${params.theme}". Choose the palette to match the description (mood, season, time of day).`,
    ]);
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params, ['Keep the same theme unless the change explicitly asks otherwise.']);
  },
  procedural(params) {
    return { theme: params.theme, palette: { ...THEME_PALETTES[params.theme] } };
  },
  async render(spec) {
    const sheet = drawTileset(spec.theme, spec.palette, spec.customTiles ?? {});
    const rows = Math.ceil(TILE_ROLES.length / TILESET_COLUMNS);
    return {
      files: [pngFile('main', sheet.toPng()), jsonFile('tiles', tilesetInfo(spec.theme)), jsonFile('source', spec)],
      info: { tileSize: TILE_SIZE, columns: TILESET_COLUMNS, rows, pixelArt: true, theme: spec.theme },
    };
  },
};

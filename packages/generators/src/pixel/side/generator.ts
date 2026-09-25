import { PLATFORM_TILE_ROLES, PLATFORM_TILESET_COLUMNS, TILE_SIZE, type TilesetInfo } from '@forge/core';
import { z } from 'zod';
import { jsonFile, pngFile } from '../../shared/files';
import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../../shared/prompt';
import type { GeneratorDefinition } from '../../types';
import { SIDE_PALETTE_KEYS, SIDE_THEME_PALETTES, SIDE_TILESET_THEMES, sideTilesetPaletteSchema } from './palette';
import { drawSideTileset } from './tiles';

export const sideTilesetParamsSchema = z.object({
  theme: z.enum(SIDE_TILESET_THEMES).default('grassland').describe('Thème'),
  prompt: z.string().default('').describe('Description du tileset'),
});

export type SideTilesetParams = z.output<typeof sideTilesetParamsSchema>;

export const sideTilesetSpecSchema = z.object({
  theme: z.enum(SIDE_TILESET_THEMES),
  palette: sideTilesetPaletteSchema,
});

export type SideTilesetSpec = z.output<typeof sideTilesetSpecSchema>;

/** Métadonnées du tileset vu de côté (fichier annexe `tiles`). */
export function sideTilesetInfo(theme: string): TilesetInfo {
  return {
    tileSize: TILE_SIZE,
    columns: PLATFORM_TILESET_COLUMNS,
    theme,
    layout: 'side',
    tiles: PLATFORM_TILE_ROLES.map((r) => ({ ...r })),
  };
}

const ROLE_LIST = PLATFORM_TILE_ROLES.map((r) => `${r.index}. ${r.id} (${r.layer}, ${r.collision})`).join('\n');

const SYSTEM_PROMPT = `You are the art director of side-view (platformer) tilesets for Forge, a web game engine. Every
side tileset uses the SAME standard layout of ${PLATFORM_TILE_ROLES.length} tiles of 16x16 px
(${PLATFORM_TILESET_COLUMNS} columns, 2 rows, PNG ${PLATFORM_TILESET_COLUMNS * 16}x${2 * 16}), so levels stay valid when
a tileset is regenerated. The engine draws every tile procedurally in the chosen theme, with YOUR palette: your main job
is to pick a coherent, readable palette.

Roles (index. id (layer, collision)):
${ROLE_LIST}

Spec:
- theme: ${SIDE_TILESET_THEMES.map((t) => `"${t}"`).join(' | ')}.
- palette: all ${SIDE_PALETTE_KEYS.length} keys, "#rrggbb" each: ${SIDE_PALETTE_KEYS.join(', ')}.

Art direction:
- "top"/"top_left"/"top_right" must read as a walkable surface (a bright line on top) over "fill" (dark, readable
  interior). "fill" must tile seamlessly on all four edges (players see many of it stacked side by side and on top of
  each other). "platform"/"bridge"/"cloud" stay mostly transparent (thin walkable strip only, rest of the 16x16 is
  empty). "spikes" are white/pale triangles on a transparent background, pointing up. "water" is semi-transparent.
  "bush"/"flower"/"sign"/"fence" are decor on a transparent background.
- Each "Dark" color is a real shadow of its base (darker, slightly shifted toward blue/purple), each "Light" a
  highlight. Keep the palette harmonious and readable at 16x16.
${FRENCH_AUDIENCE_NOTE}`;

export const sideTilesetGenerator: GeneratorDefinition<SideTilesetParams, SideTilesetSpec> = {
  id: 'tileset.side',
  kind: 'tileset',
  label: 'Tileset (vue de côté)',
  description: 'Planche de 16 tuiles 16×16 vue de côté (terrain, dangers, décor) pour le mode plateformer.',
  paramsSchema: sideTilesetParamsSchema,
  specSchema: sideTilesetSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    return requestMessage(`a "${params.theme}" side-view (platformer) tileset`, params.prompt, params, [
      `Use theme "${params.theme}".`,
    ]);
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params, [
      'Keep the same theme unless the change explicitly asks otherwise.',
    ]);
  },
  reviewHint:
    'Planche 128×32 : 2 lignes de 8 tuiles 16×16. Ligne 1 (haut→bas, gauche→droite) : top, fill, top_left, ' +
    'top_right, platform, brick, stone, crate. Ligne 2 : spikes, water, bridge, cloud, bush, flower, sign, fence.',
  procedural(params) {
    return { theme: params.theme, palette: { ...SIDE_THEME_PALETTES[params.theme] } };
  },
  async render(spec) {
    const sheet = drawSideTileset(spec.theme, spec.palette);
    return {
      files: [pngFile('main', sheet.toPng()), jsonFile('tiles', sideTilesetInfo(spec.theme)), jsonFile('source', spec)],
      info: {
        width: PLATFORM_TILESET_COLUMNS * TILE_SIZE,
        height: 2 * TILE_SIZE,
        tileSize: TILE_SIZE,
        columns: PLATFORM_TILESET_COLUMNS,
        pixelArt: true,
      },
    };
  },
};

import type { Rng } from '@forge/core';
import { z } from 'zod';
import { hexColorSchema, outlineOf } from '../shared/color';
import { jsonFile, pngFile } from '../shared/files';
import { matchKeyword } from '../shared/keywords';
import { colorFromText } from '../shared/palettes';
import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../shared/prompt';
import type { GeneratorDefinition } from '../types';
import { encodePng } from '../encode/png';
import { PixelCanvas } from './canvas';
import { drawCharsetFrame } from './charset/draw';
import { resolveCharsetLook } from './charset/generator';
import { canvasToGrid, checkGrid, gridToRgba, pixelPaletteSchema } from './grid';
import { CREATURE_DRAWERS, DEFAULT_COLORS, ITEM_DRAWERS, OUTLINE, PROP_DRAWERS, type Draw } from './items';
import { Sprite } from './shapes';

export const PIXEL_SUBJECTS = ['item', 'icon', 'creature', 'prop', 'character'] as const;

export const imagePixelParamsSchema = z.object({
  prompt: z.string().default('').describe('Description du sprite'),
  width: z.number().int().min(8).max(64).default(16).describe('Largeur (pixels)'),
  height: z.number().int().min(8).max(64).default(16).describe('Hauteur (pixels)'),
  subject: z.enum(PIXEL_SUBJECTS).default('item').describe('Sujet'),
  palette: z.array(hexColorSchema).max(16).optional().describe('Palette imposée (couleurs #rrggbb)'),
});

export type ImagePixelParams = z.output<typeof imagePixelParamsSchema>;

export const imagePixelSpecSchema = z
  .object({
    width: z.number().int().min(8).max(64).describe('Width in pixels (8-64)'),
    height: z.number().int().min(8).max(64).describe('Height in pixels (8-64)'),
    palette: pixelPaletteSchema.describe(
      'Map from ONE visible ASCII character to "#rrggbb", "#rrggbbaa" or "transparent". Example: {".": "transparent", "o": "#1c1424"}',
    ),
    rows: z.array(z.string()).describe('Exactly `height` strings of exactly `width` characters, top row first'),
  })
  .superRefine((spec, ctx) => {
    const count = Object.keys(spec.palette).length;
    if (count > 32) {
      ctx.addIssue({ code: 'custom', path: ['palette'], message: `Palette trop grande (${count} couleurs, maximum 32).` });
    }
    checkGrid(spec, spec.width, spec.height, ctx);
  });

export type ImagePixelSpec = z.output<typeof imagePixelSpecSchema>;

/** Pixels RVBA d'une spec pixel-art. */
export function pixelSpecToRgba(spec: ImagePixelSpec): Uint8Array {
  return gridToRgba(spec, spec.width, spec.height);
}

const KEYWORDS = {
  potion: ['potion', 'fiole', 'flask', 'elixir', 'philtre', 'flacon'],
  sword: ['epee', 'sword', 'lame', 'blade', 'sabre', 'katana', 'glaive'],
  shield: ['bouclier', 'shield', 'ecu'],
  key: ['cle', 'clef', 'key'],
  coin: ['piece', 'coin', 'monnaie', 'money', 'argent'],
  gem: ['gemme', 'gem', 'cristal', 'crystal', 'diamant', 'diamond', 'rubis', 'ruby', 'emeraude', 'emerald', 'saphir', 'sapphire', 'joyau', 'jewel'],
  heart: ['coeur', 'heart', 'vie', 'life', 'sante', 'health'],
  scroll: ['parchemin', 'scroll', 'rouleau', 'carte', 'map', 'lettre', 'letter'],
  mushroom: ['champignon', 'mushroom'],
  apple: ['pomme', 'apple', 'fruit'],
  bomb: ['bombe', 'bomb', 'explosif'],
  ring: ['anneau', 'bague', 'ring'],
  book: ['livre', 'book', 'grimoire', 'tome', 'journal'],
  staff: ['baton', 'staff', 'sceptre', 'wand', 'baguette'],
  chest: ['coffre', 'chest', 'tresor', 'treasure'],
  barrel: ['tonneau', 'barrel', 'baril'],
  crate: ['caisse', 'crate', 'boite', 'box'],
  torch: ['torche', 'torch', 'flambeau'],
  plant: ['plante', 'plant', 'pot', 'fleur', 'flower', 'arbuste'],
  slime: ['slime', 'gelee', 'blob'],
  ghost: ['fantome', 'ghost', 'spectre', 'esprit', 'spirit'],
  bat: ['chauve souris', 'bat', 'vampire'],
} as const;

type Motif = keyof typeof KEYWORDS;

const DRAWERS: Record<Motif, Draw> = { ...ITEM_DRAWERS, ...PROP_DRAWERS, ...CREATURE_DRAWERS };

const SUBJECT_MOTIFS: Record<Exclude<ImagePixelParams['subject'], 'character'>, readonly Motif[]> = {
  item: ['potion', 'sword', 'shield', 'key', 'coin', 'gem', 'heart', 'scroll', 'mushroom', 'apple', 'bomb', 'ring', 'book', 'staff'],
  icon: ['heart', 'coin', 'gem', 'potion', 'key', 'sword', 'shield', 'scroll', 'book'],
  prop: ['chest', 'barrel', 'crate', 'torch', 'plant'],
  creature: ['slime', 'ghost', 'bat'],
};

/** Personnage : frame de face d'un charset, en pied si la toile est assez haute, sinon en buste. */
function drawCharacter(params: ImagePixelParams, rng: Rng): PixelCanvas {
  const look = resolveCharsetLook({ prompt: params.prompt }, rng);
  if (params.palette?.[0]) look.outfitColor = params.palette[0];
  if (params.palette?.[1]) look.hairColor = params.palette[1];
  const frame = drawCharsetFrame(look, 'down', 0);
  const out = new PixelCanvas(params.width, params.height);
  const full = params.height >= 24 && params.width >= 16;
  const top = full ? 0 : 1;
  const visible = full ? 24 : Math.min(params.height, 23);
  const dx = Math.floor((params.width - 16) / 2);
  const dy = full ? params.height - 24 : params.height - visible;
  for (let y = 0; y < visible; y++) {
    for (let x = 0; x < 16; x++) {
      const c = frame.get(x, top + y);
      if (c[3] > 0) out.set(x + dx, y + dy, c);
    }
  }
  return out;
}

export function proceduralPixelCanvas(params: ImagePixelParams, rng: Rng): PixelCanvas {
  if (params.subject === 'character') return drawCharacter(params, rng);
  const pool = SUBJECT_MOTIFS[params.subject];
  const motif = matchKeyword(params.prompt, KEYWORDS) ?? rng.pick(pool);
  const main = params.palette?.[0] ?? colorFromText(params.prompt) ?? rng.pick(DEFAULT_COLORS[motif] ?? ['#c0343e']);
  const outline = params.palette?.length ? outlineOf(main) : OUTLINE;
  const sprite = new Sprite(params.width, params.height, { outline });
  (DRAWERS[motif] as Draw)(sprite, main, rng);
  return sprite.finish();
}

const SYSTEM_PROMPT = `You are a pixel artist creating sprites for Forge, a web game engine (RPG / adventure games).
You output a pixel grid as JSON, which the engine renders to a PNG at native size (then scaled with nearest-neighbor).

Spec format:
- width, height: integers between 8 and 64 (use the requested size exactly).
- palette: object mapping ONE visible ASCII character to a color: "#rrggbb", "#rrggbbaa" or "transparent".
  Always include "." : "transparent" for the background. Use at most ~16 colors (32 is the hard limit).
- rows: exactly \`height\` strings, each exactly \`width\` characters long, top row first. Every character must be
  a key of the palette. Count carefully: a wrong row length is rejected.

Art direction (polished indie-game quality, not placeholder art):
- Transparent background; the subject is centered, fills ~80-90% of the canvas and keeps a 1px margin.
- Clean 1px outline in a very dark, slightly tinted color (e.g. "#1c1424"), no pure black; no stray pixels.
- Light comes from the top-left: for each material use a ramp of 3-4 tones (shadow, base, light, highlight);
  shift shadows toward blue/purple and highlights toward warm yellow instead of only darkening/lightening.
- Add a small specular highlight (1-2 near-white pixels) on shiny materials (glass, metal, gems).
- Palette discipline: few colors, strong value contrast, readable silhouette at 1x.
- No anti-aliasing blur, no dithering noise, no text, letters or numbers.
- If a palette is imposed in the parameters, build your ramps from those colors.
${FRENCH_AUDIENCE_NOTE}`;

export const imagePixelGenerator: GeneratorDefinition<ImagePixelParams, ImagePixelSpec> = {
  id: 'image.pixel',
  kind: 'image',
  label: 'Sprite pixel-art',
  description: 'Petit sprite pixel-art (objet, icône, créature, accessoire ou personnage) de 8 à 64 pixels.',
  paramsSchema: imagePixelParamsSchema,
  specSchema: imagePixelSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    return requestMessage(`a ${params.width}x${params.height} pixel-art sprite (subject type: ${params.subject})`, params.prompt, params, [
      `The grid must be exactly ${params.width} characters wide and ${params.height} rows tall.`,
    ]);
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params, [
      `Keep the grid exactly ${spec.width} characters wide and ${spec.height} rows tall.`,
    ]);
  },
  procedural(params, rng) {
    const canvas = proceduralPixelCanvas(params, rng);
    return { width: canvas.width, height: canvas.height, ...canvasToGrid(canvas) };
  },
  async render(spec) {
    const png = encodePng(spec.width, spec.height, pixelSpecToRgba(spec));
    return {
      files: [pngFile('main', png), jsonFile('source', spec)],
      info: { width: spec.width, height: spec.height, pixelArt: true },
    };
  },
};

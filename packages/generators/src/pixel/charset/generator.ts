import type { Rng } from '@forge/core';
import { z } from 'zod';
import { hexColorSchema } from '../../shared/color';
import { jsonFile, pngFile } from '../../shared/files';
import { matchKeyword } from '../../shared/keywords';
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, hairColorFromText, outfitColorFromText } from '../../shared/palettes';
import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../../shared/prompt';
import type { GeneratorDefinition } from '../../types';
import { drawCharsetSheet, FRAME_H, FRAME_W, type CharsetLook } from './draw';

export const CHARSET_HAIR_STYLES = ['short', 'long', 'spiky', 'bald', 'ponytail', 'hood'] as const;
export const CHARSET_OUTFITS = ['tunic', 'robe', 'armor', 'dress'] as const;
export const CHARSET_ACCESSORIES = ['none', 'hat', 'helmet', 'crown', 'glasses'] as const;

export const charsetParamsSchema = z.object({
  prompt: z.string().default('').describe('Description du personnage'),
  skinTone: hexColorSchema.optional().describe('Teint de peau (auto si absent)'),
  hairColor: hexColorSchema.optional().describe('Couleur des cheveux (auto si absent)'),
  outfitColor: hexColorSchema.optional().describe('Couleur de la tenue (auto si absent)'),
  hairStyle: z.enum(CHARSET_HAIR_STYLES).optional().describe('Coiffure'),
  outfitStyle: z.enum(CHARSET_OUTFITS).optional().describe('Tenue'),
  accessory: z.enum(CHARSET_ACCESSORIES).optional().describe('Accessoire'),
});

export type CharsetParams = z.output<typeof charsetParamsSchema>;

export const charsetSpecSchema = z.object({
  skinTone: hexColorSchema.describe('Skin base color'),
  hairColor: hexColorSchema.describe('Hair base color'),
  outfitColor: hexColorSchema.describe('Main clothing color (tunic, robe, dress, hood, armor tabard)'),
  hairStyle: z.enum(CHARSET_HAIR_STYLES),
  outfitStyle: z.enum(CHARSET_OUTFITS),
  accessory: z.enum(CHARSET_ACCESSORIES),
  outlineColor: hexColorSchema.optional().describe('Dark outline color (default: derived from the outfit)'),
  accentColor: hexColorSchema.optional().describe('Accent color: sash, trims, hat, shoulder pads'),
});

export type CharsetSpec = z.output<typeof charsetSpecSchema>;

/** Archétypes reconnus dans la description. */
const ARCHETYPES = {
  knight: ['chevalier', 'knight', 'paladin', 'garde', 'guard', 'soldat', 'soldier'],
  warrior: ['guerrier', 'guerriere', 'warrior', 'barbare', 'barbarian', 'mercenaire', 'mercenary'],
  mage: ['mage', 'magicien', 'magicienne', 'sorcier', 'sorciere', 'wizard', 'witch', 'enchanteur', 'sorcerer'],
  royal: ['princesse', 'princess', 'reine', 'queen', 'roi', 'king', 'prince', 'noble'],
  rogue: ['voleur', 'voleuse', 'thief', 'rogue', 'assassin', 'ninja', 'rodeur', 'ranger', 'archer', 'archere'],
  monk: ['moine', 'monk', 'pretre', 'pretresse', 'priest', 'clerc', 'cleric', 'nonne', 'nun'],
  scholar: ['savant', 'scholar', 'professeur', 'teacher', 'scientifique', 'scientist', 'bibliothecaire', 'librarian'],
  farmer: ['fermier', 'fermiere', 'farmer', 'paysan', 'paysanne', 'peasant', 'jardinier', 'gardener'],
  girl: ['fille', 'girl', 'femme', 'woman', 'dame', 'lady', 'villageoise', 'marchande', 'serveuse'],
  boy: ['garcon', 'boy', 'homme', 'man', 'villageois', 'marchand', 'merchant', 'aubergiste'],
} as const;

type Archetype = keyof typeof ARCHETYPES;

const ARCHETYPE_LOOKS: Record<Archetype, Partial<CharsetLook>> = {
  knight: { outfitStyle: 'armor', accessory: 'helmet', hairStyle: 'short' },
  warrior: { outfitStyle: 'armor', accessory: 'none', hairStyle: 'spiky' },
  mage: { outfitStyle: 'robe', accessory: 'hat', outfitColor: '#5a3f9a' },
  royal: { accessory: 'crown', outfitColor: '#b03a48' },
  rogue: { outfitStyle: 'tunic', hairStyle: 'hood', accessory: 'none', outfitColor: '#3f5a3a' },
  monk: { outfitStyle: 'robe', hairStyle: 'bald', accessory: 'none', outfitColor: '#c08030' },
  scholar: { outfitStyle: 'robe', accessory: 'glasses', outfitColor: '#44566a' },
  farmer: { outfitStyle: 'tunic', accessory: 'hat', outfitColor: '#6a8a3a', accentColor: '#d8b060' },
  girl: { outfitStyle: 'dress' },
  boy: { outfitStyle: 'tunic' },
};

/** Complète l'apparence : paramètres explicites > description > tirage aléatoire. */
export function resolveCharsetLook(params: CharsetParams, rng: Rng): CharsetSpec {
  const text = params.prompt;
  const archetype = matchKeyword(text, ARCHETYPES);
  const base = archetype ? ARCHETYPE_LOOKS[archetype] : {};
  const feminine = archetype === 'girl' || /princesse|princess|reine|queen|sorciere|witch|fille|femme/i.test(text);
  const hairStyle =
    params.hairStyle ??
    base.hairStyle ??
    (feminine
      ? rng.pick(['long', 'ponytail'] as const)
      : rng.pick(['short', 'short', 'spiky', 'ponytail', 'long'] as const));
  const outfitStyle =
    params.outfitStyle ?? base.outfitStyle ?? (feminine ? 'dress' : rng.pick(['tunic', 'tunic', 'robe'] as const));
  const spec: CharsetSpec = {
    skinTone: params.skinTone ?? rng.pick(SKIN_TONES),
    hairColor: params.hairColor ?? hairColorFromText(text) ?? rng.pick(HAIR_COLORS),
    outfitColor: params.outfitColor ?? outfitColorFromText(text) ?? base.outfitColor ?? rng.pick(OUTFIT_COLORS),
    hairStyle,
    outfitStyle,
    accessory: params.accessory ?? base.accessory ?? 'none',
  };
  if (base.accentColor) spec.accentColor = base.accentColor;
  return spec;
}

const SYSTEM_PROMPT = `You design RPG walking characters ("charsets") for Forge, a web game engine.
The engine draws the sprite sheet itself from a few parameters you choose: you do NOT draw pixels.

Sheet produced from your spec: PNG 48x96, 3 columns x 4 rows of 16x24 frames (chibi proportions, 1px dark
outline, 3-tone shading, walk cycle). Rows: down, left, right, up. Columns: step A, idle, step B.

Spec fields:
- skinTone, hairColor, outfitColor: "#rrggbb" colors.
- hairStyle: "short" | "long" | "spiky" | "bald" | "ponytail" | "hood" (a cloth hood in outfitColor that hides most hair).
- outfitStyle: "tunic" (belt + trousers) | "robe" (long, hides legs) | "armor" (steel plates, tabard in outfitColor)
  | "dress" (bodice + flared skirt).
- accessory: "none" | "hat" (brimmed hat in accentColor) | "helmet" (steel) | "crown" (gold) | "glasses".
- outlineColor (optional): very dark, slightly tinted color (e.g. "#1f1a2e"); never pure black on warm palettes.
- accentColor (optional): trims, sash, hat, shoulder pads; pick a color that contrasts with outfitColor.

Art direction:
- Readability at 16x24 matters most: hair, skin and outfit must be clearly distinct in value (light vs dark).
- Prefer mid-saturated colors; avoid pure primaries (#ff0000) and near-white outfits on light skin.
- Match the archetype: knight -> armor + helmet, mage -> robe + hat, royalty -> crown, rogue/ranger -> hood,
  monk -> robe + bald, scholar -> glasses, villager -> tunic or dress.
- Skin tones must be natural human tones unless the description is explicitly fantastic (orc, alien...).
${FRENCH_AUDIENCE_NOTE}`;

export const charsetGenerator: GeneratorDefinition<CharsetParams, CharsetSpec> = {
  id: 'charset',
  kind: 'charset',
  label: 'Personnage RPG (charset)',
  description: 'Planche de marche 3 × 4 (16 × 24 px) pour les personnages des jeux RPG : bas, gauche, droite, haut.',
  paramsSchema: charsetParamsSchema,
  specSchema: charsetSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    return requestMessage('an RPG walking character sheet (charset)', params.prompt, params, [
      'Fields given in the parameters are imposed: copy them unchanged; choose all the others to fit the description.',
    ]);
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params);
  },
  procedural(params, rng) {
    return resolveCharsetLook(params, rng);
  },
  async render(spec) {
    const sheet = drawCharsetSheet(spec);
    return {
      files: [pngFile('main', sheet.toPng()), jsonFile('source', spec)],
      info: { frameWidth: FRAME_W, frameHeight: FRAME_H, columns: 3, rows: 4, pixelArt: true },
    };
  },
};

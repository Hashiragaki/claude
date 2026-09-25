import type { Rng } from '@forge/core';
import { z } from 'zod';
import { hexColorSchema } from '../shared/color';
import { pngFile, svgFile } from '../shared/files';
import { matchKeyword } from '../shared/keywords';
import { colorFromText } from '../shared/palettes';
import { FRENCH_AUDIENCE_NOTE, editMessage, requestMessage } from '../shared/prompt';
import type { GeneratorDefinition } from '../types';
import { drawBackground, SCENES, sceneFromText, TIMES, timeFromText, type SceneName } from './background';
import { CREATURES, drawBattler, type Creature } from './battler';
import { SVG_STYLES } from './builder';
import { drawObject, OBJECT_WORDS, OBJECTS } from './objects';
import { drawPortrait, EXPRESSIONS, HAIR_STYLES } from './portrait';
import { sanitizeSvg } from './sanitize';

export const SVG_SUBJECTS = ['background', 'portrait', 'battler', 'object', 'icon', 'illustration'] as const;
export type SvgSubject = (typeof SVG_SUBJECTS)[number];

/** Taille par défaut selon le sujet. */
export const DEFAULT_SIZES: Record<SvgSubject, [number, number]> = {
  background: [1280, 720],
  portrait: [600, 900],
  battler: [256, 256],
  object: [256, 256],
  icon: [256, 256],
  illustration: [1024, 768],
};

const size = z.number().int().min(16).max(2048);

export const imageSvgParamsSchema = z.object({
  prompt: z.string().default('').describe("Description de l'image"),
  subject: z.enum(SVG_SUBJECTS).default('illustration').describe('Sujet'),
  width: size.optional().describe('Largeur (défaut selon le sujet)'),
  height: size.optional().describe('Hauteur (défaut selon le sujet)'),
  style: z.enum(SVG_STYLES).default('soft').describe('Style graphique'),
  palette: z.array(hexColorSchema).max(8).optional().describe('Palette imposée'),
  character: z.string().optional().describe("Personnage (portrait) : même nom = même apparence"),
  expression: z.enum(EXPRESSIONS).optional().describe('Expression (portrait)'),
  hairColor: hexColorSchema.optional().describe('Couleur des cheveux (portrait)'),
  eyeColor: hexColorSchema.optional().describe('Couleur des yeux (portrait)'),
  skinTone: hexColorSchema.optional().describe('Teint (portrait)'),
  outfitColor: hexColorSchema.optional().describe('Couleur de la tenue (portrait)'),
  hairStyle: z.enum(HAIR_STYLES).optional().describe('Coiffure (portrait)'),
  scene: z.enum(SCENES).optional().describe('Lieu (décor)'),
  timeOfDay: z.enum(TIMES).optional().describe('Moment de la journée (décor)'),
  creature: z.enum(CREATURES).optional().describe('Créature (battler)'),
  color: hexColorSchema.optional().describe('Couleur principale (battler, objet)'),
});

export type ImageSvgParams = z.output<typeof imageSvgParamsSchema>;

export const imageSvgSpecSchema = z
  .object({
    width: size.describe('Output width in pixels (16-2048)'),
    height: size.describe('Output height in pixels (16-2048)'),
    svg: z
      .string()
      .min(20)
      .max(200_000)
      .describe('Complete standalone SVG document (<svg xmlns=... width height viewBox>...</svg>)'),
  })
  .superRefine((spec, ctx) => {
    if (!/<svg[\s>]/i.test(spec.svg) || !/<\/svg\s*>\s*$/i.test(spec.svg.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['svg'],
        message: '« svg » doit être un document SVG complet, de « <svg …> » jusqu’à « </svg> ».',
      });
    }
    if (/<(script|foreignObject)\b/i.test(spec.svg)) {
      ctx.addIssue({
        code: 'custom',
        path: ['svg'],
        message: 'Les éléments <script> et <foreignObject> sont interdits.',
      });
    }
  });

export type ImageSvgSpec = z.output<typeof imageSvgSpecSchema>;

export function resolveSvgSize(params: Pick<ImageSvgParams, 'subject' | 'width' | 'height'>): [number, number] {
  const [w, h] = DEFAULT_SIZES[params.subject];
  if (params.width && !params.height) return [params.width, Math.round((params.width * h) / w)];
  if (params.height && !params.width) return [Math.round((params.height * w) / h), params.height];
  return [params.width ?? w, params.height ?? h];
}

const CREATURE_WORDS: Record<Creature, readonly string[]> = {
  slime: ['slime', 'gelee', 'blob', 'gluant'],
  bat: ['chauve souris', 'bat', 'vampire'],
  golem: ['golem', 'rocher', 'pierre', 'stone', 'rock', 'gardien', 'guardian'],
  wolf: ['loup', 'wolf', 'chien', 'dog', 'renard', 'fox', 'bete', 'beast'],
  ghost: ['fantome', 'ghost', 'spectre', 'esprit', 'spirit', 'revenant'],
  plant: ['plante', 'plant', 'fleur', 'flower', 'carnivore', 'mandragore'],
};

/** Génère le SVG procédural (repli hors-ligne, modèles de projets). */
export function proceduralSvg(params: ImageSvgParams, rng: Rng): string {
  const [width, height] = resolveSvgSize(params);
  const text = params.prompt;
  const color = params.color ?? params.palette?.[0] ?? colorFromText(text);
  const style = params.style;
  const background = (scene: SceneName) =>
    drawBackground(
      {
        scene,
        time: params.timeOfDay ?? timeFromText(text) ?? 'day',
        style,
        width,
        height,
        accent: params.palette?.[0],
      },
      rng,
    );
  switch (params.subject) {
    case 'portrait':
      return drawPortrait({ ...params, style, width, height }, rng);
    case 'background':
      return background(
        params.scene ??
          sceneFromText(text) ??
          rng.pick(['park', 'street', 'forest', 'beach', 'generic', 'castle'] as const)
      );
    case 'battler':
      return drawBattler(
        {
          creature:
            params.creature ?? matchKeyword(text, CREATURE_WORDS) ?? rng.pick(CREATURES),
          color,
          style,
          width,
          height,
        },
        rng
      );
    case 'object':
    case 'icon':
      return drawObject({
        object: matchKeyword(text, OBJECT_WORDS) ?? rng.pick(OBJECTS),
        color,
        style,
        width,
        height,
        icon: params.subject === 'icon',
      });
    case 'illustration': {
      const scene = params.scene ?? sceneFromText(text);
      if (scene) return background(scene);
      const creature = params.creature ?? matchKeyword(text, CREATURE_WORDS);
      if (creature) return drawBattler({ creature, color, style, width, height }, rng);
      const object = matchKeyword(text, OBJECT_WORDS);
      if (object) return drawObject({ object, color, style, width, height, icon: false });
      return background(rng.pick(['generic', 'park', 'beach', 'castle', 'forest'] as const));
    }
  }
}

const SYSTEM_PROMPT = `You are an illustrator producing vector art (SVG) for Forge, a web game engine (visual novels, RPGs).
The SVG you write is sanitized, then rasterized to PNG at the requested size; the SVG itself is kept as the editable source.

Spec: { "width", "height", "svg" } where svg is ONE complete standalone document:
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H"> ... </svg>
(use the requested width/height; the viewBox may use other design units if the aspect ratio matches).

Technical rules:
- Allowed: path, rect, circle, ellipse, polygon, polyline, line, g, defs, linearGradient, radialGradient, clipPath,
  mask, use (#id only), simple filters (feGaussianBlur, feOffset, feComponentTransfer), opacity, transforms.
- Forbidden: <script>, <foreignObject>, <image>, <text> and any letters/numbers drawn in the art, external href/url(),
  CSS @import, web fonts, animations, event attributes.
- Keep the document under ~40 KB: round coordinates to 0-1 decimal, reuse gradients, prefer a few smooth paths over
  hundreds of tiny shapes, no noise textures.
- Give every id a unique, short name.

Subjects:
- background: full-bleed scene (paint the whole canvas), no characters, no text. Build depth with layers (sky, far,
  middle, near), atmospheric perspective (farther = lighter, bluer, less contrast), one clear light source consistent with
  the time of day (day: bright sky, soft shadows; sunset: warm orange/pink light, long shadows, purple shade; night:
  dark blue palette, stars, warm lit windows and lamp halos). Keep the lower-middle area calm: characters and the dialogue
  box will cover it in a visual novel.
- portrait: visual-novel character sprite, waist-up, facing the viewer, TRANSPARENT background (never fill the canvas).
  Center the character; top of the hair at ~10-14% of the height, chin at ~50%, shoulders at ~58-62%, body cut by the
  bottom edge. Anime-inspired proportions: big expressive eyes with iris gradient and two white highlights, small nose,
  simple mouth, eyebrows drawn above the hair so the expression reads. Cel shading: base color + one shadow tone + one
  highlight per material, hair with a glossy highlight band, soft blush. Respect every given appearance field (hairColor,
  eyeColor, skinTone, outfitColor, hairStyle) and the expression (neutral, happy, sad = tears / droopy brows,
  angry = V brows, surprised = wide eyes / small pupils, embarrassed = strong blush / sweat drop). The \`character\` name
  identifies a recurring character: keep the same identity so different expressions look like the same person.
- battler: RPG enemy, full body, centered, transparent background, facing the viewer or 3/4, a soft ground shadow ellipse
  under it, readable silhouette, big shapes, highlights, cute or menacing according to the description.
- object / icon: one item centered, transparent background, filling ~80% of the canvas, bold outline, strong highlight
  and sparkle; an icon must stay readable at 32x32 px (simple silhouette, thick outline, high contrast).
- illustration: free full-bleed composition following the description.

Art direction (polished indie-game quality): cohesive palette of 5-8 main hues (use the imposed palette when given),
light from the top-left, gradients for volume, soft cast shadows, rim or specular highlights, outlines in a dark tinted
color (never pure black), clean smooth curves. Styles: "soft" = gradients + thin soft outlines; "flat" = flat colors, no
outlines, no gradients; "lineart" = bold dark outlines with light fills; "retro" = limited palette, flat colors,
thick outlines, 90s game look.
${FRENCH_AUDIENCE_NOTE}`;

export const imageSvgGenerator: GeneratorDefinition<ImageSvgParams, ImageSvgSpec> = {
  id: 'image.svg',
  kind: 'image',
  label: 'Image vectorielle',
  description:
    'Illustration vectorielle (SVG rendu en PNG) : décor, portrait de personnage, monstre de combat, objet, icône.',
  paramsSchema: imageSvgParamsSchema,
  specSchema: imageSvgSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt(params) {
    const [width, height] = resolveSvgSize(params);
    return requestMessage(
      `a ${params.subject} image (SVG, ${width}x${height}, style "${params.style}")`,
      params.prompt,
      params,
      [
        `The spec must use width ${width} and height ${height}.`,
        params.subject === 'portrait' ||
          params.subject === 'battler' ||
          params.subject === 'object' ||
          params.subject === 'icon'
          ? 'The background must stay transparent.'
          : 'Paint the whole canvas.',
      ]
    );
  },
  buildEditPrompt(spec, instruction, params) {
    return editMessage(spec, instruction, params, [`Keep width ${spec.width} and height ${spec.height}.`]);
  },
  procedural(params, rng) {
    const [width, height] = resolveSvgSize(params);
    return { width, height, svg: proceduralSvg(params, rng) };
  },
  async render(spec, params, ctx) {
    const svg = sanitizeSvg(spec.svg, { width: spec.width, height: spec.height });
    const png = await ctx.rasterizeSvg(svg, spec.width, spec.height);
    return {
      files: [pngFile('main', png), svgFile('source', svg)],
      info: { width: spec.width, height: spec.height, subject: params.subject },
    };
  },
};

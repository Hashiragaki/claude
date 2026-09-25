import { z } from 'zod';

export const ANIM_SUBJECTS = ['creature', 'effect', 'character', 'object'] as const;

export const anim2dParamsSchema = z.object({
  prompt: z
    .string()
    .default(‘’)
    .describe("Description de l’animation"),
  subject: z
    .enum(ANIM_SUBJECTS)
    .default(‘effect’)
    .describe(‘Sujet’),
  width: z
    .number()
    .int()
    .min(16)
    .max(256)
    .default(96)
    .describe(‘Largeur d\’une frame (px)’),
  height: z
    .number()
    .int()
    .min(16)
    .max(256)
    .default(96)
    .describe(‘Hauteur d\’une frame (px)’),
  frames: z
    .number()
    .int()
    .min(2)
    .max(16)
    .default(8)
    .describe(‘Nombre de frames par animation’),
  fps: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(10)
    .describe(‘Images par seconde’),
  animations: z
    .array(
      z.string().regex(
        /^[a-z][a-z0-9_]*$/,
        ‘Nom d\’animation : minuscules, chiffres et « _ » ‘ +
          ‘(ex. « idle », « walk »).’,
      ),
    )
    .min(1)
    .max(8)
    .default([‘idle’])
    .describe(‘Animations à produire (ex. idle, walk, attack)’),
});

export type Anim2dParams = z.output<typeof anim2dParamsSchema>;

const vec2 = z.array(z.number()).length(2, 'Attendu : un tableau de 2 nombres [x, y].');

export const keySchema = z.object({
  part: z.string().describe('Id of the part this key animates'),
  frame: z.number().int().min(0).describe('Frame index (0 = first frame; may equal `frames` to close a loop)'),
  translate: vec2.optional().describe('Offset [dx, dy] in pixels from the rest pose'),
  rotate: z.number().optional().describe('Rotation in degrees around the pivot (clockwise)'),
  scale: vec2.optional().describe('Scale [sx, sy] around the pivot'),
  opacity: z.number().min(0).max(1).optional().describe('Opacity 0-1'),
});

export const partSchema = z.object({
  id: z.string().regex(
    /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/,
    'Id de pièce : lettres, chiffres, « _ » ou « - », ' +
      'commençant par une lettre.',
  ),
  svg: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'SVG fragment (shapes only, no <svg> root) drawn in ' +
        'frame coordinates, rest pose',
    ),
  pivot: vec2.describe(
    'Rotation/scale center [x, y] in frame coordinates',
  ),
});

export const animationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Nom d’animation : minuscules, chiffres et « _ ».'),
  frames: z.number().int().min(1).max(16),
  loop: z.boolean(),
  keys: z.array(keySchema).max(400),
});

export const anim2dSpecSchema = z
  .object({
    width: z.number().int().min(16).max(256).describe('Frame width in pixels'),
    height: z.number().int().min(16).max(256).describe('Frame height in pixels'),
    fps: z.number().int().min(1).max(60),
    parts: z.array(partSchema).min(1).max(24).describe('Drawn back to front'),
    animations: z.array(animationSchema).min(1).max(8),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    spec.parts.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', path: ['parts', i, 'id'], message: `Id de pièce en double : « ${p.id} ».` });
      ids.add(p.id);
      if (/<svg[\s>]/i.test(p.svg)) {
        ctx.addIssue({ code: 'custom', path: ['parts', i, 'svg'], message: 'Un fragment de pièce ne doit pas contenir de racine <svg>.' });
      }
    });
    const names = new Set<string>();
    spec.animations.forEach((a, i) => {
      if (names.has(a.name)) ctx.addIssue({ code: 'custom', path: ['animations', i, 'name'], message: `Animation en double : « ${a.name} ».` });
      names.add(a.name);
      a.keys.forEach((k, j) => {
        if (!ids.has(k.part)) {
          ctx.addIssue({ code: 'custom', path: ['animations', i, 'keys', j, 'part'], message: `Pièce inconnue « ${k.part} » (pièces : ${[...ids].join(', ')}).` });
        }
        if (k.frame > a.frames) {
          ctx.addIssue({ code: 'custom', path: ['animations', i, 'keys', j, 'frame'], message: `Frame ${k.frame} hors de l’animation « ${a.name} » (0 à ${a.frames}).` });
        }
      });
    });
    const cols = Math.max(...spec.animations.map((a) => a.frames));
    if (cols * spec.width > 4096 || spec.animations.length * spec.height > 4096) {
      ctx.addIssue({ code: 'custom', path: ['width'], message: 'Planche trop grande (4096 px maximum par côté) : réduisez la taille ou le nombre de frames.' });
    }
  });

export type Anim2dSpec = z.output<typeof anim2dSpecSchema>;
export type AnimKey = z.output<typeof keySchema>;
export type AnimPart = z.output<typeof partSchema>;
export type Animation = z.output<typeof animationSchema>;

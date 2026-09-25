import { z } from 'zod';

/** Couleur `#rgb` ou `#rrggbb`. */
export const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Couleur hexadécimale attendue (ex. « #6fb7ff »)');

/** Référence d'asset : id, alias ou chemin de fichier (résolue via `AssetRegistry.resolve`). */
export const AssetRefSchema = z.string().trim().min(1, 'Référence d’asset vide');

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const TimeOfDaySchema = z.enum(['day', 'sunset', 'night']);

export const ColliderSchema = z.union([z.object({ radius: z.number().nonnegative() }), z.literal(false)]);

export const InteractionSchema = z.object({
  /** Texte affiché dans la boîte de dialogue. */
  text: z.string().trim().min(1, 'Texte d’interaction vide'),
  /** Animation de l'objet jouée une fois à l'interaction (ex. `open`, `wave`). */
  animation: z.string().min(1).optional(),
  /** L'interaction n'est possible qu'une seule fois. */
  once: z.boolean().default(false),
});

export const SceneObjectSchema = z.object({
  id: z.string().trim().min(1, 'Identifiant d’objet vide'),
  model: AssetRefSchema,
  /** Position en mètres (Y vers le haut). */
  position: Vec3Schema,
  /** Rotation en degrés autour de X, Y, Z. */
  rotation: Vec3Schema.optional(),
  /** Échelle uniforme ou par axe. */
  scale: z.union([z.number().positive(), Vec3Schema]).optional(),
  /** Animation jouée en boucle (ex. `sway`, `idle`). */
  animation: z.string().min(1).optional(),
  /**
   * Cercle de collision au sol (rayon en mètres, non multiplié par l'échelle) ; `false` pour
   * traverser l'objet. Absent : rayon par défaut multiplié par l'échelle.
   */
  collider: ColliderSchema.optional(),
  interact: InteractionSchema.optional(),
});

export const DEFAULT_SKY = { top: '#6fb7ff', bottom: '#e6f4ff' };
export const DEFAULT_GROUND = { size: 40, color: '#6aa84f' };
export const DEFAULT_PLAYER_SPEED = 3;
export const DEFAULT_PLAYER_RADIUS = 0.35;
export const DEFAULT_CAMERA = { distance: 6, height: 2.5 };

export const PlayerSchema = z.object({
  /** Modèle du joueur ; absent : capsule. */
  model: AssetRefSchema.optional(),
  /** Animation au repos (ex. `idle`). */
  idle: z.string().min(1).optional(),
  /** Animation de marche (ex. `walk`). */
  walk: z.string().min(1).optional(),
  /** Vitesse de marche (m/s) ; la course (`dash`) la multiplie. */
  speed: z.number().positive().max(50).default(DEFAULT_PLAYER_SPEED),
  scale: z.number().positive().optional(),
  /** Rayon de collision (mètres). */
  radius: z.number().positive().max(5).default(DEFAULT_PLAYER_RADIUS),
});

export const SceneSchema = z
  .object({
    name: z.string().default('Scène 3D'),
    sky: z.object({ top: HexColorSchema, bottom: HexColorSchema }).default(DEFAULT_SKY),
    timeOfDay: TimeOfDaySchema.default('day'),
    fog: z
      .object({ color: HexColorSchema, near: z.number().nonnegative(), far: z.number().positive() })
      .refine((f) => f.far > f.near, {
        message: 'Le brouillard doit avoir « far » supérieur à « near »',
        path: ['far'],
      })
      .optional(),
    ground: z.object({ size: z.number().positive().max(2000), color: HexColorSchema }).default(DEFAULT_GROUND),
    spawn: z
      .object({
        x: z.number(),
        z: z.number(),
        /** Orientation initiale du joueur (degrés, 0 = regarde vers +Z). */
        rotation: z.number().optional(),
      })
      .default({ x: 0, z: 0 }),
    player: PlayerSchema.default({ speed: DEFAULT_PLAYER_SPEED, radius: DEFAULT_PLAYER_RADIUS }),
    camera: z
      .object({
        distance: z.number().positive().default(DEFAULT_CAMERA.distance),
        height: z.number().default(DEFAULT_CAMERA.height),
      })
      .optional(),
    music: AssetRefSchema.optional(),
    objects: z.array(SceneObjectSchema).default([]),
  })
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    scene.objects.forEach((obj, index) => {
      if (seen.has(obj.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Identifiant d’objet en double : « ${obj.id} »`,
          path: ['objects', index, 'id'],
        });
      }
      seen.add(obj.id);
    });
  });

export type SceneData = z.output<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;
export type SceneObject = z.output<typeof SceneObjectSchema>;
export type SceneObjectInput = z.input<typeof SceneObjectSchema>;
export type PlayerConfig = z.output<typeof PlayerSchema>;
export type TimeOfDay = z.output<typeof TimeOfDaySchema>;

let frenchErrors: ReturnType<typeof z.locales.fr> | null = null;

/** Validation avec messages d'erreur génériques en français (sans modifier la config globale de zod). */
export function safeParseScene(data: unknown): z.ZodSafeParseResult<SceneData> {
  frenchErrors ??= z.locales.fr();
  return SceneSchema.safeParse(data, { error: frenchErrors.localeError });
}

/** Valide et complète (valeurs par défaut) les données d'une scène ; lève une erreur lisible sinon. */
export function parseScene(data: unknown): SceneData {
  const result = safeParseScene(data);
  if (!result.success) throw new Error(`Scène invalide :\n${describeSceneError(result.error)}`);
  return result.data;
}

/** Formate un chemin d'erreur zod (`objects[3].position`). */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out;
}

/** Message lisible (français) pour une erreur de validation de scène. */
export function describeSceneError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = formatIssuePath(issue.path);
      return where ? `${where} : ${issue.message}` : issue.message;
    })
    .join('\n');
}

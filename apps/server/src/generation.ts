import { StructuredGenerationError, generateStructured, type LlmClient, type StructuredReview } from '@forge/ai';
import { Rng, nowIso, shortId, slugify, type AssetKind, type AssetMeta, type AssetOrigin } from '@forge/core';
import {
  GENERATORS,
  getGenerator,
  readPngSize,
  upscalePngNearest,
  type GeneratorDefinition,
  type GeneratorResult,
} from '@forge/generators';
import { z } from 'zod';
import { rasterizeSvg } from './rasterize';
import type { ProjectStore } from './storage';

export const GenerateRequestSchema = z.object({
  generator: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  prompt: z.string().optional(),
  /** `auto` : IA si disponible, sinon procédural. */
  mode: z.enum(['auto', 'ai', 'procedural']).default('auto'),
  name: z.string().optional(),
  alias: z.string().optional(),
  tags: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
  /** Asset dont celui-ci est une nouvelle version (variante ou retouche). */
  parentId: z.string().optional(),
  /** Instruction de retouche appliquée à la spec de `parentId` (nécessite l'IA). */
  instruction: z.string().optional(),
  origin: z.enum(['ai', 'procedural', 'import', 'template']).optional(),
  /**
   * Critique visuelle du rendu par l'IA (voir `GenerationServiceOptions.visionReview` pour le
   * défaut quand cette clé est absente). Ignorée hors génération par IA ou pour un générateur non
   * `reviewable`.
   */
  review: z.boolean().optional(),
});
export type GenerateRequest = z.input<typeof GenerateRequestSchema>;

const KIND_DIRS: Record<string, string> = {
  image: 'images',
  spritesheet: 'animations',
  charset: 'characters',
  tileset: 'tilesets',
  sfx: 'sounds',
  music: 'music',
  model: 'models',
};

/** Types d'assets dont le rendu est une image qu'on peut montrer à l'IA pour critique. */
const REVIEWABLE_KINDS: ReadonlySet<AssetKind> = new Set(['image', 'charset', 'tileset', 'spritesheet']);

/** Description publique d'un générateur (pour l'éditeur). */
export function describeGenerators() {
  return GENERATORS.map((g: GeneratorDefinition) => ({
    id: g.id,
    kind: g.kind,
    label: g.label,
    description: g.description,
    params: z.toJSONSchema(g.paramsSchema, { unrepresentable: 'any', io: 'input' }),
    reviewable: REVIEWABLE_KINDS.has(g.kind),
  }));
}

export interface GenerationServiceOptions {
  /**
   * Active la critique visuelle par défaut, quand la requête ne précise pas `review`. Par défaut,
   * lit la variable d'environnement `FORGE_VISION_REVIEW` (désactivée seulement si elle vaut `off`).
   */
  visionReview?: boolean;
}

/** Rendu mis en cache pendant la critique visuelle, réutilisé s'il correspond à la spec finale. */
interface RenderCache {
  spec: unknown;
  result: GeneratorResult;
}

/** Rend un `GeneratorResult` en image à montrer à l'IA pour critique (voir `StructuredReview.render`). */
function buildReviewRender(result: GeneratorResult): { image?: { data: Uint8Array; mediaType: 'image/png' }; note?: string } | null {
  const main = result.files.find((f) => f.role === 'main');
  if (!main || !(main.data instanceof Uint8Array)) return null;
  const size = readPngSize(main.data);
  if (!size) return null;
  const largest = Math.max(size.width, size.height);
  const needsUpscale = Boolean(result.info.pixelArt) || largest < 256;
  if (!needsUpscale) return { image: { data: main.data, mediaType: 'image/png' }, note: `Rendu ${size.width}×${size.height}` };
  const factor = Math.min(8, Math.max(2, Math.floor(512 / largest)));
  const upscaled = upscalePngNearest(main.data, factor);
  return { image: { data: upscaled, mediaType: 'image/png' }, note: `Rendu ${size.width}×${size.height} (agrandi ×${factor})` };
}

/**
 * Génère un asset (IA ou procédural), écrit ses fichiers dans le projet et l'enregistre dans
 * le manifeste, avec historique de versions et alias unique.
 */
export class GenerationService {
  private readonly visionReview: boolean;

  constructor(
    private readonly store: ProjectStore,
    private readonly llm: LlmClient | null,
    options: GenerationServiceOptions = {},
  ) {
    this.visionReview = options.visionReview ?? process.env.FORGE_VISION_REVIEW !== 'off';
  }

  get aiAvailable(): boolean {
    return this.llm !== null;
  }

  async generate(
    projectId: string,
    input: GenerateRequest,
    report: (progress: string) => void = () => undefined,
    signal?: AbortSignal,
  ): Promise<AssetMeta> {
    const req = GenerateRequestSchema.parse(input);
    const generator = getGenerator(req.generator);
    if (!generator) throw new Error(`Générateur inconnu : ${req.generator}`);
    const manifest = await this.store.readManifest(projectId);
    const parent = req.parentId ? manifest.assets.find((a) => a.id === req.parentId) : undefined;
    if (req.parentId && !parent) throw new Error(`Asset parent introuvable : ${req.parentId}`);

    const rawParams = { ...(parent?.params ?? {}), ...req.params };
    if (req.prompt !== undefined) rawParams.prompt = req.prompt;
    const params = generator.paramsSchema.parse(rawParams);
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const useAi = req.mode === 'ai' || (req.mode === 'auto' && this.llm !== null);
    if ((useAi || req.instruction) && !this.llm) {
      throw new Error('L\'IA n\'est pas configurée (ANTHROPIC_API_KEY) : utilisez le mode procédural.');
    }

    // Critique active seulement quand l'IA produit la spec (génération ou retouche), pour un
    // générateur dont le rendu est une image, et si la requête ou le défaut du service l'activent.
    const aiUsed = useAi || Boolean(req.instruction && parent);
    const reviewEnabled = aiUsed && REVIEWABLE_KINDS.has(generator.kind) && (req.review ?? this.visionReview);

    let spec: unknown;
    let origin: AssetOrigin;
    let reviews = 0;
    let cache: RenderCache | undefined;
    if (req.instruction && parent) {
      report('Retouche par l\'IA…');
      const current = await this.loadSpec(projectId, parent);
      const ai = await this.askAi(generator, generator.buildEditPrompt(current, req.instruction, params), params, reviewEnabled, report, signal);
      spec = ai.value;
      reviews = ai.reviews;
      cache = ai.cache;
      origin = 'ai';
    } else if (useAi) {
      report('Génération par l\'IA…');
      const ai = await this.askAi(generator, generator.buildPrompt(params), params, reviewEnabled, report, signal);
      spec = ai.value;
      reviews = ai.reviews;
      cache = ai.cache;
      origin = 'ai';
    } else {
      report('Génération procédurale…');
      spec = generator.procedural(params, new Rng(seed));
      origin = 'procedural';
    }
    if (req.origin) origin = req.origin;
    signal?.throwIfAborted();

    report('Rendu…');
    // Le dernier tour de critique a déjà rendu cette spec exacte : pas la peine de la refaire.
    const result = cache && cache.spec === spec ? cache.result : await generator.render(spec, params, { rasterizeSvg });

    const prompt = typeof (params as { prompt?: unknown }).prompt === 'string' ? (params as { prompt: string }).prompt : '';
    const name = req.name ?? parent?.name ?? (prompt ? truncateWords(prompt, 6) : generator.label);
    const id = shortId('a');
    const base = `assets/${KIND_DIRS[generator.kind] ?? 'misc'}/${slugify(name, 32)}-${id.slice(2, 8)}`;
    const assetFile = (role: string, ext: string) =>
      role === 'main' ? `${base}.${ext}` : role === 'source' ? `${base}.source.${ext}` : `${base}.${role}.${ext}`;

    report('Enregistrement…');
    let file = '';
    let source: string | undefined;
    const extra: Record<string, string> = {};
    const mainFile = result.files.find((f) => f.role === 'main');
    if (!mainFile) throw new Error('Le générateur n\'a produit aucun fichier principal.');
    for (const f of result.files) {
      const target = assetFile(f.role, f.ext);
      let data = f.data;
      if (f.role === 'atlas' && typeof data === 'string') data = patchAtlasImage(data, `${base.split('/').pop()}.${mainFile.ext}`);
      await this.store.writeFile(projectId, target, data);
      if (f.role === 'main') file = target;
      else if (f.role === 'source') source = target;
      else extra[f.role] = target;
    }
    extra.spec = `${base}.spec.json`;
    await this.store.writeFile(projectId, extra.spec, JSON.stringify(spec));

    const alias = req.alias ?? parent?.alias;
    const asset: AssetMeta = {
      id,
      kind: generator.kind,
      name,
      ...(alias ? { alias } : {}),
      file,
      ...(source ? { source } : {}),
      extra,
      mime: mainFile.mime,
      tags: req.tags ?? parent?.tags ?? [],
      origin,
      generator: generator.id,
      ...(prompt ? { prompt } : {}),
      params: params as Record<string, unknown>,
      seed,
      ...(parent ? { parentId: parent.id } : {}),
      version: parent ? parent.version + 1 : 1,
      info: reviews > 0 ? { ...result.info, reviewRounds: reviews } : result.info,
      createdAt: nowIso(),
    };
    await this.store.updateManifest(projectId, (m) => {
      if (alias) {
        // L'alias passe à la nouvelle version : les scripts utilisent toujours la plus récente.
        for (const other of m.assets) if (other.alias?.toLowerCase() === alias.toLowerCase()) delete other.alias;
      }
      m.assets.push(asset);
    });
    return asset;
  }

  /**
   * Demande la spec à l'IA (via `generateStructured`), avec critique visuelle optionnelle du
   * rendu. Renvoie aussi le rendu mis en cache pendant la critique, pour éviter de le refaire.
   */
  private async askAi(
    generator: GeneratorDefinition,
    prompt: string,
    params: unknown,
    reviewEnabled: boolean,
    report: (progress: string) => void,
    signal?: AbortSignal,
  ): Promise<{ value: unknown; reviews: number; cache?: RenderCache }> {
    let cache: RenderCache | undefined;
    const review: StructuredReview<unknown> | undefined = reviewEnabled
      ? {
          maxRounds: 1,
          instructions: generator.reviewHint,
          render: async (value) => {
            const result = await generator.render(value, params, { rasterizeSvg });
            cache = { spec: value, result };
            return buildReviewRender(result);
          },
        }
      : undefined;
    try {
      const result = await generateStructured({
        llm: this.llm as LlmClient,
        system: generator.systemPrompt,
        prompt,
        schema: generator.specSchema,
        signal,
        onAttempt: (attempt, error) => {
          if (attempt > 1) report(`Correction par l'IA (essai ${attempt})… ${error ? error.split('\n')[0] : ''}`);
        },
        review,
        onReview: () => report('Critique du rendu par l\'IA…'),
      });
      return { value: result.value, reviews: result.reviews, cache };
    } catch (error) {
      if (error instanceof StructuredGenerationError) throw new Error(`L'IA n'a pas produit un résultat valide : ${error.lastError}`);
      throw error;
    }
  }

  private async loadSpec(projectId: string, asset: AssetMeta): Promise<unknown> {
    const path = asset.extra.spec;
    if (!path) throw new Error('Cet asset n\'a pas de spec éditable (import ou ancienne version).');
    return JSON.parse(await this.store.readText(projectId, path));
  }
}

function patchAtlasImage(json: string, image: string): string {
  try {
    const atlas = JSON.parse(json) as { meta?: { image?: string } };
    atlas.meta = { ...(atlas.meta ?? {}), image };
    return JSON.stringify(atlas);
  } catch {
    return json;
  }
}

function truncateWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/);
  const short = words.slice(0, count).join(' ');
  return words.length > count ? `${short}…` : short;
}

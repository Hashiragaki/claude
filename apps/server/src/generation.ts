import { StructuredGenerationError, generateStructured, type LlmClient } from '@forge/ai';
import { Rng, nowIso, shortId, slugify, type AssetMeta, type AssetOrigin } from '@forge/core';
import { GENERATORS, getGenerator, type GeneratorDefinition } from '@forge/generators';
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

/** Description publique d'un générateur (pour l'éditeur). */
export function describeGenerators() {
  return GENERATORS.map((g: GeneratorDefinition) => ({
    id: g.id,
    kind: g.kind,
    label: g.label,
    description: g.description,
    params: z.toJSONSchema(g.paramsSchema, { unrepresentable: 'any', io: 'input' }),
  }));
}

/**
 * Génère un asset (IA ou procédural), écrit ses fichiers dans le projet et l'enregistre dans
 * le manifeste, avec historique de versions et alias unique.
 */
export class GenerationService {
  constructor(
    private readonly store: ProjectStore,
    private readonly llm: LlmClient | null,
  ) {}

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

    let spec: unknown;
    let origin: AssetOrigin;
    if (req.instruction && parent) {
      report('Retouche par l\'IA…');
      const current = await this.loadSpec(projectId, parent);
      spec = await this.askAi(generator, generator.buildEditPrompt(current, req.instruction, params), report, signal);
      origin = 'ai';
    } else if (useAi) {
      report('Génération par l\'IA…');
      spec = await this.askAi(generator, generator.buildPrompt(params), report, signal);
      origin = 'ai';
    } else {
      report('Génération procédurale…');
      spec = generator.procedural(params, new Rng(seed));
      origin = 'procedural';
    }
    if (req.origin) origin = req.origin;
    signal?.throwIfAborted();

    report('Rendu…');
    const result = await generator.render(spec, params, { rasterizeSvg });

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
      info: result.info,
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

  private async askAi(
    generator: GeneratorDefinition,
    prompt: string,
    report: (progress: string) => void,
    signal?: AbortSignal,
  ): Promise<unknown> {
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
      });
      return result.value;
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

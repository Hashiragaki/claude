import {
  PROJECT_FORMAT,
  nowIso,
  shortId,
  slugify,
  type Diagnostic,
  type ModeRegistry,
  type ProjectManifest,
} from '@forge/core';
import { z } from 'zod';
import type { EventHub } from './events';
import type { GenerationService } from './generation';
import type { PlannerService } from './plannerService';
import { ConflictError, type ProjectStore } from './storage';

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du projet est obligatoire').max(80),
  mode: z.string(),
  template: z.string().optional(),
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.input<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  locale: z.string().optional(),
  resolution: z.object({ width: z.number().int().min(64).max(4096), height: z.number().int().min(64).max(4096) }).optional(),
  pixelArt: z.boolean().optional(),
  entry: z.string().optional(),
});

/** Création de projets à partir des modèles des modes, et validation. */
export class ProjectService {
  constructor(
    private readonly store: ProjectStore,
    private readonly modes: ModeRegistry,
    private readonly generation: GenerationService,
    private readonly planners: PlannerService,
    private readonly hub: EventHub,
  ) {}

  async create(input: CreateProjectInput, report: (progress: string) => void = () => undefined): Promise<ProjectManifest> {
    const { name, mode: modeId, template: templateId, description } = CreateProjectSchema.parse(input);
    const mode = this.modes.get(modeId);
    const template = mode.templates.find((t) => t.id === templateId) ?? mode.templates[0];
    if (!template) throw new Error(`Le mode ${mode.name} ne propose aucun modèle.`);
    // Le suffixe aléatoire de l'id peut, rarement, coïncider avec un projet déjà présent sur le
    // disque : createManifest échoue alors (EEXIST) sans rien écraser, et on retire un autre id.
    let id: string;
    for (let attempt = 0; ; attempt++) {
      id = `${slugify(name, 40)}-${shortId('', 4)}`;
      const now = nowIso();
      const manifest: ProjectManifest = {
        format: PROJECT_FORMAT,
        id,
        name,
        description: description ?? template.manifest.description ?? template.description,
        mode: mode.id,
        version: '0.1.0',
        locale: template.manifest.locale ?? 'fr',
        locales: ['fr', 'en'],
        resolution: template.manifest.resolution ?? { width: 1280, height: 720 },
        pixelArt: template.manifest.pixelArt ?? false,
        entry: template.manifest.entry,
        createdAt: now,
        updatedAt: now,
        assets: [],
      };
      try {
        await this.store.createManifest(manifest);
        break;
      } catch (error) {
        if (error instanceof ConflictError && attempt < 19) continue;
        throw error;
      }
    }
    try {
      for (const file of template.files) {
        const content = typeof file.content === 'string' ? file.content : `${JSON.stringify(file.content, null, 2)}\n`;
        await this.store.writeFile(id, file.path, content);
      }
      let n = 0;
      for (const request of template.assets) {
        report(`Génération des assets du modèle (${++n}/${template.assets.length}) : ${request.name}`);
        await this.generation.generate(id, {
          generator: request.generator,
          params: request.params,
          mode: 'procedural',
          seed: request.seed,
          name: request.name,
          alias: request.alias,
          tags: request.tags,
          origin: 'template',
        });
      }
      await this.planners.seed(id, mode.id);
    } catch (error) {
      await this.store.delete(id).catch(() => undefined);
      throw error;
    }
    return this.store.readManifest(id);
  }

  async update(id: string, patch: z.input<typeof UpdateProjectSchema>): Promise<ProjectManifest> {
    const data = UpdateProjectSchema.parse(patch);
    const manifest = await this.store.updateManifest(id, (m) => {
      Object.assign(m, data);
    });
    this.hub.publish(id, { type: 'manifest', data: manifest });
    return manifest;
  }

  async validate(id: string): Promise<Diagnostic[]> {
    const manifest = await this.store.readManifest(id);
    const mode = this.modes.get(manifest.mode);
    if (!mode.validate) return [];
    try {
      return await mode.validate({ manifest, files: this.store.files(id) });
    } catch (error) {
      return [{ file: manifest.entry, severity: 'error', message: error instanceof Error ? error.message : String(error) }];
    }
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
    this.planners.forget(id);
  }
}

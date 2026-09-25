import { defineTool, type AgentTool } from '@forge/ai';
import type { AssetMeta, ProjectManifest } from '@forge/core';
import { z } from 'zod';
import { describeGenerators, type GenerateRequest } from './generation';
import type { ProjectService } from './projects';
import { isInternal, type ProjectStore } from './storage';

/** Dossiers du projet que l'IA peut lire et écrire. */
const WRITABLE_DIRS = ['scripts/', 'data/', 'maps/', 'notes/', 'scenes/'];

export interface ProjectToolDeps {
  store: ProjectStore;
  projects: ProjectService;
  /** Lance une génération (via la file de jobs) et attend l'asset. */
  generate(request: GenerateRequest): Promise<AssetMeta>;
  aiAvailable: boolean;
}

export function describeAsset(a: AssetMeta): string {
  const info = Object.entries(a.info)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `[${a.id}] ${a.kind} « ${a.name} »${a.alias ? ` alias « ${a.alias} »` : ''} v${a.version} → ${a.file}${
    info ? ` (${info})` : ''
  }`;
}

/** Résumé du projet injecté dans le contexte de l'assistant. */
export function projectSummary(m: ProjectManifest): string {
  const counts = new Map<string, number>();
  for (const a of m.assets) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const aliases = m.assets.filter((a) => a.alias).map((a) => `${a.alias} (${a.kind})`);
  return [
    `Nom : ${m.name} — mode ${m.mode} — résolution ${m.resolution.width}×${m.resolution.height}${m.pixelArt ? ', pixel-art' : ''}`,
    m.description ? `Description : ${m.description}` : '',
    `Fichier d'entrée : ${m.entry}`,
    `Assets : ${m.assets.length ? [...counts].map(([k, n]) => `${n} ${k}`).join(', ') : 'aucun'}`,
    aliases.length ? `Alias utilisables dans les scripts : ${aliases.slice(0, 80).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Outils d'accès au projet (fichiers, assets, génération) pour l'assistant. */
export function createProjectTools(projectId: string, deps: ProjectToolDeps): AgentTool[] {
  const checkWritable = (path: string) => {
    const normalized = path.replace(/^\.?\//, '');
    if (isInternal(normalized) || !WRITABLE_DIRS.some((d) => normalized.startsWith(d))) {
      throw new Error(`Écriture autorisée seulement dans : ${WRITABLE_DIRS.join(', ')}`);
    }
    return normalized;
  };

  const tools: AgentTool[] = [
    defineTool({
      name: 'get_project_summary',
      description: 'Résumé du projet : mode, résolution, fichier d\'entrée, assets et alias disponibles.',
      schema: z.object({}),
      run: async () => projectSummary(await deps.store.readManifest(projectId)),
    }),
    defineTool({
      name: 'list_assets',
      description: 'Liste les assets du projet (filtre optionnel par type ou texte).',
      schema: z.object({
        kind: z.enum(['image', 'spritesheet', 'charset', 'tileset', 'sfx', 'music', 'model']).optional(),
        search: z.string().optional(),
      }),
      run: async ({ kind, search }) => {
        const m = await deps.store.readManifest(projectId);
        const q = search?.toLowerCase();
        const list = m.assets
          .filter((a) => !kind || a.kind === kind)
          .filter((a) => !q || `${a.name} ${a.alias ?? ''} ${a.prompt ?? ''} ${a.tags.join(' ')}`.toLowerCase().includes(q));
        return list.map(describeAsset).join('\n') || 'Aucun asset.';
      },
    }),
    defineTool({
      name: 'list_files',
      description: 'Liste les fichiers du projet (scripts, cartes, données, assets).',
      schema: z.object({ prefix: z.string().optional() }),
      run: async ({ prefix }) =>
        (await deps.store.tree(projectId))
          .filter((f) => !prefix || f.path.startsWith(prefix))
          .map((f) => `${f.path} (${f.size} o)`)
          .join('\n') || 'Aucun fichier.',
    }),
    defineTool({
      name: 'read_file',
      description: 'Lit un fichier texte du projet (script .vn, carte ou données JSON, notes).',
      schema: z.object({ path: z.string() }),
      run: async ({ path }) => deps.store.readText(projectId, path),
    }),
    defineTool({
      name: 'write_file',
      description:
        'Crée ou remplace un fichier texte du projet (scripts/, data/, maps/, notes/, scenes/). Renvoie les ' +
        'diagnostics de validation du projet après écriture : corrige les erreurs signalées.',
      schema: z.object({ path: z.string(), content: z.string() }),
      run: async ({ path, content }) => {
        const target = checkWritable(path);
        if (target.endsWith('.json')) JSON.parse(content);
        await deps.store.writeFile(projectId, target, content);
        const diagnostics = await deps.projects.validate(projectId);
        const relevant = diagnostics.filter((d) => d.severity !== 'info');
        return `Fichier écrit : ${target}.\n${
          relevant.length
            ? `Diagnostics :\n${relevant.map((d) => `- ${d.severity} ${d.file}${d.line ? `:${d.line}` : ''} — ${d.message}`).join('\n')}`
            : 'Aucune erreur détectée.'
        }`;
      },
    }),
    defineTool({
      name: 'validate_project',
      description: 'Vérifie le projet (erreurs de script, références d\'assets manquantes, cartes invalides…).',
      schema: z.object({}),
      run: async () => {
        const diagnostics = await deps.projects.validate(projectId);
        return diagnostics.length
          ? diagnostics.map((d) => `- ${d.severity} ${d.file}${d.line ? `:${d.line}` : ''} — ${d.message}`).join('\n')
          : 'Aucun problème détecté.';
      },
    }),
    defineTool({
      name: 'list_generators',
      description: 'Liste les générateurs d\'assets et leurs paramètres (schéma JSON).',
      schema: z.object({}),
      run: () => describeGenerators(),
    }),
  ];

  if (deps.aiAvailable) {
    tools.push(
      defineTool({
        name: 'generate_asset',
        description:
          'Génère un asset (image SVG, pixel-art, charset RPG, tileset, effet sonore, musique, modèle 3D, animation 2D) ' +
          'et l\'ajoute au projet. Donne un `alias` court pour le référencer dans les scripts (ex. « bg plage », ' +
          '« mina joyeuse »). `parentId` + `instruction` retouchent un asset existant. Prend de quelques secondes à ' +
          'quelques minutes.',
        schema: z.object({
          generator: z.string().describe('Identifiant du générateur (voir list_generators)'),
          prompt: z.string().describe('Description détaillée de l\'asset voulu'),
          params: z.record(z.string(), z.unknown()).optional().describe('Paramètres spécifiques au générateur'),
          name: z.string().optional(),
          alias: z.string().optional(),
          tags: z.array(z.string()).optional(),
          parentId: z.string().optional(),
          instruction: z.string().optional(),
        }),
        run: async (input) => {
          const asset = await deps.generate({ ...input, params: input.params ?? {}, mode: 'ai' });
          return `Asset créé : ${describeAsset(asset)}`;
        },
      }),
    );
  }
  return tools;
}

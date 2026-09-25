import type { AssetRegistry, Diagnostic, ProjectFiles, TilesetInfo } from '@forge/core';
import type { z } from 'zod';
import {
  PLATFORMER_SYSTEM_PATH,
  PlatformerLevelSchema,
  PlatformerSystemSchema,
  levelPath,
  type PlatformerLevel,
  type PlatformerSystem,
} from '../schema';
import { loadPlatformTilesetInfo } from './textures';

/**
 * Chargement du projet plateformer pour le rendu (système + niveaux atteignables + métadonnées
 * de tileset). Contrepartie de `validatePlatformerProject` (`../validate.ts`), qui ne renvoie que
 * des diagnostics : ce module conserve les données chargées pour les servir à `../runtime.ts`.
 * Voir aussi `../loader.ts`, plus simple (système + niveaux), utilisé par le runtime sans affichage.
 */

export interface PlatformerProjectData {
  system: PlatformerSystem;
  /** Niveaux validés, indexés par identifiant (`system.levels`, plus `extraLevels`). */
  levels: Map<string, PlatformerLevel>;
  /** Métadonnées des tilesets par référence (disposition standard si absentes). */
  tilesets: Map<string, TilesetInfo>;
  /** Problèmes non bloquants (fichiers invalides, niveaux manquants…). */
  problems: Diagnostic[];
}

/** Erreur de chargement bloquante (système illisible), avec ses diagnostics. */
export class PlatformerLoadError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `${d.file} : ${d.message}`).join('\n') || 'Projet plateformer illisible');
    this.name = 'PlatformerLoadError';
  }
}

export interface PlatformerLoadOptions {
  /** Fichier système (entrée du manifeste). */
  entry?: string;
  /** Registre d'assets, pour lire les métadonnées de tileset (`extra.tiles`). */
  assets?: AssetRegistry;
  /** Niveaux supplémentaires à charger (ex. « jouer depuis ce niveau » si absent de `levels`). */
  extraLevels?: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readValidated<T>(
  files: ProjectFiles,
  path: string,
  schema: z.ZodType<T>,
  problems: Diagnostic[],
): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await files.readJson(path);
  } catch (error) {
    problems.push({ file: path, severity: 'error', message: `Lecture impossible : ${errorMessage(error)}` });
    return null;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    problems.push(
      ...result.error.issues.map((issue) => ({
        file: path,
        severity: 'error' as const,
        message: `Format invalide${issue.path.length ? ` (${issue.path.join('.')})` : ''} : ${issue.message}`,
      })),
    );
    return null;
  }
  return result.data;
}

/**
 * Charge le système et tous les niveaux qu'il référence (plus `extraLevels`). Un niveau absent ou
 * invalide est simplement omis (signalé dans `problems`) ; un système illisible lève
 * `PlatformerLoadError`.
 */
export async function loadPlatformerProject(
  files: ProjectFiles,
  options: PlatformerLoadOptions = {},
): Promise<PlatformerProjectData> {
  const problems: Diagnostic[] = [];
  const entry = options.entry ?? PLATFORMER_SYSTEM_PATH;
  const system = await readValidated(files, entry, PlatformerSystemSchema, problems);
  if (!system) throw new PlatformerLoadError(problems);

  const levels = new Map<string, PlatformerLevel>();
  const ids = new Set([...system.levels, ...(options.extraLevels ?? [])]);
  for (const id of ids) {
    const path = levelPath(id);
    if (!(await files.exists(path))) {
      problems.push({ file: entry, severity: 'error', message: `Niveau introuvable « ${id} » (${path}).` });
      continue;
    }
    const level = await readValidated(files, path, PlatformerLevelSchema, problems);
    if (level) levels.set(id, level);
  }

  const tilesets = new Map<string, TilesetInfo>();
  for (const level of levels.values()) {
    if (tilesets.has(level.tileset)) continue;
    tilesets.set(level.tileset, await loadPlatformTilesetInfo(files, level.tileset, options.assets, problems));
  }

  return { system, levels, tilesets, problems };
}

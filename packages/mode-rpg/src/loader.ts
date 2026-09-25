import type { AssetRegistry, Diagnostic, ProjectFiles, TilesetInfo } from '@forge/core';
import type { z } from 'zod';
import { DEFAULT_TILESET_INFO, normalizeTilesetInfo } from './passability';
import {
  RpgDatabaseSchema,
  RpgMapSchema,
  RpgSystemSchema,
  emptyDatabase,
  type RpgDatabase,
  type RpgMap,
  type RpgSystem,
} from './schema';
import { teleportTargets } from './walk';

export const SYSTEM_PATH = 'data/system.json';
export const DATABASE_PATH = 'data/database.json';

export function mapPath(id: string): string {
  return `maps/${id}.json`;
}

/** Données d'un projet RPG chargées et validées. */
export interface RpgProjectData {
  system: RpgSystem;
  database: RpgDatabase;
  /** Cartes atteignables depuis la carte de départ (téléportations). */
  maps: Map<string, RpgMap>;
  /** Métadonnées des tilesets par référence (disposition standard si absentes). */
  tilesets: Map<string, TilesetInfo>;
  /** Problèmes non bloquants (fichiers invalides, métadonnées manquantes…). */
  problems: Diagnostic[];
}

/** Erreur de chargement bloquante (système illisible), avec ses diagnostics. */
export class RpgLoadError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `${d.file} : ${d.message}`).join('\n') || 'Projet RPG illisible');
    this.name = 'RpgLoadError';
  }
}

export interface LoadOptions {
  /** Fichier système (entrée du manifeste). */
  entry?: string;
  /** Registre d'assets pour lire les métadonnées de tileset (`extra.tiles`). */
  assets?: AssetRegistry;
  /** Cartes supplémentaires à charger (ex. « jouer depuis ici »). */
  extraMaps?: string[];
}

/** Convertit les erreurs zod en diagnostics français. */
export function zodDiagnostics(file: string, error: z.ZodError): Diagnostic[] {
  return error.issues.map((issue) => ({
    file,
    severity: 'error' as const,
    message: `Format invalide${issue.path.length ? ` (${issue.path.join('.')})` : ''} : ${issue.message}`,
  }));
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
    problems.push(...zodDiagnostics(path, result.error));
    return null;
  }
  return result.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Charge le système, la base de données et toutes les cartes atteignables (parcours des
 * téléportations depuis la carte de départ). Les cartes introuvables sont simplement absentes
 * (la validation les signale) ; un système illisible lève `RpgLoadError`.
 */
export async function loadRpgProject(files: ProjectFiles, options: LoadOptions = {}): Promise<RpgProjectData> {
  const problems: Diagnostic[] = [];
  const entry = options.entry ?? SYSTEM_PATH;
  const system = await readValidated(files, entry, RpgSystemSchema, problems);
  if (!system) throw new RpgLoadError(problems);

  let database = emptyDatabase();
  if (await files.exists(DATABASE_PATH)) {
    database = (await readValidated(files, DATABASE_PATH, RpgDatabaseSchema, problems)) ?? database;
  } else {
    problems.push({
      file: DATABASE_PATH,
      severity: 'warning',
      message: 'Base de données absente : base vide utilisée.',
    });
  }

  const maps = new Map<string, RpgMap>();
  const queue = [system.startMap, ...(options.extraMaps ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const path = mapPath(id);
    if (!(await files.exists(path))) continue;
    const map = await readValidated(files, path, RpgMapSchema, problems);
    if (!map) continue;
    maps.set(id, map);
    queue.push(...teleportTargets(map));
  }

  const tilesets = new Map<string, TilesetInfo>();
  for (const map of maps.values()) {
    if (tilesets.has(map.tileset)) continue;
    tilesets.set(map.tileset, await loadTilesetInfo(files, map.tileset, options.assets, problems));
  }
  return { system, database, maps, tilesets, problems };
}

/** Métadonnées d'un tileset (`extra.tiles` de l'asset), disposition standard par défaut. */
export async function loadTilesetInfo(
  files: ProjectFiles,
  ref: string,
  assets: AssetRegistry | undefined,
  problems: Diagnostic[] = [],
): Promise<TilesetInfo> {
  const meta = assets?.resolve(ref, 'tileset');
  const tilesPath = meta?.extra.tiles;
  if (!tilesPath) return DEFAULT_TILESET_INFO;
  try {
    return normalizeTilesetInfo(await files.readJson(tilesPath));
  } catch (error) {
    problems.push({
      file: tilesPath,
      severity: 'warning',
      message: `Métadonnées du tileset « ${ref} » illisibles (disposition standard utilisée) : ` + errorMessage(error),
    });
    return DEFAULT_TILESET_INFO;
  }
}

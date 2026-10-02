import type { Diagnostic, ProjectBundle } from '@forge/core';
import type { z } from 'zod';
import {
  ItemsFileSchema,
  POINTCLICK_ITEMS_PATH,
  POINTCLICK_SYSTEM_PATH,
  PointClickSystemSchema,
  SceneSchema,
  scenePath,
  type Scene,
} from './schema';
import type { PointClickData } from './types';

export { POINTCLICK_SYSTEM_PATH };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Convertit les erreurs zod en diagnostics français (même formulation que mode-platformer/loader.ts). */
export function zodDiagnostics(file: string, error: z.ZodError): Diagnostic[] {
  return error.issues.map((issue) => ({
    file,
    severity: 'error' as const,
    message: `Format invalide${issue.path.length ? ` (${issue.path.join('.')})` : ''} : ${issue.message}`,
  }));
}

async function readValidated<T>(files: ProjectBundle['files'], path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await files.readJson(path);
  } catch (error) {
    throw new Error(`Lecture impossible de « ${path} » : ${errorMessage(error)}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = zodDiagnostics(path, result.error)
      .map((d) => d.message)
      .join(' ; ');
    throw new Error(`Fichier invalide « ${path} » : ${details}`);
  }
  return result.data;
}

/**
 * Charge et valide le système (`data/pointclick.json`), les objets (`data/items.json`, facultatif :
 * vide s'il est absent) puis chaque scène référencée (`scenes/<id>.json`). Lève une erreur claire
 * (française) si un fichier est illisible ou invalide.
 */
export async function loadPointClickProject(bundle: ProjectBundle): Promise<PointClickData> {
  const { files } = bundle;
  const system = await readValidated(files, bundle.manifest.entry || POINTCLICK_SYSTEM_PATH, PointClickSystemSchema);

  const items = (await files.exists(POINTCLICK_ITEMS_PATH))
    ? await readValidated(files, POINTCLICK_ITEMS_PATH, ItemsFileSchema)
    : ItemsFileSchema.parse({});

  const scenes = new Map<string, Scene>();
  for (const id of system.scenes) {
    const path = scenePath(id);
    if (!(await files.exists(path))) {
      throw new Error(`Scène introuvable : « ${path} » (référencée par « ${POINTCLICK_SYSTEM_PATH} »).`);
    }
    scenes.set(id, await readValidated(files, path, SceneSchema));
  }
  if (!scenes.has(system.startScene)) {
    throw new Error(`Scène de départ inconnue « ${system.startScene} » (absente de « scenes »).`);
  }
  return { system, items, scenes };
}

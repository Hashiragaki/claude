import type { Diagnostic, ProjectBundle } from '@forge/core';
import type { z } from 'zod';
import {
  PLATFORMER_SYSTEM_PATH,
  PlatformerLevelSchema,
  PlatformerSystemSchema,
  levelPath,
  type PlatformerLevel,
  type PlatformerSystem,
} from './schema';

export { PLATFORMER_SYSTEM_PATH };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Convertit les erreurs zod en diagnostics français (même formulation que mode-rpg/loader.ts). */
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
 * Charge et valide le système (`data/platformer.json`) puis chaque niveau qu'il référence
 * (`levels/<id>.json`). Lève une erreur claire (française) si le système ou un niveau est
 * illisible ou invalide — il n'y a pas de « mode dégradé » possible sans système valide.
 */
export async function loadPlatformerProject(
  bundle: ProjectBundle,
): Promise<{ system: PlatformerSystem; levels: Map<string, PlatformerLevel> }> {
  const { files } = bundle;
  const system = await readValidated(files, PLATFORMER_SYSTEM_PATH, PlatformerSystemSchema);

  const levels = new Map<string, PlatformerLevel>();
  for (const id of system.levels) {
    const path = levelPath(id);
    if (!(await files.exists(path))) {
      throw new Error(`Niveau introuvable : « ${path} » (référencé par « ${PLATFORMER_SYSTEM_PATH} »).`);
    }
    levels.set(id, await readValidated(files, path, PlatformerLevelSchema));
  }
  return { system, levels };
}

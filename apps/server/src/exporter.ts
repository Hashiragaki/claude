import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import type { ProjectStore } from './storage';

/** Fichiers de projet inutiles au jeu exporté. */
function excluded(rel: string): boolean {
  return (
    rel === 'planner.json' ||
    rel.startsWith('chat/') ||
    rel.startsWith('notes/') ||
    rel.endsWith('.spec.json') ||
    /\.source\.[a-z0-9]+$/.test(rel)
  );
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Construit un zip jouable hors de l'éditeur : le lecteur web (build `dist-player`) à la racine
 * et les fichiers du projet dans `project/`. Nécessite `pnpm build`.
 */
export async function exportProject(store: ProjectStore, projectId: string, playerDist: string): Promise<Uint8Array> {
  try {
    await fs.access(path.join(playerDist, 'index.html'));
  } catch {
    throw Object.assign(new Error("Le lecteur n'est pas construit : lancez `pnpm build` puis réessayez."), {
      statusCode: 409,
    });
  }
  const entries: Record<string, Uint8Array> = {};
  for (const rel of await listFiles(playerDist)) {
    entries[rel] = new Uint8Array(await fs.readFile(path.join(playerDist, rel)));
  }
  const projectDir = store.projectDir(projectId);
  for (const rel of await listFiles(projectDir)) {
    if (excluded(rel) || rel.endsWith('.tmp')) continue;
    entries[`project/${rel}`] = new Uint8Array(await fs.readFile(path.join(projectDir, rel)));
  }
  return zipSync(entries, { level: 6 });
}

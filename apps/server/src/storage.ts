import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  guessMime,
  normalizeProjectPath,
  parseManifest,
  type ProjectFiles,
  type ProjectManifest,
} from '@forge/core';

/** Exécute les tâches asynchrones une par une (évite les écritures concurrentes). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Écriture atomique : fichier temporaire puis renommage. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Composant aléatoire : deux écritures concurrentes sur le même fichier (même pid, même
  // milliseconde) ne doivent jamais partager le même fichier temporaire.
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
}

export class ConflictError extends Error {
  readonly statusCode = 409;
}

/** Fichiers internes d'un projet, gérés par le serveur (non modifiables par l'API fichiers). */
const INTERNAL = new Set(['project.json', 'planner.json', 'usage.jsonl', 'ai.json']);
const INTERNAL_DIRS = ['.forge/', 'chat/'];

export interface ProjectSummary {
  id: string;
  name: string;
  mode: string;
  description: string;
  updatedAt: string;
  assetCount: number;
}

/** Stockage des projets sur disque : un dossier par projet, `project.json` à la racine. */
export class ProjectStore {
  private readonly locks = new Map<string, Mutex>();

  constructor(readonly root: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  private lock(id: string): Mutex {
    let m = this.locks.get(id);
    if (!m) {
      m = new Mutex();
      this.locks.set(id, m);
    }
    return m;
  }

  projectDir(id: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new NotFoundError(`Projet introuvable : ${id}`);
    return path.join(this.root, id);
  }

  /** Chemin absolu d'un fichier de projet, en refusant toute sortie du dossier. */
  resolve(id: string, relative: string): string {
    const dir = this.projectDir(id);
    let normalized: string;
    try {
      normalized = normalizeProjectPath(relative);
    } catch (error) {
      throw new ForbiddenError(error instanceof Error ? error.message : String(error));
    }
    const full = path.resolve(dir, normalized);
    if (!full.startsWith(dir + path.sep)) throw new ForbiddenError(`Chemin interdit : ${relative}`);
    return full;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.projectDir(id), 'project.json'));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const out: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const m = await this.readManifest(entry.name);
        out.push({
          id: m.id,
          name: m.name,
          mode: m.mode,
          description: m.description,
          updatedAt: m.updatedAt,
          assetCount: m.assets.length,
        });
      } catch {
        // dossier sans projet valide : ignoré
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async readManifest(id: string): Promise<ProjectManifest> {
    const file = path.join(this.projectDir(id), 'project.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      throw new NotFoundError(`Projet introuvable : ${id}`);
    }
    return parseManifest(JSON.parse(raw));
  }

  /** Crée le manifeste d'un nouveau projet. Échoue sans rien écraser si l'id est déjà pris. */
  async createManifest(manifest: ProjectManifest): Promise<void> {
    const dir = this.projectDir(manifest.id);
    await fs.mkdir(dir, { recursive: true });
    try {
      // `wx` échoue atomiquement (EEXIST) si le fichier existe déjà : pas de lecture-puis-écriture
      // qui laisserait une fenêtre de course entre deux créations concurrentes du même id.
      await fs.writeFile(path.join(dir, 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ConflictError(`Un projet existe déjà avec l'identifiant : ${manifest.id}`);
      }
      throw error;
    }
  }

  /** Modifie le manifeste sous verrou (lecture → mutation → écriture). */
  updateManifest(id: string, mutate: (m: ProjectManifest) => void | Promise<void>): Promise<ProjectManifest> {
    return this.lock(id).run(async () => {
      const manifest = await this.readManifest(id);
      await mutate(manifest);
      manifest.updatedAt = new Date().toISOString();
      const validated = parseManifest(manifest);
      await writeFileAtomic(path.join(this.projectDir(id), 'project.json'), `${JSON.stringify(validated, null, 2)}\n`);
      return validated;
    });
  }

  async delete(id: string): Promise<void> {
    if (!(await this.exists(id))) throw new NotFoundError(`Projet introuvable : ${id}`);
    await fs.rm(this.projectDir(id), { recursive: true, force: true });
  }

  async readFile(id: string, relative: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(id, relative));
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      throw new NotFoundError(`Fichier introuvable : ${relative}`);
    }
  }

  async readText(id: string, relative: string): Promise<string> {
    return (await this.readFile(id, relative)).toString('utf8');
  }

  /** Écrit un fichier de projet. `internal` autorise l'écriture des fichiers gérés par le serveur. */
  async writeFile(id: string, relative: string, data: string | Uint8Array, internal = false): Promise<void> {
    const normalized = normalizeProjectPath(relative);
    if (!internal && isInternal(normalized)) throw new ForbiddenError(`Fichier protégé : ${relative}`);
    // Le projet doit exister : sinon une écriture tardive (job en cours au moment d'une
    // suppression, id erroné…) recréerait un dossier orphelin sans project.json.
    if (!(await this.exists(id))) throw new NotFoundError(`Projet introuvable : ${id}`);
    await writeFileAtomic(this.resolve(id, normalized), data);
  }

  async deleteFile(id: string, relative: string, internal = false): Promise<void> {
    const normalized = normalizeProjectPath(relative);
    if (!internal && isInternal(normalized)) throw new ForbiddenError(`Fichier protégé : ${relative}`);
    if (!(await this.exists(id))) throw new NotFoundError(`Projet introuvable : ${id}`);
    await fs.rm(this.resolve(id, normalized), { force: true });
  }

  /** Liste récursive des fichiers d'un projet (chemins relatifs, fichiers internes exclus). */
  async tree(id: string): Promise<{ path: string; size: number }[]> {
    const dir = this.projectDir(id);
    const out: { path: string; size: number }[] = [];
    const walk = async (current: string) => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        const rel = path.relative(dir, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (!INTERNAL_DIRS.some((d) => `${rel}/`.startsWith(d))) await walk(full);
        } else if (!entry.name.endsWith('.tmp') && !isInternal(rel)) {
          out.push({ path: rel, size: (await fs.stat(full)).size });
        }
      }
    };
    await walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Accès `ProjectFiles` côté serveur (validation par les modes). */
  files(id: string): ProjectFiles {
    const store = this;
    return {
      readText: (p) => store.readText(id, p),
      readJson: async <T>(p: string) => JSON.parse(await store.readText(id, p)) as T,
      readBinary: async (p) => new Uint8Array(await store.readFile(id, p)),
      url: (p) => `/api/projects/${id}/files/${normalizeProjectPath(p)}`,
      exists: async (p) => {
        try {
          await fs.access(store.resolve(id, p));
          return true;
        } catch {
          return false;
        }
      },
    };
  }
}

export function isInternal(normalized: string): boolean {
  return INTERNAL.has(normalized) || INTERNAL_DIRS.some((d) => normalized.startsWith(d));
}

export { guessMime };

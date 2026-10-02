import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Mutex, NotFoundError, isInternal, writeFileAtomic, type ProjectStore } from './storage';

/**
 * Historique d'un projet : instantanés (points de restauration) des fichiers TEXTE du projet.
 *
 * Stockage dans `.forge/history/` (dossier interne : absent de l'arborescence, de l'export et des outils de l'IA) :
 * - `blobs/<sha1>` : contenu des fichiers, adressé par hachage (dédoublonné) ;
 * - `journal.json` : liste chronologique d'instantanés. Chacun ne contient que les fichiers modifiés par rapport
 *   à l'état du précédent (`path -> hash`, ou `null` si le fichier a été supprimé). Le premier est complet.
 *
 * Choix : seuls les fichiers texte (.json, .vn, .md, .txt) sont suivis. Les assets binaires (dossier `assets/`,
 * images, sons, modèles) sont exclus : volumineux, régénérables, et déjà versionnés par le manifeste.
 * Les fichiers gérés par le serveur (project.json, planner.json, chat/…) sont aussi exclus.
 *
 * Un instantané est une photo de l'état à l'instant T : on en prend un AVANT chaque lot de modifications,
 * pour pouvoir y revenir.
 */

export type SnapshotSource = 'user' | 'ai' | 'autopilot' | 'restore' | 'manual';

export interface Snapshot {
  id: string;
  at: string;
  label: string;
  source: SnapshotSource;
  files: Record<string, string | null>;
}

export interface SnapshotSummary {
  id: string;
  at: string;
  label: string;
  source: SnapshotSource;
  /** Nombre de fichiers qui diffèrent de l'état actuel (donc modifiés par une restauration). */
  fileCount: number;
  /** Écart avec l'état actuel : `modified` (contenu différent), `removed` (absent aujourd'hui), `added` (nouveau). */
  files: { path: string; change: 'modified' | 'removed' | 'added' }[];
}

export const MAX_SNAPSHOTS = 200;
/** Fenêtre de regroupement des écritures manuelles de l'éditeur. */
export const USER_WINDOW_MS = 30_000;
/** Au-delà de ce délai sans écriture, un lot d'écritures de l'IA de même clé est considéré comme nouveau. */
const AI_BATCH_GAP_MS = 10 * 60_000;

const TEXT_EXT = /\.(json|vn|md|txt)$/i;

/** Vrai si le fichier est suivi par l'historique. */
export function isTracked(rel: string): boolean {
  return TEXT_EXT.test(rel) && !rel.startsWith('assets/') && !rel.endsWith('.tmp') && !isInternal(rel);
}

interface Journal {
  version: 1;
  snapshots: Snapshot[];
}

type State = Map<string, string>;

export interface HistoryOptions {
  max?: number;
  now?: () => number;
  /** Appelé pour chaque fichier modifié par une restauration (notification de l'éditeur). */
  onFileChanged?: (projectId: string, file: string, action: 'written' | 'deleted') => void;
}

export class ProjectHistory {
  private readonly locks = new Map<string, Mutex>();
  private readonly userWindow = new Map<string, number>();
  private readonly aiBatch = new Map<string, { key: string; at: number }>();
  private readonly max: number;
  private readonly now: () => number;

  constructor(
    private readonly store: ProjectStore,
    private readonly options: HistoryOptions = {},
  ) {
    this.max = options.max ?? MAX_SNAPSHOTS;
    this.now = options.now ?? Date.now;
  }

  private lock(id: string): Mutex {
    let m = this.locks.get(id);
    if (!m) {
      m = new Mutex();
      this.locks.set(id, m);
    }
    return m;
  }

  private dir(id: string): string {
    return path.join(this.store.projectDir(id), '.forge', 'history');
  }

  private async readJournal(id: string): Promise<Journal> {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.dir(id), 'journal.json'), 'utf8')) as Journal;
      if (data && Array.isArray(data.snapshots)) return data;
    } catch {
      // journal absent ou illisible : historique vide
    }
    return { version: 1, snapshots: [] };
  }

  private async writeJournal(id: string, journal: Journal): Promise<void> {
    await writeFileAtomic(path.join(this.dir(id), 'journal.json'), JSON.stringify(journal));
  }

  private static replay(snapshots: Snapshot[], upTo = snapshots.length - 1): State {
    const state: State = new Map();
    for (let i = 0; i <= upTo && i < snapshots.length; i++) {
      for (const [file, hash] of Object.entries(snapshots[i]!.files)) {
        if (hash === null) state.delete(file);
        else state.set(file, hash);
      }
    }
    return state;
  }

  /** Hache les fichiers texte actuels ; `store` = écrire les blobs manquants. */
  private async scan(id: string, store: boolean): Promise<State> {
    const state: State = new Map();
    for (const entry of await this.store.tree(id)) {
      if (!isTracked(entry.path)) continue;
      const data = await this.store.readFile(id, entry.path);
      const hash = createHash('sha1').update(data).digest('hex');
      state.set(entry.path, hash);
      if (store) {
        const blob = path.join(this.dir(id), 'blobs', hash);
        try {
          await fs.access(blob);
        } catch {
          await writeFileAtomic(blob, data);
        }
      }
    }
    return state;
  }

  private async capture(id: string, label: string, source: SnapshotSource, force: boolean): Promise<Snapshot | null> {
    const journal = await this.readJournal(id);
    const previous = ProjectHistory.replay(journal.snapshots);
    const current = await this.scan(id, true);
    const files: Record<string, string | null> = {};
    for (const [file, hash] of current) if (previous.get(file) !== hash) files[file] = hash;
    for (const file of previous.keys()) if (!current.has(file)) files[file] = null;
    if (!force && Object.keys(files).length === 0) return null;
    const snapshot: Snapshot = {
      id: `${this.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      at: new Date(this.now()).toISOString(),
      label: label.trim().slice(0, 200) || 'Sans titre',
      source,
      files,
    };
    journal.snapshots.push(snapshot);
    if (journal.snapshots.length > this.max) {
      const drop = journal.snapshots.length - this.max;
      // Le nouveau premier instantané devient complet (état cumulé), pour rester rejouable.
      const full = ProjectHistory.replay(journal.snapshots, drop);
      const kept = journal.snapshots.slice(drop);
      kept[0] = { ...kept[0]!, files: Object.fromEntries(full) };
      journal.snapshots = kept;
    }
    await this.writeJournal(id, journal);
    await this.collect(id, journal);
    return snapshot;
  }

  /** Ramasse-miettes : supprime les blobs que plus aucun instantané ne référence. */
  private async collect(id: string, journal: Journal): Promise<void> {
    const used = new Set<string>();
    for (const s of journal.snapshots) for (const h of Object.values(s.files)) if (h) used.add(h);
    let names: string[];
    try {
      names = await fs.readdir(path.join(this.dir(id), 'blobs'));
    } catch {
      return;
    }
    for (const name of names) {
      if (!used.has(name)) await fs.rm(path.join(this.dir(id), 'blobs', name), { force: true });
    }
  }

  /** Instantané manuel (toujours créé, même sans changement). */
  manual(id: string, label: string): Promise<Snapshot> {
    return this.lock(id).run(async () => (await this.capture(id, label || 'Point de sauvegarde', 'manual', true))!);
  }

  /** Instantané automatique ; renvoie `null` si rien n'a changé depuis le dernier. */
  auto(id: string, label: string, source: SnapshotSource): Promise<Snapshot | null> {
    return this.lock(id).run(() => this.capture(id, label, source, false));
  }

  /** À appeler avant une écriture manuelle de l'éditeur : un instantané par fenêtre de 30 s. */
  async noteUserWrite(id: string, file: string): Promise<void> {
    if (!isTracked(file)) return;
    const start = this.userWindow.get(id);
    if (start !== undefined && this.now() - start < USER_WINDOW_MS) return;
    this.userWindow.set(id, this.now());
    await this.auto(id, 'Modifications dans l’éditeur', 'user');
  }

  /** À appeler avant chaque écriture de l'IA : un instantané par lot (même clé `source + label`). */
  async beforeAiWrite(id: string, source: 'ai' | 'autopilot', label: string, file: string): Promise<void> {
    if (!isTracked(file)) return;
    const key = `${source}:${label}`;
    const last = this.aiBatch.get(id);
    if (last && last.key === key && this.now() - last.at < AI_BATCH_GAP_MS) {
      last.at = this.now();
      return;
    }
    this.aiBatch.set(id, { key, at: this.now() });
    await this.auto(id, label, source);
  }

  async list(id: string): Promise<SnapshotSummary[]> {
    return this.lock(id).run(async () => {
      const journal = await this.readJournal(id);
      const current = await this.scan(id, false);
      const state: State = new Map();
      const out: SnapshotSummary[] = [];
      for (const s of journal.snapshots) {
        for (const [file, hash] of Object.entries(s.files)) {
          if (hash === null) state.delete(file);
          else state.set(file, hash);
        }
        const files: SnapshotSummary['files'] = [];
        for (const [file, hash] of state) {
          const now = current.get(file);
          if (now === undefined) files.push({ path: file, change: 'removed' });
          else if (now !== hash) files.push({ path: file, change: 'modified' });
        }
        for (const file of current.keys()) if (!state.has(file)) files.push({ path: file, change: 'added' });
        files.sort((a, b) => a.path.localeCompare(b.path));
        out.push({ id: s.id, at: s.at, label: s.label, source: s.source, fileCount: files.length, files });
      }
      return out.reverse();
    });
  }

  private async find(id: string, snapId: string): Promise<{ journal: Journal; index: number }> {
    const journal = await this.readJournal(id);
    const index = journal.snapshots.findIndex((s) => s.id === snapId);
    if (index < 0) throw new NotFoundError(`Instantané introuvable : ${snapId}`);
    return { journal, index };
  }

  private async readBlob(id: string, hash: string): Promise<string> {
    return fs.readFile(path.join(this.dir(id), 'blobs', hash), 'utf8');
  }

  /** Texte d'un fichier dans l'instantané et dans l'état actuel (`null` si absent). */
  async fileDiff(
    id: string,
    snapId: string,
    file: string,
  ): Promise<{ path: string; snapshot: string | null; current: string | null }> {
    return this.lock(id).run(async () => {
      const { journal, index } = await this.find(id, snapId);
      const hash = ProjectHistory.replay(journal.snapshots, index).get(file);
      const snapshot = hash ? await this.readBlob(id, hash) : null;
      let current: string | null = null;
      if (isTracked(file)) {
        try {
          current = await this.store.readText(id, file);
        } catch {
          current = null;
        }
      }
      return { path: file, snapshot, current };
    });
  }

  /** Remet les fichiers texte dans leur état de l'instantané (après un instantané « Avant restauration »). */
  async restore(
    id: string,
    snapId: string,
  ): Promise<{ restored: string[]; deleted: string[]; before: Snapshot | null }> {
    return this.lock(id).run(async () => {
      const { journal, index } = await this.find(id, snapId);
      const target = ProjectHistory.replay(journal.snapshots, index);
      const label = journal.snapshots[index]!.label;
      const before = await this.capture(id, `Avant restauration de « ${label} »`, 'restore', false);
      const current = await this.scan(id, false);
      const restored: string[] = [];
      const deleted: string[] = [];
      for (const [file, hash] of target) {
        if (current.get(file) === hash) continue;
        await this.store.writeFile(id, file, await this.readBlob(id, hash));
        restored.push(file);
        this.options.onFileChanged?.(id, file, 'written');
      }
      for (const file of current.keys()) {
        if (target.has(file)) continue;
        await this.store.deleteFile(id, file);
        deleted.push(file);
        this.options.onFileChanged?.(id, file, 'deleted');
      }
      return { restored, deleted, before };
    });
  }
}

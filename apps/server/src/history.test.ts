import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_FORMAT, type ProjectManifest } from '@forge/core';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { exportProject } from './exporter';
import { MAX_SNAPSHOTS, ProjectHistory, USER_WINDOW_MS, isTracked, type HistoryOptions } from './history';
import { ProjectStore } from './storage';

let dir: string | null = null;

async function setup(options: HistoryOptions = {}) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'forge-history-test-'));
  const store = new ProjectStore(dir);
  await store.init();
  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    id: 'p',
    name: 'p',
    description: '',
    mode: 'vn',
    version: '0.1.0',
    locale: 'fr',
    locales: ['fr'],
    resolution: { width: 1280, height: 720 },
    pixelArt: false,
    entry: 'main.vn',
    createdAt: now,
    updatedAt: now,
    assets: [],
  };
  await store.createManifest(manifest);
  return { store, history: new ProjectHistory(store, options) };
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('historique du projet', () => {
  it('ne suit que les fichiers texte du projet', () => {
    expect(isTracked('scripts/main.vn')).toBe(true);
    expect(isTracked('data/a.json')).toBe(true);
    expect(isTracked('assets/images/x.json')).toBe(false);
    expect(isTracked('x.png')).toBe(false);
    expect(isTracked('project.json')).toBe(false);
    expect(isTracked('.forge/history/journal.json')).toBe(false);
  });

  it('crée un instantané manuel et dédoublonne les blobs', async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'bonjour');
    await store.writeFile('p', 'notes/b.md', 'bonjour');
    const first = await history.manual('p', 'Départ');
    expect(Object.keys(first.files).sort()).toEqual(['notes/a.md', 'notes/b.md']);
    expect(await readdir(path.join(dir!, 'p', '.forge', 'history', 'blobs'))).toHaveLength(1);
    // Rien n'a changé : un instantané manuel est tout de même créé, mais vide (diff).
    const second = await history.manual('p', 'Bis');
    expect(second.files).toEqual({});
    expect(await history.auto('p', 'auto', 'ai')).toBeNull();
  });

  it('ne stocke que le diff et signale les suppressions', async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'v1');
    await store.writeFile('p', 'notes/b.md', 'b');
    await history.manual('p', 'un');
    await store.writeFile('p', 'notes/a.md', 'v2');
    await store.deleteFile('p', 'notes/b.md');
    const snap = await history.manual('p', 'deux');
    expect(Object.keys(snap.files).sort()).toEqual(['notes/a.md', 'notes/b.md']);
    expect(snap.files['notes/b.md']).toBeNull();
  });

  it("liste les instantanés du plus récent au plus ancien avec l'écart actuel", async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'v1');
    const s1 = await history.manual('p', 'un');
    await store.writeFile('p', 'notes/a.md', 'v2');
    await store.writeFile('p', 'notes/c.md', 'neuf');
    await history.manual('p', 'deux');
    const list = await history.list('p');
    expect(list.map((s) => s.label)).toEqual(['deux', 'un']);
    expect(list[0]!.fileCount).toBe(0);
    expect(list[1]!.id).toBe(s1.id);
    expect(list[1]!.files).toEqual([
      { path: 'notes/a.md', change: 'modified' },
      { path: 'notes/c.md', change: 'added' },
    ]);
  });

  it("renvoie le texte d'un fichier dans l'instantané et dans l'état actuel", async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'ancien');
    const s1 = await history.manual('p', 'un');
    await store.writeFile('p', 'notes/a.md', 'nouveau');
    await history.manual('p', 'deux');
    expect(await history.fileDiff('p', s1.id, 'notes/a.md')).toEqual({
      path: 'notes/a.md',
      snapshot: 'ancien',
      current: 'nouveau',
    });
    expect((await history.fileDiff('p', s1.id, 'notes/zzz.md')).snapshot).toBeNull();
    await expect(history.fileDiff('p', 'inconnu', 'notes/a.md')).rejects.toThrow(/introuvable/);
  });

  it('restaure un état : réécrit, recrée, supprime, et crée « Avant restauration »', async () => {
    const changed: string[] = [];
    const { store, history } = await setup({ onFileChanged: (_p, f, a) => changed.push(`${a}:${f}`) });
    await store.writeFile('p', 'notes/a.md', 'v1');
    await store.writeFile('p', 'notes/b.md', 'b');
    const s1 = await history.manual('p', 'un');
    await store.writeFile('p', 'notes/a.md', 'v2');
    await store.deleteFile('p', 'notes/b.md');
    await store.writeFile('p', 'notes/c.md', 'extra');
    await store.writeFile('p', 'image.png', 'binaire');

    const result = await history.restore('p', s1.id);
    expect(result.restored.sort()).toEqual(['notes/a.md', 'notes/b.md']);
    expect(result.deleted).toEqual(['notes/c.md']);
    expect(await store.readText('p', 'notes/a.md')).toBe('v1');
    expect(await store.readText('p', 'notes/b.md')).toBe('b');
    await expect(store.readText('p', 'notes/c.md')).rejects.toThrow();
    expect(await store.readText('p', 'image.png')).toBe('binaire');
    expect(changed.sort()).toEqual(['deleted:notes/c.md', 'written:notes/a.md', 'written:notes/b.md']);

    const list = await history.list('p');
    expect(list[0]!.label).toContain('Avant restauration');
    expect(list[0]!.source).toBe('restore');
    // On peut annuler la restauration.
    await history.restore('p', list[0]!.id);
    expect(await store.readText('p', 'notes/a.md')).toBe('v2');
    expect(await store.readText('p', 'notes/c.md')).toBe('extra');
  });

  it("regroupe les écritures de l'éditeur par fenêtre de 30 s", async () => {
    let t = 1_000_000;
    const { store, history } = await setup({ now: () => t });
    await store.writeFile('p', 'notes/a.md', 'v1');
    await history.noteUserWrite('p', 'notes/a.md');
    await store.writeFile('p', 'notes/a.md', 'v2');
    t += 10_000;
    await history.noteUserWrite('p', 'notes/a.md');
    await store.writeFile('p', 'notes/a.md', 'v3');
    expect(await history.list('p')).toHaveLength(1);
    t += USER_WINDOW_MS;
    await history.noteUserWrite('p', 'notes/a.md');
    const list = await history.list('p');
    expect(list).toHaveLength(2);
    expect(list[0]!.label).toBe('Modifications dans l’éditeur');
    expect(list[0]!.source).toBe('user');
    // Un fichier binaire n'ouvre pas de fenêtre.
    t += USER_WINDOW_MS * 2;
    await history.noteUserWrite('p', 'x.png');
    expect(await history.list('p')).toHaveLength(2);
  });

  it("crée un instantané par lot d'écritures de l'IA", async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'v1');
    await history.beforeAiWrite('p', 'ai', 'Ajoute une scène', 'notes/a.md');
    await store.writeFile('p', 'notes/a.md', 'v2');
    await history.beforeAiWrite('p', 'ai', 'Ajoute une scène', 'notes/b.md');
    await store.writeFile('p', 'notes/b.md', 'b');
    await history.beforeAiWrite('p', 'autopilot', 'Tâche 1', 'notes/a.md');
    const list = await history.list('p');
    expect(list.map((s) => [s.source, s.label])).toEqual([
      ['autopilot', 'Tâche 1'],
      ['ai', 'Ajoute une scène'],
    ]);
  });

  it('applique la rétention et ramasse les blobs orphelins', async () => {
    const { store, history } = await setup({ max: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      await store.writeFile('p', 'notes/a.md', `v${i}`);
      ids.push((await history.manual('p', `s${i}`)).id);
    }
    const list = await history.list('p');
    expect(list.map((s) => s.label)).toEqual(['s4', 's3', 's2']);
    expect(await readdir(path.join(dir!, 'p', '.forge', 'history', 'blobs'))).toHaveLength(3);
    // Le plus ancien conservé reste restaurable (rejoué depuis un état complet).
    expect((await history.fileDiff('p', ids[2]!, 'notes/a.md')).snapshot).toBe('v2');
    expect(MAX_SNAPSHOTS).toBe(200);
  });

  it("garde le dossier .forge hors de l'arborescence et de l'export", async () => {
    const { store, history } = await setup();
    await store.writeFile('p', 'notes/a.md', 'v1');
    await store.writeFile('p', 'data/a.json', '{}');
    await history.manual('p', 'un');
    expect((await store.tree('p')).map((f) => f.path)).toEqual(['data/a.json', 'notes/a.md']);

    const player = path.join(dir!, 'player-dist');
    await mkdir(player, { recursive: true });
    await writeFile(path.join(player, 'index.html'), '<html></html>');
    const zip = unzipSync(await exportProject(store, 'p', player));
    expect(Object.keys(zip).some((f) => f.includes('.forge'))).toBe(false);
    expect(Object.keys(zip)).toContain('project/data/a.json');
  });
});

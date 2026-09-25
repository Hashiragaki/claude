import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_FORMAT, type ProjectManifest } from '@forge/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ProjectStore, writeFileAtomic } from './storage';

let dir: string | null = null;

async function makeStore(): Promise<ProjectStore> {
  dir = await mkdtemp(path.join(os.tmpdir(), 'forge-storage-test-'));
  const store = new ProjectStore(dir);
  await store.init();
  return store;
}

function manifestFor(id: string): ProjectManifest {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    id,
    name: id,
    description: '',
    mode: 'vn',
    version: '0.1.0',
    locale: 'fr',
    locales: ['fr', 'en'],
    resolution: { width: 1280, height: 720 },
    pixelArt: false,
    entry: 'main.vn',
    createdAt: now,
    updatedAt: now,
    assets: [],
  };
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('ProjectStore.writeFile / deleteFile', () => {
  it("refuse d'écrire dans un projet inexistant et ne crée aucun dossier orphelin", async () => {
    const store = await makeStore();

    await expect(store.writeFile('typo-ab12', 'notes/a.md', 'contenu')).rejects.toBeInstanceOf(NotFoundError);

    // Aucun dossier ne doit avoir été créé sous le dossier racine.
    const entries = await readdir(store.root);
    expect(entries).toEqual([]);
  });

  it("refuse d'écrire un fichier interne (appel serveur) dans un projet supprimé", async () => {
    const store = await makeStore();
    const manifest = manifestFor('demo-ab12');
    await store.createManifest(manifest);
    await store.delete('demo-ab12');

    // Un job d'écriture différée (ex. génération d'asset finissant après suppression) ne doit
    // pas recréer le dossier du projet, y compris pour une écriture « interne ».
    await expect(store.writeFile('demo-ab12', 'planner.json', '{}', true)).rejects.toBeInstanceOf(NotFoundError);

    const entries = await readdir(store.root);
    expect(entries).toEqual([]);
  });

  it("refuse de supprimer un fichier d'un projet inexistant", async () => {
    const store = await makeStore();
    await expect(store.deleteFile('typo-ab12', 'notes/a.md')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('autorise toujours les écritures dans un projet existant', async () => {
    const store = await makeStore();
    const manifest = manifestFor('demo-ab12');
    await store.createManifest(manifest);

    await store.writeFile('demo-ab12', 'notes/a.md', 'contenu');
    expect(await store.readText('demo-ab12', 'notes/a.md')).toBe('contenu');
  });
});

describe('writeFileAtomic', () => {
  it('utilise des noms de fichiers temporaires uniques pour des écritures concurrentes', async () => {
    const store = await makeStore();
    const target = path.join(store.root, 'concurrent.txt');

    // Fige Date.now() pour forcer une collision du nom temporaire tel qu'il était construit
    // avant le correctif (`${file}.${pid}.${Date.now()}.tmp`) : deux appels dans la même
    // milliseconde partageaient alors le même fichier temporaire.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      // Les deux écritures doivent réussir intégralement, sans qu'aucune ne se marche dessus.
      await Promise.all([writeFileAtomic(target, 'premier'), writeFileAtomic(target, 'second-contenu')]);
    } finally {
      now.mockRestore();
    }

    const content = await readFile(target, 'utf8');
    expect(['premier', 'second-contenu']).toContain(content);
  });

  it('ne laisse aucun fichier .tmp quand le renommage échoue', async () => {
    const store = await makeStore();
    // La cible est un dossier existant : le renommage vers ce chemin échoue (EISDIR/ENOTEMPTY).
    const targetDir = path.join(store.root, 'as-a-directory');
    await mkdir(targetDir);

    await expect(writeFileAtomic(targetDir, 'contenu')).rejects.toThrow();

    const entries = await readdir(store.root);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});

describe('ProjectStore.tree', () => {
  it('exclut project.json et planner.json (fichiers internes) du listing', async () => {
    const store = await makeStore();
    const manifest = manifestFor('demo-ab12');
    await store.createManifest(manifest);
    await store.writeFile('demo-ab12', 'planner.json', '{}', true);
    await store.writeFile('demo-ab12', 'notes/a.md', 'contenu');

    const files = (await store.tree('demo-ab12')).map((f) => f.path);
    expect(files).toContain('notes/a.md');
    expect(files).not.toContain('project.json');
    expect(files).not.toContain('planner.json');
  });
});

describe('ProjectStore.createManifest', () => {
  it("refuse d'écraser un projet existant (ConflictError) et laisse son manifeste intact", async () => {
    const store = await makeStore();
    const first = manifestFor('demo-abcd');
    await store.createManifest(first);
    await expect(store.createManifest({ ...manifestFor('demo-abcd'), name: 'Autre' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const raw = JSON.parse(await readFile(path.join(dir!, 'demo-abcd', 'project.json'), 'utf8')) as ProjectManifest;
    expect(raw.name).toBe('demo-abcd');
  });
});

describe('ProjectStore.list', () => {
  it('renvoie une liste vide si le dossier de données a disparu', async () => {
    const store = await makeStore();
    await rm(dir!, { recursive: true, force: true });
    await expect(store.list()).resolves.toEqual([]);
  });
});

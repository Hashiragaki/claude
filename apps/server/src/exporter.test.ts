import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_FORMAT, type ProjectManifest } from '@forge/core';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceWorker, buildWebManifest, exportProject } from './exporter';
import { ProjectStore } from './storage';

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ff7a3d"/></svg>';

describe('export web (PWA)', () => {
  it('ajoute manifeste, service worker et icônes au zip', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'forge-export-test-'));
    const store = new ProjectStore(path.join(dir, 'projects'));
    await store.init();
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      format: PROJECT_FORMAT,
      id: 'demo',
      name: 'Mon super jeu',
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
    const player = path.join(dir, 'player');
    await mkdir(player, { recursive: true });
    await writeFile(path.join(player, 'index.html'), '<html></html>');
    await writeFile(path.join(player, 'favicon.svg'), FAVICON);

    const files = unzipSync(await exportProject(store, 'demo', player));
    const text = (name: string) => new TextDecoder().decode(files[name]);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['index.html', 'project/project.json', 'manifest.webmanifest', 'sw.js']),
    );
    const web = JSON.parse(text('manifest.webmanifest')) as {
      name: string;
      display: string;
      orientation: string;
      icons: { src: string }[];
    };
    expect(web).toMatchObject({ name: 'Mon super jeu', display: 'fullscreen', orientation: 'landscape' });
    expect(web.icons.map((i) => i.src)).toContain('icons/icon-512.png');
    expect(files['icons/icon-192.png']?.length).toBeGreaterThan(0);
    expect(text('sw.js')).toContain('"project/project.json"');
    expect(text('sw.js')).not.toContain('"sw.js"');
  });

  it('génère un manifeste et un service worker valides', () => {
    expect(JSON.parse(buildWebManifest('Jeu', [])).short_name).toBe('Jeu');
    const sw = buildServiceWorker(['./', 'a.js'], 'v1');
    expect(sw).toContain("'forge-game-v1'");
    expect(sw).toContain('["./","a.js"]');
  });
});

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { rasterizeSvg } from './rasterize';
import type { ProjectStore } from './storage';

/** Fichiers de projet inutiles au jeu exporté. */
function excluded(rel: string): boolean {
  return (
    rel === 'planner.json' ||
    rel.startsWith('chat/') ||
    rel.startsWith('.forge/') ||
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

const ICON_SIZES = [192, 512];

/** Manifeste PWA : plein écran, paysage, icônes PNG (si disponibles) et SVG. */
export function buildWebManifest(name: string, icons: { src: string; sizes: string; type: string }[]): string {
  return `${JSON.stringify(
    {
      name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      start_url: './index.html',
      scope: './',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#000000',
      theme_color: '#000000',
      icons,
    },
    null,
    2,
  )}
`;
}

/** Service worker : met en cache les fichiers du jeu (cache d'abord) pour jouer hors-ligne. */
export function buildServiceWorker(files: string[], version: string): string {
  return `// Généré par Forge : cache hors-ligne du jeu.
const CACHE = 'forge-game-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(f).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('forge-game-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
`;
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

  const manifest = await store.readManifest(projectId);
  const icons: { src: string; sizes: string; type: string }[] = [];
  const favicon = entries['favicon.svg'];
  if (favicon) {
    const svg = new TextDecoder().decode(favicon);
    for (const size of ICON_SIZES) {
      try {
        entries[`icons/icon-${size}.png`] = await rasterizeSvg(svg, size, size);
        icons.push({ src: `icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' });
      } catch {
        // Icône PNG indisponible : le SVG suffit.
      }
    }
    icons.push({ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' });
  }
  entries['manifest.webmanifest'] = new TextEncoder().encode(buildWebManifest(manifest.name, icons));
  const cached = ['./', ...Object.keys(entries).filter((f) => f !== 'sw.js')];
  entries['sw.js'] = new TextEncoder().encode(buildServiceWorker(cached, manifest.updatedAt));
  return zipSync(entries, { level: 6 });
}

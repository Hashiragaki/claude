#!/usr/bin/env node
/**
 * Captures d'un jeu Forge dans Chromium, pour vérifier un runtime (Pixi/Three) sans l'éditeur.
 *
 *   node scripts/snap.mjs --template rpg-demo
 *   node scripts/snap.mjs --template vn-demo --steps "wait:1500,shot:titre,press:Enter,wait:800,shot:jeu"
 *
 * Étapes (séparées par des virgules) : `wait:<ms>`, `press:<Touche>`, `hold:<Touche>:<ms>`,
 * `click:<x>:<y>`, `shot:<nom>`. Touches : codes Playwright (Enter, ArrowRight, KeyZ, Space…).
 * Démarre un serveur Forge sans IA (données temporaires), crée le projet depuis le modèle (assets
 * procéduraux), sert le lecteur avec Vite (sources, sans build) et écrit dans le dossier de sortie :
 * les PNG et `report.json` (erreurs console et exceptions de la page). Code de sortie 1 si erreurs.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'apps/editor');

const opts = parseArgs(process.argv.slice(2));
const template = opts.template;
if (!template) {
  console.error('Usage : node scripts/snap.mjs --template <id> [--steps "..."] [--out dossier] [--size 960x540]');
  process.exit(2);
}
const steps = (opts.steps ?? 'wait:2000,shot:debut,press:Enter,wait:1200,shot:apres-entree,hold:ArrowRight:1200,shot:deplacement')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const outDir = path.resolve(opts.out ?? path.join(ROOT, 'test-results/snap', template));
const [width, height] = (opts.size ?? '960x540').split('x').map(Number);
const serverPort = Number(opts.port ?? 8790);
const vitePort = serverPort + 1;

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'forge-snap-'));
const children = [];
let viteServer;
let browser;
const report = { template, project: null, shots: [], errors: [], logs: [] };

try {
  mkdirSync(outDir, { recursive: true });
  const server = spawn('pnpm', ['--filter', '@forge/server', 'start'], {
    cwd: ROOT,
    env: { ...process.env, FORGE_DATA_DIR: dataDir, FORGE_AI: 'off', PORT: String(serverPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(server);
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const api = `http://127.0.0.1:${serverPort}`;
  await waitFor(async () => (await fetch(`${api}/api/health`)).ok, 60_000, () => `serveur : ${serverLog.slice(-2000)}`);

  const modes = await (await fetch(`${api}/api/modes`)).json();
  const mode = modes.find((m) => (m.templates ?? []).some((t) => t.id === template));
  if (!mode) throw new Error(`Modèle inconnu : ${template} (disponibles : ${modes.flatMap((m) => m.templates.map((t) => t.id)).join(', ')})`);
  const created = await fetch(`${api}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Snap ${template}`, mode: mode.id, template }),
  });
  if (!created.ok) throw new Error(`Création du projet : ${created.status} ${await created.text()}`);
  const project = await created.json();
  report.project = project.id;
  await waitFor(
    async () => {
      const jobs = await (await fetch(`${api}/api/projects/${project.id}/jobs`)).json();
      return jobs.every((j) => j.status !== 'queued' && j.status !== 'running');
    },
    180_000,
    () => 'génération des assets trop longue',
  );

  const requireFromEditor = createRequire(path.join(EDITOR, 'package.json'));
  const { createServer } = await import(requireFromEditor.resolve('vite'));
  viteServer = await createServer({
    configFile: path.join(EDITOR, 'vite.player.config.ts'),
    // Racine = apps/editor : player/index.html importe ../src/player/main.ts (hors de player/).
    root: EDITOR,
    logLevel: 'error',
    server: {
      port: vitePort,
      strictPort: true,
      proxy: {
        '/player/project/': {
          target: api,
          rewrite: (p) => p.replace(/^\/player\/project\//, `/api/projects/${project.id}/files/`),
        },
      },
    },
  });
  await viteServer.listen();

  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  const playwright = await import(requireFromRoot.resolve('@playwright/test'));
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const executablePath = process.env.FORGE_CHROMIUM ?? '/opt/pw-browsers/chromium';
  browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    // Les réponses HTTP en erreur sont déjà signalées avec leur URL (événement « response »).
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) report.errors.push(line);
    else if (report.logs.length < 200) report.logs.push(line);
  });
  page.on('pageerror', (err) => report.errors.push(`[exception] ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) report.errors.push(`[http ${res.status()}] ${res.url()}`);
  });
  await page.goto(`http://127.0.0.1:${vitePort}/player/index.html`, { waitUntil: 'load' });
  await page.locator('#game').click({ position: { x: 5, y: 5 } }).catch(() => undefined);

  for (const step of steps) {
    const [kind, a, b] = step.split(':');
    if (kind === 'wait') await page.waitForTimeout(Number(a));
    else if (kind === 'press') await page.keyboard.press(a);
    else if (kind === 'hold') {
      await page.keyboard.down(a);
      await page.waitForTimeout(Number(b ?? 500));
      await page.keyboard.up(a);
    } else if (kind === 'click') await page.mouse.click(Number(a), Number(b));
    else if (kind === 'shot') {
      const file = path.join(outDir, `${String(report.shots.length + 1).padStart(2, '0')}-${a ?? 'capture'}.png`);
      await page.screenshot({ path: file });
      report.shots.push(path.relative(ROOT, file));
    } else throw new Error(`Étape inconnue : ${step}`);
  }
  const visibleError = await page.locator('#error').textContent().catch(() => '');
  if (visibleError) report.errors.push(`[lecteur] ${visibleError}`);
} catch (error) {
  report.errors.push(`[snap] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  await viteServer?.close().catch(() => undefined);
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
}

writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.errors.length === 0, shots: report.shots, errors: report.errors.slice(0, 20) }, null, 2));
process.exit(report.errors.length === 0 ? 0 : 1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
  }
  return out;
}

async function waitFor(check, timeoutMs, describe) {
  const start = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // pas encore prêt
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Délai dépassé : ${describe()}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

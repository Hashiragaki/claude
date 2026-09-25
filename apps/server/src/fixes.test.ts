import { promises as fsPromises } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeLlmClient, textBlock, toolUseBlock, type BetaMessageParam, type LlmClient } from '@forge/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ForgeServer } from './app';
import { loadConfig } from './config';

/**
 * Tests de non-régression pour un lot de trouvailles de revue (voir la revue « later » de
 * apps/server, groupe server-core/server-api). Chaque test documente, dans son titre, la
 * trouvaille qu'il couvre.
 */

async function makeServer(llm: LlmClient | null): Promise<{ server: ForgeServer; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-fixes-test-'));
  const config = {
    ...loadConfig({}),
    dataDir: dir,
    playerDist: path.join(dir, 'no-player'),
    editorDist: path.join(dir, 'no-editor'),
  };
  const server = await createServer({ config, llm });
  return { server, dir };
}

describe('generation.ts — alias et parentId relus au moment de la sauvegarde', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ne vole pas l'alias qu'un déplacement concurrent (PATCH) vient d'assigner à un autre asset", async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'Alias race', mode: 'vn', template: 'vn-blank' });

    const parent = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'un parc',
      mode: 'procedural',
      alias: 'hero',
    });

    // Pendant que le job de variante tourne (entre la lecture du manifeste au début de `generate`
    // et son `updateManifest` final), l'utilisateur déplace l'alias vers un autre asset via
    // PATCH /assets/:id — exactement le scénario de la trouvaille.
    const originalWriteFile = server.store.writeFile.bind(server.store);
    let hooked = false;
    vi.spyOn(server.store, 'writeFile').mockImplementation(async (...args: Parameters<typeof originalWriteFile>) => {
      if (!hooked) {
        hooked = true;
        await server.store.updateManifest(project.id, (m) => {
          const p = m.assets.find((a) => a.id === parent.id);
          if (p) delete p.alias;
        });
        await server.generation.generate(project.id, {
          generator: 'image.pixel',
          prompt: 'un lac',
          mode: 'procedural',
          alias: 'hero',
        });
      }
      return originalWriteFile(...args);
    });

    const variant = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'un parc au coucher du soleil',
      mode: 'procedural',
      parentId: parent.id,
    });

    const manifest = await server.store.readManifest(project.id);
    const other = manifest.assets.find((a) => a.prompt === 'un lac');
    // L'alias déplacé par l'utilisateur pendant le job reste sur l'asset choisi…
    expect(other?.alias).toBe('hero');
    // …et le variant, dont le parent n'a plus d'alias au moment de la sauvegarde, n'en reçoit pas.
    expect(variant.alias).toBeUndefined();
  });

  it("ne garde pas de parentId vers un asset supprimé pendant la génération", async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'Parent deleted', mode: 'vn', template: 'vn-blank' });

    const parent = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'un parc',
      mode: 'procedural',
    });

    const originalWriteFile = server.store.writeFile.bind(server.store);
    let hooked = false;
    vi.spyOn(server.store, 'writeFile').mockImplementation(async (...args: Parameters<typeof originalWriteFile>) => {
      if (!hooked) {
        hooked = true;
        // Le parent est supprimé pendant le job (le nettoyage de parentId de la route DELETE a
        // déjà tourné à ce moment-là).
        await server.store.updateManifest(project.id, (m) => {
          m.assets = m.assets.filter((a) => a.id !== parent.id);
        });
      }
      return originalWriteFile(...args);
    });

    const variant = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'un parc au soir',
      mode: 'procedural',
      parentId: parent.id,
    });

    expect(variant.parentId).toBeUndefined();
  });
});

describe("chat.ts — les écritures du journal api.jsonl restent dans l'ordre d'émission", () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('un tool_result suit son tool_use (ligne suivante), avec des écritures disque lentes/aléatoires', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Ordre chat', mode: 'vn', template: 'vn-blank' });

    // Ajoute un délai aléatoire à chaque écriture réelle sur les journaux du chat : sans
    // sérialisation, plusieurs `fs.appendFile` concurrents (déclenchés sans être attendus par
    // `runAi`) peuvent alors s'entrelacer et atterrir sur le disque dans le désordre.
    const realAppendFile = fsPromises.appendFile;
    vi.spyOn(fsPromises, 'appendFile').mockImplementation(async (file: unknown, data: unknown) => {
      if (typeof file === 'string' && file.includes(`${path.sep}chat${path.sep}`)) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
      }
      return realAppendFile(file as string, data as string);
    });

    // `runAgent` s'arrête après `maxIterations` tours (16 par défaut) : on reste en dessous pour
    // que la boucle se termine par la réponse finale plutôt que par cette limite.
    const rounds = 10;
    for (let i = 0; i < rounds; i++) {
      llm.enqueue({ content: [textBlock(`Je consulte les tâches (${i}).`), toolUseBlock('list_tasks', {})] });
    }
    llm.enqueue({ content: [textBlock('Terminé.')] });

    await server.chat.send(project.id, 'Fais un point complet sur les tâches');

    const raw = await readFile(path.join(dir, project.id, 'chat', 'api.jsonl'), 'utf8');
    const lines = raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BetaMessageParam);
    // 40 tours [assistant(tool_use) + user(tool_result)] + 1 assistant final, plus le message
    // utilisateur initial.
    expect(lines.length).toBe(1 + rounds * 2 + 1);

    for (let i = 0; i < lines.length; i++) {
      const msg = lines[i] as BetaMessageParam;
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      const toolUseIds = msg.content.filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id);
      if (!toolUseIds.length) continue;
      // La ligne suivante doit être exactement le résultat de CES appels d'outils, pas un autre
      // message qui se serait glissé avant (résultat écrit avant sa question, ou inversement).
      const next = lines[i + 1] as BetaMessageParam | undefined;
      expect(next?.role).toBe('user');
      const resultIds = Array.isArray(next?.content)
        ? (next!.content as { tool_use_id?: string }[]).map((b) => b.tool_use_id).filter(Boolean)
        : [];
      expect([...resultIds].sort()).toEqual([...toolUseIds].sort());
    }
  });
});

describe('app.ts — DELETE /api/projects/:id', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('refuse (409) tant que le chat tourne, plutôt que de laisser un job recréer le dossier après coup', async () => {
    const llm = new FakeLlmClient();
    // Réponse jamais consommée : le chat reste "en cours" pendant tout le test (aucun `enqueue`).
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Suppression', mode: 'vn', template: 'vn-blank' });

    const controller = server.lock.acquire(project.id, 'chat');
    try {
      const res = await server.app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
      expect(res.statusCode).toBe(409);
      expect(await server.store.exists(project.id)).toBe(true);
    } finally {
      server.lock.release(project.id, controller);
    }
  });

  it('annule les jobs de génération en attente pour ne pas recréer le dossier après suppression', async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'Suppression jobs', mode: 'vn', template: 'vn-blank' });

    // Un job qui n'avance pas mais respecte le signal d'annulation (comme le fait
    // `generation.generate` à ses points de contrôle) : on l'enfile directement, sans l'attendre.
    const { job } = server.jobs.enqueue(
      project.id,
      'generate',
      'test',
      (_report, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Annulée')));
        }),
    );
    expect(server.jobs.get(job.id)?.status).toBe('running');

    const res = await server.app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
    expect(res.statusCode).toBe(200);
    expect(server.jobs.get(job.id)?.status).toBe('cancelled');
  });
});

describe('app.ts — PUT /api/projects/:id/files/* avec un corps JSON', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('resérialise un corps JSON primitif au lieu de tronquer le fichier ou de casser le JSON', async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'PUT JSON', mode: 'vn', template: 'vn-blank' });

    const cases: [unknown, string][] = [
      [42, '42'],
      [true, 'true'],
      [null, 'null'],
      ['hello', '"hello"'],
    ];
    for (const [body, expected] of cases) {
      const res = await server.app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/files/data/value.json`,
        payload: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const written = await server.store.readText(project.id, 'data/value.json');
      expect(written.trim()).toBe(expected);
      // Le fichier reste du JSON valide.
      expect(JSON.parse(written)).toEqual(JSON.parse(expected));
    }
  });

  it('écrit toujours un corps texte/octets tel quel (comportement inchangé pour les scripts)', async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'PUT texte', mode: 'vn', template: 'vn-blank' });

    const res = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/scripts/script.vn`,
      payload: 'scene bg parc\n',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(200);
    const written = await server.store.readText(project.id, 'scripts/script.vn');
    expect(written).toBe('scene bg parc\n');
  });
});

describe('app.ts — routes du planificateur : une requête invalide renvoie 400, jamais 500', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('POST /planner/milestones avec une échéance mal formée renvoie 400 (validée côté packages/planner)', async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'Planner validation', mode: 'vn', template: 'vn-blank' });

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/planner/milestones`,
      payload: { title: 'Démo', dueDate: '15/11/2026' },
    });
    expect(res.statusCode).toBe(400);

    // Le projet reste ouvrable après coup : planner.json n'a pas été corrompu par la requête
    // refusée.
    const getRes = await server.app.inject({ method: 'GET', url: `/api/projects/${project.id}/planner` });
    expect(getRes.statusCode).toBe(200);
  });

  it('GET /planner/schedule avec hoursPerDay=0 et skipWeekends répond (jamais 500, jamais de blocage)', async () => {
    ({ server, dir } = await makeServer(null));
    const project = await server.projects.create({ name: 'Schedule DoS', mode: 'vn', template: 'vn-blank' });
    await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/planner/tasks`,
      payload: { title: 'Une tâche', estimateHours: 4 },
    });

    const res = await server.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/planner/schedule?hoursPerDay=0&skipWeekends=true`,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('app.ts — arrêt propre du serveur avec un client SSE connecté', () => {
  it("app.close() se termine (forceCloseConnections) même si /events n'a jamais été fermé côté client", async () => {
    const { server, dir } = await makeServer(null);
    try {
      await server.app.listen({ port: 0, host: '127.0.0.1' });
      const address = server.app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const project = await server.projects.create({ name: 'SSE close', mode: 'vn', template: 'vn-blank' });

      const controller = new AbortController();
      const url = `http://127.0.0.1:${port}/api/projects/${project.id}/events`;
      const res = await fetch(url, { signal: controller.signal });
      expect(res.status).toBe(200);

      // Sans `forceCloseConnections`, `app.close()` attend que cette connexion SSE (jamais close par
      // le client, comme un EventSource oublié) se termine d'elle-même : elle ne se termine jamais.
      const timeout = new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('app.close() bloqué')), 3000),
      );
      await expect(Promise.race([server.app.close(), timeout])).resolves.toBeUndefined();
      controller.abort();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

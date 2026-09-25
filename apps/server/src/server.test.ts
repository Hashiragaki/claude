import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeLlmClient, textBlock, toolUseBlock, type LlmClient } from '@forge/ai';
import type { AssetMeta, ProjectManifest } from '@forge/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ForgeServer } from './app';
import { repairHistory } from './chat';
import { loadConfig } from './config';
import type { Job } from './jobs';

async function makeServer(llm: LlmClient | null): Promise<{ server: ForgeServer; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-test-'));
  const config = {
    ...loadConfig({}),
    dataDir: dir,
    playerDist: path.join(dir, 'no-player'),
    editorDist: path.join(dir, 'no-editor'),
  };
  const server = await createServer({ config, llm });
  return { server, dir };
}

async function waitFor<T>(fn: () => Promise<T | undefined> | T | undefined, timeoutMs = 20000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Délai dépassé');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('serveur Forge (hors-ligne)', () => {
  let server: ForgeServer;
  let dir: string;
  let project: ProjectManifest;

  beforeAll(async () => {
    ({ server, dir } = await makeServer(null));
  });

  afterAll(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("expose l'état, les modes et les générateurs", async () => {
    const health = (await server.app.inject('/api/health')).json();
    expect(health).toMatchObject({ ok: true, ai: { enabled: false } });
    const modes = (await server.app.inject('/api/modes')).json() as { id: string; templates: unknown[] }[];
    expect(modes.map((m) => m.id).sort()).toEqual(['platformer', 'rpg', 'sandbox3d', 'vn']);
    expect(modes.every((m) => m.templates.length >= 2)).toBe(true);
    const generators = (await server.app.inject('/api/generators')).json() as {
      id: string;
      params: { type: string };
    }[];
    expect(generators.map((g) => g.id)).toEqual(
      expect.arrayContaining(['image.svg', 'image.pixel', 'charset', 'tileset', 'anim2d', 'sfx', 'music', 'model3d']),
    );
    expect(generators.every((g) => g.params.type === 'object')).toBe(true);
  });

  it('crée un projet de démonstration avec ses assets et son planning', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Mon VN', mode: 'vn', template: 'vn-demo' },
    });
    expect(res.statusCode).toBe(200);
    project = res.json();
    expect(project.mode).toBe('vn');
    expect(project.assets.length).toBeGreaterThan(3);
    expect(project.assets.every((a) => a.origin === 'template')).toBe(true);
    const script = await server.app.inject(`/api/projects/${project.id}/files/${project.entry}`);
    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('label start');
    const planner = (await server.app.inject(`/api/projects/${project.id}/planner`)).json();
    expect(planner.data.tasks.length).toBeGreaterThan(3);
    const diagnostics = (await server.app.inject(`/api/projects/${project.id}/validate`)).json() as {
      severity: string;
    }[];
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const list = (await server.app.inject('/api/projects')).json() as { id: string }[];
    expect(list.map((p) => p.id)).toContain(project.id);
  }, 120000);

  it('protège les fichiers et interdit les sorties du dossier projet', async () => {
    const traversal = await server.app.inject(`/api/projects/${project.id}/files/..%2F..%2Fetc%2Fpasswd`);
    expect([403, 404]).toContain(traversal.statusCode);
    const protectedWrite = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/project.json`,
      payload: '{}',
      headers: { 'content-type': 'text/plain' },
    });
    expect(protectedWrite.statusCode).toBe(403);
    const write = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/notes/idees.md`,
      payload: 'Des idées',
      headers: { 'content-type': 'text/plain' },
    });
    expect(write.statusCode).toBe(200);
    expect((await server.app.inject(`/api/projects/${project.id}/files/notes/idees.md`)).body).toBe('Des idées');
  });

  it('génère un asset procédural via la file de jobs et gère les versions', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/generate`,
      payload: { generator: 'sfx', prompt: 'pièce', params: { preset: 'coin' }, alias: 'piece', seed: 7 },
    });
    expect(res.statusCode).toBe(202);
    const job = res.json() as Job;
    const done = await waitFor(() => {
      const j = server.jobs.get(job.id);
      return j && (j.status === 'done' || j.status === 'error') ? j : undefined;
    });
    expect(done.error).toBeUndefined();
    const asset = done.result as AssetMeta;
    expect(asset).toMatchObject({ kind: 'sfx', alias: 'piece', origin: 'procedural', version: 1 });
    const wav = await readFile(path.join(dir, project.id, asset.file));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');

    const variant = await server.generation.generate(project.id, {
      generator: 'sfx',
      parentId: asset.id,
      mode: 'procedural',
    });
    expect(variant).toMatchObject({ version: 2, alias: 'piece', parentId: asset.id });
    const manifest = await server.store.readManifest(project.id);
    expect(manifest.assets.find((a) => a.id === asset.id)?.alias).toBeUndefined();

    const edit = server.generation.generate(project.id, {
      generator: 'sfx',
      parentId: asset.id,
      instruction: 'plus aigu',
    });
    await expect(edit).rejects.toThrow(/IA/);
  }, 60000);

  it("gère le planning par l'API", async () => {
    const base = `/api/projects/${project.id}/planner`;
    const task = (
      await server.app.inject({
        method: 'POST',
        url: `${base}/tasks`,
        payload: { title: 'Tester le prologue', estimateHours: 2 },
      })
    ).json();
    expect(task.title).toBe('Tester le prologue');
    const moved = (
      await server.app.inject({
        method: 'POST',
        url: `${base}/tasks/${task.id}/move`,
        payload: { status: 'in_progress', index: 0 },
      })
    ).json();
    expect(moved.status).toBe('in_progress');
    const schedule = (await server.app.inject(`${base}/schedule?hoursPerDay=4`)).json();
    expect(schedule.items.length).toBeGreaterThan(0);
    const bad = await server.app.inject({
      method: 'PATCH',
      url: `${base}/tasks/${task.id}`,
      payload: { dependsOn: [task.id] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/elle-même/);
    await server.planners.flush(project.id);
    const saved = JSON.parse(await readFile(path.join(dir, project.id, 'planner.json'), 'utf8'));
    expect(saved.tasks.some((t: { title: string }) => t.title === 'Tester le prologue')).toBe(true);
  });

  it('répond aux commandes hors-ligne dans le chat', async () => {
    await server.chat.send(project.id, "/tache Écrire l'épilogue !haute ~3h");
    const history = await server.chat.history(project.id);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(history[1]?.text).toContain('Tâche créée');
    const planner = await server.planners.get(project.id);
    expect(planner.findTask("Écrire l'épilogue")?.priority).toBe('high');
  });

  it("refuse l'export tant que le lecteur n'est pas construit", async () => {
    const res = await server.app.inject(`/api/projects/${project.id}/export`);
    expect(res.statusCode).toBe(409);
  });

  it('crée des projets RPG et 3D valides', async () => {
    for (const [mode, template] of [
      ['rpg', 'rpg-demo'],
      ['sandbox3d', 'sandbox3d-demo'],
      ['platformer', 'platformer-demo'],
    ] as const) {
      const created = (
        await server.app.inject({
          method: 'POST',
          url: '/api/projects',
          payload: { name: `Test ${mode}`, mode, template },
        })
      ).json() as ProjectManifest;
      expect(created.assets.length).toBeGreaterThan(0);
      const diagnostics = (await server.app.inject(`/api/projects/${created.id}/validate`)).json() as {
        severity: string;
        message: string;
      }[];
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    }
  }, 180000);
});

describe('serveur Forge (assistant IA simulé)', () => {
  let server: ForgeServer;
  let dir: string;
  const llm = new FakeLlmClient();

  beforeAll(async () => {
    ({ server, dir } = await makeServer(llm));
  });

  afterAll(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("exécute les outils de l'assistant et persiste la conversation", async () => {
    const project = await server.projects.create({ name: 'Projet IA', mode: 'vn', template: 'vn-blank' });
    llm.enqueue({
      content: [
        textBlock('Je crée le jalon.'),
        toolUseBlock('create_milestone', { title: 'Démo jouable', dueDate: '2026-12-01' }),
        toolUseBlock('remember', { text: 'Ton doux et poétique.', tags: ['style'] }),
      ],
    });
    llm.enqueue({ content: [textBlock("C'est noté : jalon « Démo jouable » créé.")] });
    await server.chat.send(project.id, 'Crée un jalon pour la démo');

    const request = llm.requests[0]!;
    const userMessage = request.messages.at(-1)!;
    expect(JSON.stringify(userMessage.content)).toContain('<contexte>');
    expect(request.tools?.map((t) => (t as { name: string }).name)).toEqual(
      expect.arrayContaining(['create_task', 'generate_asset', 'write_file']),
    );

    const planner = await server.planners.get(project.id);
    expect(planner.listMilestones().map((m) => m.title)).toContain('Démo jouable');
    expect(planner.listMemory()[0]?.text).toBe('Ton doux et poétique.');

    const history = await server.chat.history(project.id);
    expect(history.filter((m) => m.role === 'tool').every((m) => m.tool?.ok)).toBe(true);
    expect(history.at(-1)?.text).toContain('Démo jouable');

    const api = (await readFile(path.join(dir, project.id, 'chat/api.jsonl'), 'utf8')).trim().split('\n');
    expect(api).toHaveLength(4); // utilisateur, assistant (outils), résultats, réponse finale
  });

  it("écrit un script via l'outil write_file et renvoie les diagnostics", async () => {
    const project = await server.projects.create({ name: 'Projet script', mode: 'vn', template: 'vn-blank' });
    llm.enqueue({
      content: [
        toolUseBlock('write_file', { path: 'scripts/script.vn', content: 'label start:\n    jump nulle_part\n' }),
      ],
    });
    llm.enqueue({ content: [textBlock('Il y a une erreur, je corrige.')] });
    await server.chat.send(project.id, 'Écris le script');
    const history = await server.chat.history(project.id);
    const tool = history.find((m) => m.role === 'tool');
    expect(tool?.tool?.result).toMatch(/nulle_part/);
  });

  it('joint le guide IA du mode plateformer au contexte du chat', async () => {
    const project = await server.projects.create({
      name: 'Projet plateformer',
      mode: 'platformer',
      template: 'platformer-empty',
    });
    llm.enqueue({ content: [textBlock('Bien reçu.')] });
    await server.chat.send(project.id, 'Décris le format des niveaux');

    const request = llm.requests.at(-1)!;
    const userMessage = request.messages.at(-1)!;
    expect(JSON.stringify(userMessage.content)).toContain('Mode plateformer');
  });

  it('répare un historique interrompu sans le réécrire', () => {
    const fixed = repairHistory([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_tasks', input: {} }] },
    ]);
    expect(fixed.appended).toHaveLength(1);
    expect(fixed.messages).toHaveLength(3);
  });
});

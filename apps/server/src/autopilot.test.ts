import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeLlmClient, textBlock, toolUseBlock, type LlmClient } from '@forge/ai';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ForgeServer } from './app';
import { loadConfig } from './config';

interface Fixture {
  server: ForgeServer;
  dir: string;
}

const created: Fixture[] = [];

async function makeServer(llm: LlmClient | null): Promise<Fixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-autopilot-'));
  const config = {
    ...loadConfig({}),
    dataDir: dir,
    playerDist: path.join(dir, 'no-player'),
    editorDist: path.join(dir, 'no-editor'),
  };
  const server = await createServer({ config, llm });
  const fixture = { server, dir };
  created.push(fixture);
  return fixture;
}

/** Serveur + projet vierge + client IA simulé, prêts pour un scénario de pilote automatique. */
async function setup() {
  const llm = new FakeLlmClient();
  const { server, dir } = await makeServer(llm);
  const project = await server.projects.create({ name: 'Projet pilote', mode: 'vn', template: 'vn-blank' });
  // Le mode vn amorce le planning avec des tâches de départ (dont certaines confiées à l'IA) :
  // on repart d'un planning vide pour garder les scénarios de test déterministes.
  const planner = await server.planners.get(project.id);
  for (const t of planner.listTasks()) planner.deleteTask(t.id);
  await server.planners.flush(project.id);
  return { server, dir, llm, project, planner };
}

afterEach(async () => {
  while (created.length) {
    const fixture = created.pop()!;
    await fixture.server.app.close();
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

describe('pilote automatique', () => {
  it("traite les tâches confiées à l'IA dans l'ordre du planning et ignore les tâches utilisateur", async () => {
    const { server, dir, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    const taskA = planner.createTask({ title: 'Générer le décor', assignee: 'ai' }, 'user');
    const taskB = planner.createTask({ title: 'Générer les sprites', assignee: 'ai', dependsOn: [taskA.id] }, 'user');
    const taskUser = planner.createTask({ title: 'Écrire le script', assignee: 'user' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'Décor généré.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });
    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'Sprites générés.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });

    const status = await server.autopilot.run(project.id, { maxTasks: 5 });

    expect(status.completed).toEqual([taskA.id, taskB.id]);
    expect(status.blocked).toEqual([]);
    expect(status.running).toBe(false);
    expect(status.lastError).toBeNull();
    expect(status.startedAt).not.toBeNull();
    expect(status.finishedAt).not.toBeNull();

    expect(planner.requireTask(taskA.id).status).toBe('done');
    expect(planner.requireTask(taskB.id).status).toBe('done');
    expect(planner.requireTask(taskA.id).log.some((l) => l.text.includes('Décor généré.'))).toBe(true);
    expect(planner.requireTask(taskB.id).log.some((l) => l.text.includes('Sprites générés.'))).toBe(true);
    // La tâche utilisateur n'est jamais touchée par le pilote automatique.
    expect(planner.requireTask(taskUser.id).status).toBe('todo');

    const history = await server.chat.history(project.id);
    const assistantTexts = history.filter((m) => m.role === 'assistant').map((m) => m.text);
    expect(assistantTexts.some((t) => t.includes('je commence « Générer le décor »'))).toBe(true);
    expect(assistantTexts.some((t) => t.includes('« Générer le décor » terminée.'))).toBe(true);

    // Journal de la conversation de la tâche, en ajout seul.
    const log = await readFile(path.join(dir, project.id, `chat/autopilot/${taskA.id}.jsonl`), 'utf8');
    expect(log.trim().split('\n').length).toBeGreaterThan(0);
  });

  it('report_blocked bloque la tâche et le pilote continue avec la suivante', async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    const taskA = planner.createTask({ title: 'Tâche impossible', assignee: 'ai' }, 'user');
    const taskB = planner.createTask({ title: 'Tâche possible', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [toolUseBlock('report_blocked', { reason: 'Information manquante.' })] });
    llm.enqueue({ content: [textBlock('Compris.')] });
    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'Fait.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });

    const status = await server.autopilot.run(project.id, { maxTasks: 5 });

    expect(status.blocked).toEqual([taskA.id]);
    expect(status.completed).toEqual([taskB.id]);
    expect(planner.requireTask(taskA.id).status).toBe('blocked');
    expect(planner.requireTask(taskA.id).log.some((l) => l.text.includes('Information manquante.'))).toBe(true);
    expect(planner.requireTask(taskB.id).status).toBe('done');
  });

  it('sans conclusion explicite du pilote, la tâche est marquée bloquée', async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    const task = planner.createTask({ title: 'Tâche ambiguë', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [textBlock('Je ne sais pas quoi faire.')] });

    const status = await server.autopilot.run(project.id, { maxTasks: 5 });

    expect(status.completed).toEqual([]);
    expect(status.blocked).toEqual([task.id]);
    const updated = planner.requireTask(task.id);
    expect(updated.status).toBe('blocked');
    expect(updated.log.some((l) => l.text.includes('Aucune conclusion du pilote automatique.'))).toBe(true);
  });

  it('maxTasks limite le nombre de tâches traitées en une exécution', async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    const taskA = planner.createTask({ title: 'Première tâche', assignee: 'ai' }, 'user');
    const taskB = planner.createTask({ title: 'Deuxième tâche', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'Fait.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });

    const status = await server.autopilot.run(project.id, { maxTasks: 1 });

    expect(status.completed).toEqual([taskA.id]);
    expect(status.blocked).toEqual([]);
    expect(planner.requireTask(taskB.id).status).toBe('todo');
  });

  it('exclusion mutuelle : chat.send pendant le pilote automatique renvoie 409', async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    planner.createTask({ title: 'Tâche IA', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'Fait.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });

    // `run` acquiert le verrou de façon synchrone avant de renvoyer sa promesse.
    const runPromise = server.autopilot.run(project.id, { maxTasks: 5 });
    await expect(server.chat.send(project.id, 'Bonjour')).rejects.toMatchObject({ statusCode: 409 });
    await runPromise;
  });

  it('exclusion mutuelle : autopilot.start pendant un chat en cours renvoie 409', async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    planner.createTask({ title: 'Tâche IA', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    llm.enqueue({ content: [textBlock('Bonjour, comment puis-je vous aider ?')] });

    // `send` acquiert le verrou de façon synchrone avant son premier `await`.
    const sendPromise = server.chat.send(project.id, 'Salut');
    expect(() => server.autopilot.start(project.id, { maxTasks: 1 })).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    );
    await sendPromise;
  });

  it("stop du pilote n'interrompt pas un chat en cours (le pilote ne détient pas le verrou)", async () => {
    const { server, llm, project } = await setup();
    llm.enqueue({ content: [textBlock('Bonjour !')] });

    const sendPromise = server.chat.send(project.id, 'Salut');
    const status = server.autopilot.stop(project.id);
    expect(status.running).toBe(false);
    await sendPromise;

    const history = JSON.stringify(await server.chat.history(project.id));
    expect(history).toContain('Bonjour !');
    expect(history).not.toContain('interrompue');
  });

  it("stop pendant l'exécution arrête le pilote avant la tâche suivante", async () => {
    const { server, llm, project } = await setup();
    const planner = await server.planners.get(project.id);
    const taskA = planner.createTask({ title: 'Tâche A', assignee: 'ai' }, 'user');
    const taskB = planner.createTask({ title: 'Tâche B', assignee: 'ai' }, 'user');
    await server.planners.flush(project.id);

    // Une seule réponse en file : si le pilote tentait la tâche B après l'arrêt, le
    // FakeLlmClient lèverait « plus de réponse préparée » et le test échouerait.
    llm.enqueue({ content: [toolUseBlock('complete_task', { summary: 'A faite.' })] });
    llm.enqueue({ content: [textBlock('Fait.')] });

    const unsubscribe = server.hub.onEvent((id, event) => {
      if (id !== project.id || event.type !== 'autopilot') return;
      const data = event.data as { completed: string[] };
      if (data.completed.includes(taskA.id)) server.autopilot.stop(project.id);
    });

    const status = await server.autopilot.run(project.id, { maxTasks: 5 });
    unsubscribe();

    expect(status.completed).toEqual([taskA.id]);
    expect(status.blocked).toEqual([]);
    expect(status.running).toBe(false);
    expect(planner.requireTask(taskB.id).status).toBe('todo');
  });

  it('sans IA configurée, la route HTTP de démarrage renvoie 400', async () => {
    const { server } = await makeServer(null);
    const project = await server.projects.create({ name: 'Sans IA', mode: 'vn', template: 'vn-blank' });

    const res = await server.app.inject({ method: 'POST', url: `/api/projects/${project.id}/autopilot/start` });
    expect(res.statusCode).toBe(400);
  });
});

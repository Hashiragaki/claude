import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeLlmClient, textBlock, toolUseBlock, type LlmClient } from '@forge/ai';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ForgeServer } from './app';
import { loadConfig } from './config';

/** Spec pixel-art minimale valide (8×8, palette à deux couleurs) pour les réponses simulées. */
const PIXEL_SPEC = {
  width: 8,
  height: 8,
  palette: { '.': 'transparent', o: '#1c1424' },
  rows: ['........', '.oooooo.', '.oooooo.', '.oooooo.', '.oooooo.', '.oooooo.', '.oooooo.', '........'],
};

async function makeServer(llm: LlmClient | null): Promise<{ server: ForgeServer; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-usage-test-'));
  const config = {
    ...loadConfig({}),
    dataDir: dir,
    playerDist: path.join(dir, 'no-player'),
    editorDist: path.join(dir, 'no-editor'),
  };
  const server = await createServer({ config, llm });
  return { server, dir };
}

/** `ledger.record` est appelé sans être attendu (`onUsage` est synchrone) : on patiente pour
 * l'écriture du fichier avant de lire les journaux. */
async function waitForLines(file: string, count: number, timeoutMs = 5000): Promise<string[]> {
  const start = Date.now();
  for (;;) {
    const lines = await readFile(file, 'utf8')
      .then((raw) => raw.split('\n').filter(Boolean))
      .catch(() => []);
    if (lines.length >= count) return lines;
    if (Date.now() - start > timeoutMs) throw new Error(`Délai dépassé en attendant ${count} lignes dans ${file}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('comptabilité des appels IA (UsageLedger)', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('journalise une génération et un message de chat, avec le routage par défaut', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Usage', mode: 'vn', template: 'vn-blank' });

    llm.enqueue({ content: [toolUseBlock('submit_result', PIXEL_SPEC)] });
    const asset = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une potion rouge',
      mode: 'ai',
      review: false,
    });
    expect(asset.origin).toBe('ai');
    // Routage par défaut : `generate` passe par `claude-sonnet-5`.
    expect(llm.requests[0]?.model).toBe('claude-sonnet-5');
    expect(typeof asset.info.costUsd).toBe('number');
    expect(asset.info.inputTokens).toBe(10);

    llm.enqueue({ content: [textBlock('Bonjour !')] });
    await server.chat.send(project.id, 'Salut');

    const usageFile = path.join(dir, project.id, 'usage.jsonl');
    const lines = await waitForLines(usageFile, 2);
    expect(lines).toHaveLength(2);
    const events = lines.map((l) => JSON.parse(l) as { meta: { role: string; projectId?: string } });
    expect(events.map((e) => e.meta.role).sort()).toEqual(['chat', 'generate']);
    expect(events.every((e) => e.meta.projectId === project.id)).toBe(true);

    // `usage.jsonl` et `ai.json` sont internes : absents de l'arborescence du projet.
    const tree = await server.store.tree(project.id);
    expect(tree.some((f) => f.path === 'usage.jsonl' || f.path === 'ai.json')).toBe(false);

    const summary = await server.app.inject({ method: 'GET', url: `/api/projects/${project.id}/usage` });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.calls).toBe(2);
    expect(body.budgetUsd).toBeNull();
    expect(body.spentUsd).toBeGreaterThan(0);
    expect(body.byRole.generate?.calls).toBe(1);
    expect(body.byRole.chat?.calls).toBe(1);
    expect(body.byModel['claude-sonnet-5']?.calls).toBe(1);
    expect(body.byModel['fake-model']?.calls).toBe(1);
    expect(body.cacheHitRate).toBe(0);
    expect(body.byDay).toHaveLength(1);
    expect(body.byDay[0].calls).toBe(2);
    expect(body.recent).toHaveLength(2);
    // Le plus récent en premier.
    expect(body.recent[0].meta.role).toBe('chat');
  });

  it('un budget déjà dépassé bascule la génération en procédural et refuse le chat (402)', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Budget', mode: 'vn', template: 'vn-blank' });

    llm.enqueue({ content: [toolUseBlock('submit_result', PIXEL_SPEC)] });
    await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une potion rouge',
      mode: 'ai',
      review: false,
    });
    await waitForLines(path.join(dir, project.id, 'usage.jsonl'), 1);

    const putRes = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/usage/budget`,
      payload: { budgetUsd: 0.0000001 },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().budgetUsd).toBe(0.0000001);

    const asset = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une autre potion',
      mode: 'ai',
      review: false,
    });
    expect(asset.origin).toBe('procedural');
    expect(asset.info.note).toBe('Budget IA atteint : génération procédurale');

    const chatRes = await server.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/chat`,
      payload: { message: 'Salut' },
    });
    expect(chatRes.statusCode).toBe(402);
    expect(chatRes.json().error).toMatch(/budget/i);
  });

  it("ne compte qu'une fois le premier appel d'un projet (cache froid)", async () => {
    const { server } = await makeServer(null);
    const project = await server.projects.create({ name: 'Budget', mode: 'vn', template: 'vn-blank' });
    const { UsageLedger } = await import('./usage');
    const { EventHub } = await import('./events');
    const hub = new EventHub();
    const published: number[] = [];
    hub.onEvent((_id, e) => {
      if (e.type === 'usage') published.push((e.data as { spentUsd: number }).spentUsd);
    });
    const ledger = new UsageLedger(server.store, hub, { defaultBudgetUsd: 0.0005 });
    const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const event = { meta: { role: 'generate' as const, projectId: project.id }, model: 'm', usage, at: '' };
    await ledger.record({ ...event, costUsd: 0.0003 });
    expect(published).toEqual([0.0003]);
    expect(() => ledger.checkBudget({ role: 'chat', projectId: project.id })).not.toThrow();
    await ledger.record({ ...event, costUsd: 0.0003 });
    expect(published[1]).toBeCloseTo(0.0006);
    expect(() => ledger.checkBudget({ role: 'chat', projectId: project.id })).toThrow();
  });
});

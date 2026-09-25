import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeLlmClient, textBlock, toolUseBlock, type LlmClient } from '@forge/ai';
import type { AssetMeta } from '@forge/core';
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-review-test-'));
  const config = { ...loadConfig({}), dataDir: dir, playerDist: path.join(dir, 'no-player'), editorDist: path.join(dir, 'no-editor') };
  const server = await createServer({ config, llm });
  return { server, dir };
}

describe('critique visuelle des assets générés', () => {
  let server: ForgeServer;
  let dir: string;

  afterEach(async () => {
    await server.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('montre le rendu à l\'IA, la laisse l\'accepter, et note les tours de critique', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Critique', mode: 'vn', template: 'vn-blank' });

    llm.enqueue({ content: [toolUseBlock('submit_result', PIXEL_SPEC)] });
    llm.enqueue({ content: [textBlock('OK')] });

    const asset = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une potion rouge',
      mode: 'ai',
    });

    expect(llm.requests).toHaveLength(2);
    // La 2e requête porte la critique : dernier message utilisateur = tool_result avec une image.
    const critiqueMessage = llm.requests[1]!.messages.at(-1)!;
    const critiqueContent = critiqueMessage.content as { type: string; content?: unknown }[];
    const toolResult = critiqueContent.find((b) => b.type === 'tool_result');
    expect(toolResult).toBeDefined();
    const blocks = toolResult!.content as { type: string }[];
    expect(blocks.some((b) => b.type === 'image')).toBe(true);

    expect(asset.info.reviewRounds).toBe(1);
  });

  it('n\'envoie qu\'une requête et ne note aucune critique quand review vaut false', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Sans critique', mode: 'vn', template: 'vn-blank' });

    llm.enqueue({ content: [toolUseBlock('submit_result', PIXEL_SPEC)] });

    const asset = await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une potion rouge',
      mode: 'ai',
      review: false,
    });

    expect(llm.requests).toHaveLength(1);
    expect(asset.info.reviewRounds).toBeUndefined();
  });

  it('n\'appelle jamais le modèle en mode procédural', async () => {
    const llm = new FakeLlmClient();
    ({ server, dir } = await makeServer(llm));
    const project = await server.projects.create({ name: 'Procédural', mode: 'vn', template: 'vn-blank' });

    const asset = (await server.generation.generate(project.id, {
      generator: 'image.pixel',
      prompt: 'une potion rouge',
      mode: 'procedural',
    })) as AssetMeta;

    expect(llm.requests).toHaveLength(0);
    expect(asset.origin).toBe('procedural');
    expect(asset.info.reviewRounds).toBeUndefined();
  });
});

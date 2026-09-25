import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, runAgent, type AgentEvent } from './agent';
import { FakeLlmClient, textBlock, toolUseBlock } from './fake';
import { AiRefusalError } from './llm';
import { toInputSchema } from './schema';
import { StructuredGenerationError, generateStructured } from './structured';

const Spec = z
  .object({
    width: z.number().int().min(1).max(64),
    rows: z.array(z.string()),
  })
  .superRefine((spec, ctx) => {
    if (spec.rows.length !== spec.width) {
      ctx.addIssue({ code: 'custom', message: `rows doit contenir ${spec.width} lignes`, path: ['rows'] });
    }
  });

describe('toInputSchema', () => {
  it('produit un schéma objet sans $schema', () => {
    const schema = toInputSchema(Spec);
    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('$schema');
  });

  it('refuse un schéma non objet', () => {
    expect(() => toInputSchema(z.string())).toThrow();
  });
});

describe('generateStructured', () => {
  it('renvoie la valeur validée au premier essai', async () => {
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { width: 2, rows: ['ab', 'cd'] })] }]);
    const result = await generateStructured({ llm, system: 'sys', prompt: 'fais un sprite', schema: Spec });
    expect(result.value).toEqual({ width: 2, rows: ['ab', 'cd'] });
    expect(result.attempts).toBe(1);
    expect(llm.requests[0]?.tools?.[0]).toMatchObject({ name: 'submit_result' });
  });

  it('renvoie les erreurs de validation au modèle puis accepte la correction', async () => {
    const llm = new FakeLlmClient([
      { content: [textBlock('Voici'), toolUseBlock('submit_result', { width: 2, rows: ['ab'] }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { width: 2, rows: ['ab', 'cd'] }, 'toolu_2')] },
    ]);
    const attempts: (string | undefined)[] = [];
    const result = await generateStructured({
      llm,
      system: 'sys',
      prompt: 'p',
      schema: Spec,
      onAttempt: (_n, err) => attempts.push(err),
    });
    expect(result.attempts).toBe(2);
    expect(attempts[1]).toMatch(/rows doit contenir 2 lignes/);
    const second = llm.requests[1]!;
    const last = second.messages[second.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(JSON.stringify(last.content)).toContain('toolu_1');
    expect(JSON.stringify(last.content)).toContain('is_error');
  });

  it('relance si le modèle oublie l\'outil, puis échoue après le maximum d\'essais', async () => {
    const llm = new FakeLlmClient([
      { content: [textBlock('Je réfléchis…')] },
      { content: [textBlock('Toujours rien')] },
    ]);
    await expect(
      generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(StructuredGenerationError);
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toContain('submit_result');
  });

  it('signale les refus', async () => {
    const llm = new FakeLlmClient([{ content: [], stop_reason: 'refusal' }]);
    await expect(generateStructured({ llm, system: 's', prompt: 'p', schema: Spec })).rejects.toBeInstanceOf(
      AiRefusalError,
    );
  });
});

describe('runAgent', () => {
  it('exécute les outils, renvoie les résultats et termine', async () => {
    const created: string[] = [];
    const createTask = defineTool({
      name: 'create_task',
      description: 'Crée une tâche',
      schema: z.object({ title: z.string().min(1) }),
      run: ({ title }) => {
        created.push(title);
        return { id: `t${created.length}`, title };
      },
    });
    const llm = new FakeLlmClient([
      {
        content: [
          textBlock('Je crée les tâches.'),
          toolUseBlock('create_task', { title: 'Écrire le chapitre 1' }),
          toolUseBlock('create_task', { title: '' }),
          toolUseBlock('inconnu', {}),
        ],
      },
      { content: [textBlock('C\'est fait !')] },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      llm,
      system: 'Tu es un planificateur.',
      messages: [{ role: 'user', content: 'Planifie' }],
      tools: [createTask],
      onEvent: (e) => events.push(e),
    });
    expect(created).toEqual(['Écrire le chapitre 1']);
    expect(result.text).toBe('C\'est fait !');
    expect(result.added).toHaveLength(3);
    const toolResults = result.added[1]!.content as { is_error?: boolean }[];
    expect(toolResults).toHaveLength(3);
    expect(toolResults.map((r) => Boolean(r.is_error))).toEqual([false, true, true]);
    expect(events.filter((e) => e.type === 'tool_end')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'C\'est fait !' });
    // L'historique envoyé au second appel contient les résultats d'outils (ajout uniquement).
    expect(llm.requests[1]!.messages).toHaveLength(3);
  });

  it('s\'arrête au nombre maximal d\'itérations', async () => {
    const loop = defineTool({ name: 'ping', description: 'ping', schema: z.object({}), run: () => 'pong' });
    const llm = new FakeLlmClient(Array.from({ length: 5 }, () => ({ content: [toolUseBlock('ping', {})] })));
    const result = await runAgent({ llm, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [loop], maxIterations: 3 });
    expect(llm.requests).toHaveLength(3);
    expect(result.stopReason).toBe('tool_use');
  });
});

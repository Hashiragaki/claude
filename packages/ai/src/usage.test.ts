import { APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, runAgent } from './agent';
import { FakeLlmClient, textBlock, toolUseBlock } from './fake';
import type { LlmCallMeta } from './llm';
import { generateStructured, isStrictCompatible } from './structured';

const Spec = z.object({ color: z.enum(['red', 'green', 'blue']) });

describe('generateStructured : comptabilité et routage', () => {
  it('cumule les jetons (y compris le cache) sur tous les essais', async () => {
    const llm = new FakeLlmClient([
      {
        content: [toolUseBlock('submit_result', { color: 'nope' }, 'toolu_1')],
        usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
      },
      {
        content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_2')],
        usage: { cache_creation_input_tokens: 4 },
      },
    ]);
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.usage).toEqual({
      inputTokens: 7 + 10,
      outputTokens: 3 + 20,
      cacheReadTokens: 2 + 0,
      cacheWriteTokens: 0 + 4,
    });
    // Compatibilité : `inputTokens`/`outputTokens` restent des champs directs de `usage`.
    expect(result.usage.inputTokens).toBe(17);
    expect(result.usage.outputTokens).toBe(23);
    expect(result.escalated).toBe(false);
  });

  it('transmet `meta` à chaque requête', async () => {
    const meta: LlmCallMeta = { role: 'generate', projectId: 'p1', label: 'sprite' };
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'nope' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_2')] },
    ]);
    await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, meta });
    expect(llm.requests).toHaveLength(2);
    for (const req of llm.requests) expect(req.meta).toEqual(meta);
  });

  it('escalade après épuisement des essais (sans valeur valide) : model/effort escaladés, escalated=true', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'nope1' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'nope2' }, 'toolu_2')] },
      { content: [toolUseBlock('submit_result', { color: 'blue' }, 'toolu_3')] },
    ]);
    const attempts: (string | undefined)[] = [];
    const result = await generateStructured({
      llm,
      system: 's',
      prompt: 'p',
      schema: Spec,
      maxAttempts: 2,
      escalate: { model: 'claude-opus-5', effort: 'high' },
      onAttempt: (_n, err) => attempts.push(err),
    });

    expect(result.value).toEqual({ color: 'blue' });
    expect(result.escalated).toBe(true);
    expect(result.attempts).toBe(3);
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[2]?.model).toBe('claude-opus-5');
    expect(llm.requests[2]?.effort).toBe('high');
    // Le message d'erreur de validation du dernier essai reste le dernier tool_result envoyé
    // avant le tour d'escalade.
    const beforeEscalate = llm.requests[2]!.messages.at(-1)!;
    expect(beforeEscalate.role).toBe('user');
    expect(JSON.stringify(beforeEscalate.content)).toContain('is_error');
    // onAttempt est aussi appelé pour le tour d'escalade (3e essai).
    expect(attempts).toHaveLength(3);
  });

  it('échoue normalement (sans escalade) quand `escalate` n\'est pas fourni', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'nope1' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'nope2' }, 'toolu_2')] },
    ]);
    await expect(
      generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, maxAttempts: 2 }),
    ).rejects.toMatchObject({ name: 'StructuredGenerationError' });
    expect(llm.requests).toHaveLength(2);
  });

  it('isStrictCompatible : true pour un schéma objet simple sans additionalProperties', () => {
    const Simple = z.object({ width: z.number().int(), name: z.string() });
    expect(isStrictCompatible(z.toJSONSchema(Simple, { io: 'input' }))).toBe(true);
  });

  it('isStrictCompatible : false avec un objet aux propriétés additionnelles libres', () => {
    const Loose = z.record(z.string(), z.number());
    expect(isStrictCompatible(z.toJSONSchema(Loose, { io: 'input' }))).toBe(false);
  });

  it('pose `strict: true` sur l\'outil quand le schéma est compatible', async () => {
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] }]);
    await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec });
    const tool = llm.requests[0]!.tools![0] as { strict?: boolean; input_schema: { additionalProperties?: boolean } };
    expect(tool.strict).toBe(true);
    expect(tool.input_schema.additionalProperties).toBe(false);
  });

  it('n\'ajoute pas `strict` quand le schéma n\'est pas compatible', async () => {
    const Loose = z.object({ extra: z.record(z.string(), z.number()) });
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { extra: {} }, 'toolu_1')] }]);
    await generateStructured({ llm, system: 's', prompt: 'p', schema: Loose });
    const tool = llm.requests[0]!.tools![0] as { strict?: boolean };
    expect(tool.strict).toBeUndefined();
  });

  it('n\'ajoute pas `strict` quand `strict: false` est demandé explicitement', async () => {
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] }]);
    await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, strict: false });
    const tool = llm.requests[0]!.tools![0] as { strict?: boolean };
    expect(tool.strict).toBeUndefined();
  });

  it('relance sans `strict` après une erreur 400 mentionnant le schéma strict', async () => {
    const strictRejected = new APIError(
      400,
      { message: 'Le schéma strict n\'est pas pris en charge pour cet outil.' },
      undefined,
      new Headers(),
    );
    const llm = new FakeLlmClient([
      () => {
        throw strictRejected;
      },
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
    ]);
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.attempts).toBe(1);
    expect(llm.requests).toHaveLength(2);
    const firstTool = llm.requests[0]!.tools![0] as { strict?: boolean };
    const secondTool = llm.requests[1]!.tools![0] as { strict?: boolean };
    expect(firstTool.strict).toBe(true);
    expect(secondTool.strict).toBeUndefined();
  });
});

describe('runAgent : comptabilité et routage', () => {
  it('transmet `meta` et cumule l\'usage', async () => {
    const meta: LlmCallMeta = { role: 'autopilot', projectId: 'p1' };
    const ping = defineTool({ name: 'ping', description: 'ping', schema: z.object({}), run: () => 'pong' });
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('ping', {})], usage: { input_tokens: 5, output_tokens: 5 } },
      { content: [textBlock('fini')], usage: { input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 3 } },
    ]);
    const result = await runAgent({
      llm,
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: [ping],
      meta,
    });

    expect(result.text).toBe('fini');
    expect(result.usage).toEqual({
      inputTokens: 5 + 8,
      outputTokens: 5 + 2,
      cacheReadTokens: 0 + 3,
      cacheWriteTokens: 0,
    });
    for (const req of llm.requests) expect(req.meta).toEqual(meta);
  });
});

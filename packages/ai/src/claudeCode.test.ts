import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgent, defineTool } from './agent';
import {
  ClaudeCodeError,
  ClaudeCodeLlmClient,
  buildSystemPrompt,
  claudeCodeModel,
  flattenConversation,
  parseToolCalls,
  type ClaudeCodeRunner,
} from './claudeCode';
import { describeApiError, isApiError } from './llm';
import { generateStructured } from './structured';

/** Faux `claude -p` : renvoie les textes donnés, un par appel, au format stream-json. */
function fakeRunner(outputs: (string | { error: string })[]) {
  const calls: { args: string[]; stdin: any }[] = [];
  const run: ClaudeCodeRunner = async (args, stdin, onLine) => {
    calls.push({ args, stdin: JSON.parse(stdin) });
    const next = outputs.shift();
    if (next === undefined) throw new Error('plus de sortie préparée');
    if (typeof next === 'object') {
      onLine(JSON.stringify({ type: 'result', is_error: true, result: next.error }));
      return { code: 1, stderr: '' };
    }
    for (const chunk of next.match(/.{1,7}/gs) ?? []) {
      onLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } },
        }),
      );
    }
    onLine(
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: next,
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 },
      }),
    );
    return { code: 0, stderr: '' };
  };
  return { run, calls };
}

describe('claudeCode', () => {
  it('convertit les identifiants de modèle en alias', () => {
    expect(claudeCodeModel('claude-opus-5')).toBe('opus');
    expect(claudeCodeModel('claude-sonnet-5')).toBe('sonnet');
    expect(claudeCodeModel('claude-haiku-4-5')).toBe('haiku');
    expect(claudeCodeModel('claude-fable-5-1')).toBe('claude-fable-5-1');
  });

  it('décrit les outils dans le prompt système', () => {
    const system = buildSystemPrompt({
      system: 'Tu es Forge.',
      messages: [],
      tools: [{ name: 'add_task', description: 'Ajoute une tâche', input_schema: { type: 'object' } } as any],
    });
    expect(system).toContain('Tu es Forge.');
    expect(system).toContain('<tool_calls>');
    expect(system).toContain('### add_task');
  });

  it('aplatit appels, résultats et images', () => {
    const blocks = flattenConversation([
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'render', input: { a: 1 } }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: 'Voici le rendu' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            ],
          },
        ],
      },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Bonjour');
    expect(text).toContain('[{"name":"render","input":{"a":1}}]');
    expect(text).toContain('<tool_result name="render">');
  });

  it('extrait les appels d’outils (tableau, objet, bloc de code)', () => {
    expect(parseToolCalls('Salut')).toEqual({ text: 'Salut', calls: [] });
    expect(parseToolCalls('Je note.\n<tool_calls>\n[{"name":"a","input":{"x":1}}]\n</tool_calls>')).toEqual({
      text: 'Je note.',
      calls: [{ name: 'a', input: { x: 1 } }],
    });
    expect(parseToolCalls('<tool_calls>```json\n{"name":"b"}\n```').calls).toEqual([{ name: 'b', input: {} }]);
    expect(() => parseToolCalls('<tool_calls>[{oups}]</tool_calls>')).toThrow(/JSON illisible/);
  });

  it('renvoie un message au format de l’API, sans diffuser le bloc d’outils', async () => {
    const { run, calls } = fakeRunner(['Je crée la tâche.\n<tool_calls>[{"name":"add","input":{}}]</tool_calls>']);
    const llm = new ClaudeCodeLlmClient({ run, model: 'claude-sonnet-5', effort: 'low' });
    let streamed = '';
    const message = await llm.send(
      { system: 'S', messages: [{ role: 'user', content: 'go' }] },
      { onText: (d) => (streamed += d) },
    );
    expect(streamed).toBe('Je crée la tâche.\n');
    expect(message.stop_reason).toBe('tool_use');
    expect(message.content.map((b) => b.type)).toEqual(['text', 'tool_use']);
    expect(message.usage.input_tokens).toBe(100);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--model', 'sonnet', '--effort', 'low', '--tools', '']));
    expect(calls[0]!.stdin.type).toBe('user');
  });

  it('fait tourner la boucle d’agent avec des outils émulés', async () => {
    const { run } = fakeRunner(['<tool_calls>[{"name":"double","input":{"n":21}}]</tool_calls>', 'Résultat : 42']);
    const llm = new ClaudeCodeLlmClient({ run });
    const double = defineTool({
      name: 'double',
      description: 'Double un nombre',
      schema: z.object({ n: z.number() }),
      run: ({ n }) => ({ value: n * 2 }),
    });
    const result = await runAgent({
      llm,
      system: 'S',
      messages: [{ role: 'user', content: '21 × 2 ?' }],
      tools: [double],
    });
    expect(result.text).toBe('Résultat : 42');
    expect(result.usage.inputTokens).toBe(200);
  });

  it('fait fonctionner la génération structurée', async () => {
    const { run } = fakeRunner(['<tool_calls>[{"name":"submit_result","input":{"color":"rouge"}}]</tool_calls>']);
    const result = await generateStructured({
      llm: new ClaudeCodeLlmClient({ run }),
      system: 'S',
      prompt: 'Une couleur',
      schema: z.object({ color: z.string() }),
    });
    expect(result.value).toEqual({ color: 'rouge' });
  });

  it('traduit les erreurs de Claude Code en erreurs d’API lisibles', async () => {
    const { run } = fakeRunner([{ error: 'Not logged in · Please run /login' }]);
    const error = await new ClaudeCodeLlmClient({ run })
      .send({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeCodeError);
    expect(isApiError(error)).toBe(true);
    expect(describeApiError(error)).toMatch(/claude auth login/);
  });
});

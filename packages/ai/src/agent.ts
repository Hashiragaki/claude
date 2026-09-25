import type { z } from 'zod';
import {
  AiRefusalError,
  addUsage,
  isApiError,
  messageText,
  usageOf,
  ZERO_USAGE,
  type BetaMessageParam,
  type BetaTextBlockParam,
  type BetaToolResultBlockParam,
  type BetaToolUseBlock,
  type LlmCallMeta,
  type LlmClient,
  type LlmUsage,
} from './llm';
import { formatZodError, toInputSchema, truncate } from './schema';

/** Outil exposé à l'agent : schéma zod + exécution. */
export interface AgentTool<I = any> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  run(input: I, signal?: AbortSignal): Promise<unknown> | unknown;
}

export function defineTool<I>(tool: AgentTool<I>): AgentTool<I> {
  return tool;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking' }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; result: string }
  /** Message ajouté à l'historique (à persister tel quel, dans l'ordre). */
  | { type: 'message'; message: BetaMessageParam }
  | { type: 'done'; stopReason: string | null; text: string };

export interface AgentRunOptions {
  llm: LlmClient;
  system: string | BetaTextBlockParam[];
  /** Historique complet, déjà terminé par le nouveau message utilisateur. */
  messages: BetaMessageParam[];
  tools: AgentTool[];
  maxIterations?: number;
  maxTokens?: number;
  compaction?: boolean;
  signal?: AbortSignal;
  onEvent?(event: AgentEvent): void;
  /** Contexte de routage/comptabilité, transmis à chaque requête. */
  meta?: LlmCallMeta;
}

export interface AgentRunResult {
  /** Messages ajoutés pendant ce tour (réponses de l'assistant et résultats d'outils). */
  added: BetaMessageParam[];
  text: string;
  stopReason: string | null;
  /** Jetons cumulés de tous les appels du tour. */
  usage: LlmUsage;
}

/**
 * Boucle d'agent : envoie la conversation, exécute les outils demandés (entrées validées par
 * zod), renvoie les résultats, et recommence jusqu'à une réponse finale. L'historique n'est
 * jamais réécrit (ajouts uniquement), ce qui préserve le cache et les blocs de réflexion.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const emit = (event: AgentEvent) => options.onEvent?.(event);
  const toolsByName = new Map(options.tools.map((t) => [t.name, t]));
  const apiTools = options.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toInputSchema(t.schema),
    eager_input_streaming: true,
  }));
  const history = [...options.messages];
  const added: BetaMessageParam[] = [];
  const push = (message: BetaMessageParam) => {
    history.push(message);
    added.push(message);
    emit({ type: 'message', message });
  };
  const maxIterations = options.maxIterations ?? 16;
  let finalText = '';
  let stopReason: string | null = null;
  let jsonRetries = 0;
  let usage: LlmUsage = { ...ZERO_USAGE };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let response;
    try {
      response = await options.llm.send(
        {
          system: options.system,
          messages: history,
          tools: apiTools,
          maxTokens: options.maxTokens ?? 32000,
          compaction: options.compaction,
          meta: options.meta,
        },
        {
          onText: (delta) => emit({ type: 'text', delta }),
          onThinking: () => emit({ type: 'thinking' }),
        },
        options.signal,
      );
      jsonRetries = 0;
    } catch (error) {
      // Entrée d'outil illisible pendant le streaming : on relance le tour (quelques fois).
      if (!isApiError(error) && jsonRetries++ < 2) continue;
      throw error;
    }
    usage = addUsage(usage, usageOf(response));
    stopReason = response.stop_reason;
    if (response.stop_reason === 'refusal') throw new AiRefusalError();

    push({ role: 'assistant', content: response.content });
    const text = messageText(response);
    if (text) finalText = text;

    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
    if (calls.length === 0) break;

    const truncated = response.stop_reason === 'max_tokens';
    const results = await Promise.all(
      calls.map((call) => executeCall(call, toolsByName, truncated, emit, options.signal)),
    );
    push({ role: 'user', content: results });
  }

  emit({ type: 'done', stopReason, text: finalText });
  return { added, text: finalText, stopReason, usage };
}

async function executeCall(
  call: BetaToolUseBlock,
  tools: Map<string, AgentTool>,
  truncated: boolean,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<BetaToolResultBlockParam> {
  const fail = (content: string): BetaToolResultBlockParam => {
    emit({ type: 'tool_end', id: call.id, name: call.name, ok: false, result: content });
    return { type: 'tool_result', tool_use_id: call.id, is_error: true, content };
  };
  emit({ type: 'tool_start', id: call.id, name: call.name, input: call.input });
  if (truncated) return fail('Appel tronqué (limite de longueur atteinte) : recommence avec une entrée plus courte.');
  const tool = tools.get(call.name);
  if (!tool) return fail(`Outil inconnu : ${call.name}`);
  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) return fail(`Entrée invalide :\n${formatZodError(parsed.error)}`);
  try {
    const output = await tool.run(parsed.data, signal);
    const content = truncate(typeof output === 'string' ? output : JSON.stringify(output ?? { ok: true }));
    emit({ type: 'tool_end', id: call.id, name: call.name, ok: true, result: content });
    return { type: 'tool_result', tool_use_id: call.id, content };
  } catch (error) {
    return fail(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  }
}

import type { z } from 'zod';
import {
  AiRefusalError,
  isApiError,
  type BetaMessageParam,
  type BetaToolResultBlockParam,
  type BetaToolUseBlock,
  type LlmClient,
} from './llm';
import { formatZodError, toInputSchema } from './schema';

export interface StructuredRequest<T> {
  llm: LlmClient;
  system: string;
  prompt: string;
  /** Schéma de la réponse attendue (validé côté client, y compris les `superRefine`). */
  schema: z.ZodType<T>;
  toolName?: string;
  toolDescription?: string;
  /** Nombre maximum d'essais (1 + corrections). */
  maxAttempts?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Appelé à chaque nouvel essai, avec l'erreur de l'essai précédent. */
  onAttempt?(attempt: number, previousError?: string): void;
}

export interface StructuredResult<T> {
  value: T;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
}

export class StructuredGenerationError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: string,
  ) {
    super(message);
    this.name = 'StructuredGenerationError';
  }
}

/**
 * Demande au modèle un objet JSON conforme à `schema`, via un outil unique « submit ».
 * Chaque réponse est validée avec zod ; en cas d'erreur, les problèmes sont renvoyés au
 * modèle (résultat d'outil en erreur) pour qu'il corrige, jusqu'à `maxAttempts` essais.
 *
 * On n'impose pas l'outil (`tool_choice` forcé est refusé par certains modèles) : la consigne
 * est donnée dans le message, et l'absence d'appel est traitée comme une erreur à corriger.
 */
export async function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const toolName = request.toolName ?? 'submit_result';
  const maxAttempts = request.maxAttempts ?? 3;
  const tool = {
    name: toolName,
    description: request.toolDescription ?? 'Soumet le résultat final, au format JSON décrit par le schéma.',
    input_schema: toInputSchema(request.schema),
    eager_input_streaming: true,
  };
  const messages: BetaMessageParam[] = [
    {
      role: 'user',
      content: `${request.prompt}\n\nQuand ta réponse est prête, appelle l'outil \`${toolName}\` une seule fois avec le résultat complet.`,
    },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    request.onAttempt?.(attempt, lastError || undefined);
    let response;
    try {
      response = await request.llm.send(
        { system: request.system, messages, tools: [tool], maxTokens: request.maxTokens ?? 32000 },
        {},
        request.signal,
      );
    } catch (error) {
      // Entrée d'outil JSON illisible pendant le streaming : on relance le tour.
      if (!isApiError(error) && attempt < maxAttempts) {
        lastError = 'JSON invalide dans l\'appel d\'outil.';
        continue;
      }
      throw error;
    }
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') throw new AiRefusalError();

    const call = response.content.find(
      (b): b is BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName,
    );
    messages.push({ role: 'assistant', content: response.content });

    if (!call) {
      lastError = `Aucun appel à l'outil ${toolName}.`;
      messages.push({
        role: 'user',
        content: `Tu n'as pas appelé l'outil \`${toolName}\`. Appelle-le maintenant avec le résultat complet.`,
      });
      continue;
    }

    const results: BetaToolResultBlockParam[] = [];
    if (response.stop_reason === 'max_tokens') {
      lastError = 'Réponse tronquée (limite de jetons atteinte).';
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: 'Ta réponse a été tronquée (limite de longueur atteinte). Recommence avec un résultat plus compact.',
      });
    } else {
      const parsed = request.schema.safeParse(call.input);
      if (parsed.success) return { value: parsed.data, attempts: attempt, usage };
      lastError = formatZodError(parsed.error);
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: `Le résultat ne respecte pas le schéma. Corrige ces erreurs et rappelle l'outil :\n${lastError}`,
      });
    }
    // Les autres appels d'outils éventuels reçoivent aussi une réponse (obligatoire).
    for (const other of response.content) {
      if (other.type === 'tool_use' && other.id !== call.id) {
        results.push({ type: 'tool_result', tool_use_id: other.id, is_error: true, content: 'Outil inconnu.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  throw new StructuredGenerationError(
    `Génération impossible après ${maxAttempts} essais : ${lastError}`,
    maxAttempts,
    lastError,
  );
}

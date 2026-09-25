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
  /** Critique visuelle optionnelle du rendu de la valeur validée (voir `StructuredReview`). */
  review?: StructuredReview<T>;
  /** Appelé au début de chaque tour de critique, avec le numéro du tour (1-indexé). */
  onReview?(round: number): void;
}

export interface StructuredReview<T> {
  /**
   * Rend la valeur validée. Renvoie l'image à montrer au modèle, ou null pour ne pas critiquer.
   * Peut lever : l'erreur est alors renvoyée au modèle comme résultat d'outil en erreur (la
   * valeur n'est pas retenue).
   */
  render(value: T): Promise<{ image?: { data: Uint8Array; mediaType: 'image/png' }; note?: string } | null>;
  /** Nombre maximal de tours de critique (défaut 1). */
  maxRounds?: number;
  /** Consignes spécifiques ajoutées à la demande de critique (ex. disposition d'une planche). */
  instructions?: string;
}

export interface StructuredResult<T> {
  value: T;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Nombre de tours de critique effectués (0 si aucun). */
  reviews: number;
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

type CritiqueContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

/**
 * Demande au modèle un objet JSON conforme à `schema`, via un outil unique « submit ».
 * Chaque réponse est validée avec zod ; en cas d'erreur, les problèmes sont renvoyés au
 * modèle (résultat d'outil en erreur) pour qu'il corrige, jusqu'à `maxAttempts` essais.
 *
 * Si `review` est fourni, chaque valeur validée est d'abord rendue en image (`review.render`)
 * et soumise au modèle pour critique, jusqu'à `review.maxRounds` tours (défaut 1). Le modèle
 * peut accepter le rendu (pas de nouvel appel d'outil) ou corriger sa spec (nouvel appel
 * d'outil). Sans `review`, le comportement est identique à avant.
 *
 * On n'impose pas l'outil (`tool_choice` forcé est refusé par certains modèles) : la consigne
 * est donnée dans le message, et l'absence d'appel est traitée comme une erreur à corriger.
 */
export async function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const toolName = request.toolName ?? 'submit_result';
  const maxAttempts = request.maxAttempts ?? 3;
  const review = request.review;
  const maxRounds = review ? (review.maxRounds ?? 1) : 0;
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
  let attempt = 0;
  let rounds = 0;
  let lastValid: T | undefined;
  // true quand le message utilisateur qu'on vient d'envoyer est la demande de critique
  // (tool_result + image) : la réponse qui suit est un tour de critique, pas un nouvel essai.
  let awaitingCritiqueReply = false;

  const totalCalls = maxAttempts + maxRounds;
  for (let call = 1; call <= totalCalls; call++) {
    const isCritiqueReply = awaitingCritiqueReply;
    awaitingCritiqueReply = false;
    if (!isCritiqueReply) {
      attempt++;
      if (attempt > maxAttempts) break;
      request.onAttempt?.(attempt, lastError || undefined);
    }

    let response;
    try {
      response = await request.llm.send(
        { system: request.system, messages, tools: [tool], maxTokens: request.maxTokens ?? 32000 },
        {},
        request.signal,
      );
    } catch (error) {
      // Entrée d'outil JSON illisible pendant le streaming : on relance le tour.
      if (!isApiError(error) && !isCritiqueReply && attempt < maxAttempts) {
        lastError = 'JSON invalide dans l\'appel d\'outil.';
        continue;
      }
      if (lastValid !== undefined) return { value: lastValid, attempts: attempt, usage, reviews: rounds };
      throw error;
    }
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') {
      if (isCritiqueReply && lastValid !== undefined) {
        return { value: lastValid, attempts: attempt, usage, reviews: rounds };
      }
      throw new AiRefusalError();
    }

    const toolCall = response.content.find(
      (b): b is BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName,
    );
    messages.push({ role: 'assistant', content: response.content });

    if (!toolCall) {
      if (isCritiqueReply) {
        // Pas de nouvel appel d'outil en réponse à la critique : le modèle accepte le rendu.
        return { value: lastValid as T, attempts: attempt, usage, reviews: rounds };
      }
      lastError = `Aucun appel à l'outil ${toolName}.`;
      messages.push({
        role: 'user',
        content: `Tu n'as pas appelé l'outil \`${toolName}\`. Appelle-le maintenant avec le résultat complet.`,
      });
      continue;
    }

    const results: BetaToolResultBlockParam[] = [];
    if (response.stop_reason === 'max_tokens') {
      if (isCritiqueReply && lastValid !== undefined) {
        return { value: lastValid, attempts: attempt, usage, reviews: rounds };
      }
      lastError = 'Réponse tronquée (limite de jetons atteinte).';
      results.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        is_error: true,
        content: 'Ta réponse a été tronquée (limite de longueur atteinte). Recommence avec un résultat plus compact.',
      });
    } else {
      const parsed = request.schema.safeParse(toolCall.input);
      if (!parsed.success) {
        lastError = formatZodError(parsed.error);
        results.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          is_error: true,
          content: `Le résultat ne respecte pas le schéma. Corrige ces erreurs et rappelle l'outil :\n${lastError}`,
        });
      } else if (!review) {
        return { value: parsed.data, attempts: attempt, usage, reviews: 0 };
      } else {
        // review est défini : on rend la valeur avant de l'accepter définitivement.
        let rendered: { image?: { data: Uint8Array; mediaType: 'image/png' }; note?: string } | null = null;
        let renderFailed = false;
        try {
          rendered = await review.render(parsed.data);
        } catch (renderError) {
          renderFailed = true;
          lastError = renderError instanceof Error ? renderError.message : String(renderError);
        }
        if (renderFailed) {
          // Le rendu a échoué : la valeur n'est pas retenue. On renvoie l'erreur au modèle et
          // on continue les essais (ce n'est pas un tour de critique).
          results.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            is_error: true,
            content: `Le rendu de ce résultat a échoué : ${lastError}\nCorrige la spec et rappelle l'outil.`,
          });
        } else {
          lastValid = parsed.data;
          if (rendered === null || rounds >= maxRounds) {
            return { value: lastValid, attempts: attempt, usage, reviews: rounds };
          }
          rounds++;
          request.onReview?.(rounds);
          const critiqueLines = [
            'Voici le rendu de ta dernière proposition. Compare-le attentivement à la demande initiale.',
            `Si le résultat est satisfaisant, réponds uniquement « OK » sans appeler l'outil \`${toolName}\`.`,
            `Sinon, rappelle l'outil \`${toolName}\` avec une spec corrigée complète.`,
          ];
          if (review.instructions) critiqueLines.push(review.instructions);
          if (rendered.note) critiqueLines.push(rendered.note);
          const content: CritiqueContentBlock[] = [{ type: 'text', text: critiqueLines.join('\n\n') }];
          if (rendered.image) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: Buffer.from(rendered.image.data).toString('base64'),
              },
            });
          }
          results.push({ type: 'tool_result', tool_use_id: toolCall.id, content });
          awaitingCritiqueReply = true;
        }
      }
    }
    // Les autres appels d'outils éventuels reçoivent aussi une réponse (obligatoire).
    for (const other of response.content) {
      if (other.type === 'tool_use' && other.id !== toolCall.id) {
        results.push({ type: 'tool_result', tool_use_id: other.id, is_error: true, content: 'Outil inconnu.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  if (lastValid !== undefined) return { value: lastValid, attempts: attempt, usage, reviews: rounds };
  throw new StructuredGenerationError(
    `Génération impossible après ${maxAttempts} essais : ${lastError}`,
    maxAttempts,
    lastError,
  );
}

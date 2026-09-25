import type { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AiRefusalError,
  addUsage,
  isApiError,
  usageOf,
  ZERO_USAGE,
  type BetaMessageParam,
  type BetaToolResultBlockParam,
  type BetaToolUnion,
  type BetaToolUseBlock,
  type Effort,
  type LlmCallMeta,
  type LlmClient,
  type LlmUsage,
} from './llm';
import type { RoleSetting } from './router';
import { formatZodError, toInputSchema } from './schema';

type InputSchema = Anthropic.Beta.BetaTool.InputSchema;

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
  /** Contexte de routage/comptabilité, transmis à chaque requête. */
  meta?: LlmCallMeta;
  /**
   * Réglage utilisé pour UN tour supplémentaire quand tous les essais de correction ont échoué
   * sans produire de valeur valide (le message d'erreur de validation reste le dernier
   * `tool_result`). Sans effet si une valeur valide a déjà été obtenue.
   */
  escalate?: RoleSetting;
  /**
   * Ajoute `strict: true` à l'outil de soumission quand le schéma le permet (défaut `true`).
   * Repli automatique sans `strict` si l'API refuse le schéma strict.
   */
  strict?: boolean;
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
  usage: LlmUsage;
  /** Nombre de tours de critique effectués (0 si aucun). */
  reviews: number;
  /** `true` si la valeur retournée provient du tour d'escalade (`escalate`). */
  escalated: boolean;
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
  { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

/** Mots-clés JSON Schema non pris en charge par le mode strict des outils. */
const UNSUPPORTED_STRICT_KEYWORDS = [
  'patternProperties',
  'propertyNames',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'contains',
  'minContains',
  'maxContains',
];

/**
 * Un schéma JSON peut-il être soumis en mode strict sans changer son sens ? Prudent : `false` dès
 * qu'un doute existe (référence non résolue localement, `patternProperties`/`propertyNames`, un
 * mot-clé numérique/chaîne non pris en charge en mode strict, ou un objet dont les propriétés
 * additionnelles sont explicitement autorisées ou contraintes par un schéma).
 */
export function isStrictCompatible(schema: unknown): boolean {
  return isStrictCompatibleNode(schema);
}

function isStrictCompatibleNode(node: unknown): boolean {
  if (Array.isArray(node)) return node.every((n) => isStrictCompatibleNode(n));
  if (node === null || typeof node !== 'object') return true;
  const obj = node as Record<string, unknown>;
  // Référence non résolue ici : on ne peut pas garantir l'absence de récursion ni l'absence de
  // mots-clés non pris en charge plus loin -> prudence.
  if ('$ref' in obj) return false;
  for (const key of UNSUPPORTED_STRICT_KEYWORDS) {
    if (key in obj) return false;
  }
  if (obj.type === 'object' || obj.properties !== undefined) {
    if (obj.additionalProperties !== undefined && obj.additionalProperties !== false) return false;
    const properties = obj.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const value of Object.values(properties)) {
        if (!isStrictCompatibleNode(value)) return false;
      }
    }
  }
  if (obj.items !== undefined && !isStrictCompatibleNode(obj.items)) return false;
  for (const combiner of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = obj[combiner];
    if (Array.isArray(list) && !list.every((n) => isStrictCompatibleNode(n))) return false;
  }
  const defs = (obj.$defs ?? obj.definitions) as Record<string, unknown> | undefined;
  if (defs) {
    for (const def of Object.values(defs)) {
      if (!isStrictCompatibleNode(def)) return false;
    }
  }
  return true;
}

/** Copie le schéma en posant `additionalProperties: false` sur chaque objet qui ne le fixe pas déjà. */
function withStrictObjects<T>(node: T): T {
  if (Array.isArray(node)) return node.map((n) => withStrictObjects(n)) as unknown as T;
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) copy[key] = withStrictObjects(value);
  if ((copy.type === 'object' || copy.properties !== undefined) && copy.additionalProperties === undefined) {
    copy.additionalProperties = false;
  }
  return copy as T;
}

/** Une erreur 400 qui mentionne le schéma strict (l'API refuse ce schéma en mode strict). */
function isStrictSchemaError(error: unknown): boolean {
  return isApiError(error) && error.status === 400 && /strict/i.test(error.message);
}

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
  const toolDescription = request.toolDescription ?? 'Soumet le résultat final, au format JSON décrit par le schéma.';
  const maxAttempts = request.maxAttempts ?? 3;
  const review = request.review;
  const maxRounds = review ? (review.maxRounds ?? 1) : 0;
  const jsonSchema = toInputSchema(request.schema) as unknown as Record<string, unknown>;
  let strictActive = (request.strict ?? true) && isStrictCompatible(jsonSchema);
  const buildTool = (strict: boolean): BetaToolUnion =>
    ({
      name: toolName,
      description: toolDescription,
      input_schema: (strict ? withStrictObjects(jsonSchema) : jsonSchema) as InputSchema,
      eager_input_streaming: true,
      ...(strict ? { strict: true } : {}),
    }) as BetaToolUnion;
  let tool = buildTool(strictActive);
  const send = async (messages: BetaMessageParam[], overrides: { model?: string; effort?: Effort } = {}) => {
    const req = {
      system: request.system,
      messages,
      tools: [tool],
      maxTokens: request.maxTokens ?? 32000,
      meta: request.meta,
      ...overrides,
    };
    try {
      return await request.llm.send(req, {}, request.signal);
    } catch (error) {
      if (!strictActive || !isStrictSchemaError(error)) throw error;
      // Le schéma strict est refusé par l'API : on relance une fois sans `strict`.
      strictActive = false;
      tool = buildTool(false);
      return await request.llm.send({ ...req, tools: [tool] }, {}, request.signal);
    }
  };
  const messages: BetaMessageParam[] = [
    {
      role: 'user',
      content: `${request.prompt}\n\nQuand ta réponse est prête, appelle l'outil \`${toolName}\` une seule fois avec le résultat complet.`,
    },
  ];
  let usage: LlmUsage = { ...ZERO_USAGE };
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
      response = await send(messages);
    } catch (error) {
      // Entrée d'outil JSON illisible pendant le streaming : on relance le tour.
      if (!isApiError(error) && !isCritiqueReply && attempt < maxAttempts) {
        lastError = "JSON invalide dans l'appel d'outil.";
        continue;
      }
      if (lastValid !== undefined) {
        return { value: lastValid, attempts: attempt, usage, reviews: rounds, escalated: false };
      }
      throw error;
    }
    usage = addUsage(usage, usageOf(response));

    if (response.stop_reason === 'refusal') {
      if (isCritiqueReply && lastValid !== undefined) {
        return { value: lastValid, attempts: attempt, usage, reviews: rounds, escalated: false };
      }
      throw new AiRefusalError();
    }

    const toolCall = response.content.find((b): b is BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName);
    messages.push({ role: 'assistant', content: response.content });

    if (!toolCall) {
      if (isCritiqueReply) {
        // Pas de nouvel appel d'outil en réponse à la critique : le modèle accepte le rendu.
        return { value: lastValid as T, attempts: attempt, usage, reviews: rounds, escalated: false };
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
        return { value: lastValid, attempts: attempt, usage, reviews: rounds, escalated: false };
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
        return { value: parsed.data, attempts: attempt, usage, reviews: 0, escalated: false };
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
            return { value: lastValid, attempts: attempt, usage, reviews: rounds, escalated: false };
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

  if (lastValid !== undefined) return { value: lastValid, attempts: attempt, usage, reviews: rounds, escalated: false };

  if (request.escalate) {
    attempt++;
    request.onAttempt?.(attempt, lastError || undefined);
    const response = await send(messages, { model: request.escalate.model, effort: request.escalate.effort });
    usage = addUsage(usage, usageOf(response));
    if (response.stop_reason === 'refusal') throw new AiRefusalError();
    const toolCall = response.content.find((b): b is BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName);
    messages.push({ role: 'assistant', content: response.content });
    if (toolCall && response.stop_reason !== 'max_tokens') {
      const parsed = request.schema.safeParse(toolCall.input);
      if (parsed.success) {
        return { value: parsed.data, attempts: attempt, usage, reviews: rounds, escalated: true };
      }
      lastError = formatZodError(parsed.error);
    } else if (response.stop_reason === 'max_tokens') {
      lastError = 'Réponse tronquée (limite de jetons atteinte).';
    } else {
      lastError = `Aucun appel à l'outil ${toolName}.`;
    }
  }

  throw new StructuredGenerationError(
    `Génération impossible après ${maxAttempts} essais : ${lastError}`,
    maxAttempts,
    lastError,
  );
}

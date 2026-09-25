import {
  LLM_ROLES,
  modelCapabilities,
  usageOf,
  type BetaMessage,
  type Effort,
  type LlmCallMeta,
  type LlmClient,
  type LlmRequest,
  type LlmRole,
  type LlmStreamHandlers,
  type LlmUsage,
} from './llm';

/**
 * Routage modèle/effort par rôle d'appel et comptabilité des jetons.
 *
 * Principe : le modèle principal (celui du client) reste réservé aux boucles d'agent ; les tâches
 * cadrées et vérifiables (specs d'assets validées par zod, résumés) passent par des modèles moins
 * chers, avec **escalade** vers plus d'effort puis le modèle principal quand la validation échoue.
 */

/** Réglage d'un rôle ; un champ absent = réglage du client (modèle principal, effort par défaut). */
export interface RoleSetting {
  model?: string;
  effort?: Effort;
}

export type RoutingTable = Record<LlmRole, RoleSetting>;

export const DEFAULT_ROUTING: RoutingTable = {
  chat: { effort: 'high' },
  autopilot: { effort: 'high' },
  plan: { effort: 'medium' },
  generate: { model: 'claude-sonnet-5', effort: 'medium' },
  review: { model: 'claude-sonnet-5', effort: 'medium' },
  summary: { model: 'claude-haiku-4-5' },
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Table de routage depuis l'environnement : `FORGE_ROUTING=off` désactive le routage (tout passe par
 * le modèle et l'effort du client) ; `FORGE_MODEL_<RÔLE>` et `FORGE_EFFORT_<RÔLE>` surchargent un rôle
 * (ex. `FORGE_MODEL_GENERATE=claude-opus-5`, `FORGE_EFFORT_CHAT=medium`). Valeur `default` = réglage
 * du client.
 */
export function routingFromEnv(env: Record<string, string | undefined>): RoutingTable {
  const off = (env.FORGE_ROUTING ?? '').toLowerCase() === 'off';
  const table = {} as RoutingTable;
  for (const role of LLM_ROLES) {
    const base: RoleSetting = off ? {} : { ...DEFAULT_ROUTING[role] };
    const model = env[`FORGE_MODEL_${role.toUpperCase()}`];
    const effort = env[`FORGE_EFFORT_${role.toUpperCase()}`];
    if (model) {
      if (model === 'default') delete base.model;
      else base.model = model;
    }
    if (effort) {
      if (effort === 'default') delete base.effort;
      else if ((EFFORTS as readonly string[]).includes(effort)) base.effort = effort as Effort;
    }
    table[role] = base;
  }
  return table;
}

/**
 * Réglage immédiatement supérieur, pour relancer après un échec : effort + 1 cran (jusqu'à `high`)
 * sur le même modèle, puis le modèle principal à l'effort `high`. `null` si l'on est déjà au plus haut.
 */
export function escalate(setting: RoleSetting, defaultModel: string): RoleSetting | null {
  const model = setting.model ?? defaultModel;
  const current = setting.effort ?? 'high';
  const rank = EFFORTS.indexOf(current);
  if (modelCapabilities(model).adaptiveThinking && rank >= 0 && rank < EFFORTS.indexOf('high')) {
    return { ...setting, effort: EFFORTS[rank + 1] };
  }
  if (model !== defaultModel) return { effort: 'high' };
  return null;
}

/** Prix en dollars par million de jetons (entrée, sortie) ; lecture de cache 0,1×, écriture 1,25×. */
export interface ModelPrice {
  input: number;
  output: number;
}

/** Estimations : à vérifier sur la page de tarifs d'Anthropic ; surchargeables (`FORGE_PRICES`). */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Coût estimé (dollars) ; 0 pour un modèle sans prix connu. */
export function estimateCost(
  model: string,
  usage: LlmUsage,
  prices: Record<string, ModelPrice> = DEFAULT_PRICES,
): number {
  const key = Object.keys(prices)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  const price = key ? prices[key] : undefined;
  if (!price) return 0;
  const input = usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheWriteTokens * 1.25;
  return (input * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** Un appel terminé, tel que vu par la comptabilité. */
export interface UsageEvent {
  meta: LlmCallMeta;
  model: string;
  effort?: Effort;
  usage: LlmUsage;
  costUsd: number;
  /** Date ISO. */
  at: string;
}

export interface RoutedClientOptions {
  routing?: RoutingTable;
  prices?: Record<string, ModelPrice>;
  /** Appelé avant chaque requête (ex. contrôle du budget) : lever une erreur l'annule. */
  beforeSend?(meta: LlmCallMeta | undefined): void;
  /** Appelé après chaque réponse (y compris les requêtes sans `meta`, rôle `chat` par défaut). */
  onUsage?(event: UsageEvent): void;
  now?(): Date;
}

/**
 * Enveloppe un client : applique la table de routage aux requêtes qui portent un `meta` et ne fixent
 * pas déjà `model`/`effort`, puis signale la consommation. Les requêtes sans `meta` passent inchangées.
 */
export class RoutedLlmClient implements LlmClient {
  readonly model: string;

  constructor(
    private readonly inner: LlmClient,
    private readonly options: RoutedClientOptions = {},
  ) {
    this.model = inner.model;
  }

  /** Réglage effectif d'un rôle (utile pour calculer l'escalade). */
  settingFor(role: LlmRole): RoleSetting {
    return { ...(this.options.routing?.[role] ?? {}) };
  }

  async send(request: LlmRequest, handlers?: LlmStreamHandlers, signal?: AbortSignal): Promise<BetaMessage> {
    this.options.beforeSend?.(request.meta);
    const route = request.meta ? this.settingFor(request.meta.role) : {};
    const routed: LlmRequest = {
      ...request,
      ...(request.model === undefined && route.model ? { model: route.model } : {}),
      ...(request.effort === undefined && route.effort ? { effort: route.effort } : {}),
    };
    const message = await this.inner.send(routed, handlers, signal);
    if (this.options.onUsage) {
      const model = routed.model ?? this.inner.model;
      const usage = usageOf(message);
      this.options.onUsage({
        meta: request.meta ?? { role: 'chat' },
        model,
        ...(routed.effort ? { effort: routed.effort } : {}),
        usage,
        costUsd: estimateCost(model, usage, this.options.prices),
        at: (this.options.now?.() ?? new Date()).toISOString(),
      });
    }
    return message;
  }
}

/** Budget de dépense dépassé : les nouveaux appels sont refusés (le procédural prend le relais). */
export class BudgetExceededError extends Error {
  readonly statusCode = 402;
  constructor(message = 'Budget IA du projet atteint.') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

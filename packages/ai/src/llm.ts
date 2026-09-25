import Anthropic from '@anthropic-ai/sdk';

export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
export type BetaToolUnion = Anthropic.Beta.BetaToolUnion;
export type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
export type BetaToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type BetaTextBlockParam = Anthropic.Beta.BetaTextBlockParam;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Rôle d'un appel au modèle : sert à choisir modèle et effort (`ModelRouter`) et à ventiler les coûts.
 * `chat` et `autopilot` : boucles d'agent ; `plan` : planification ; `generate` : specs d'assets
 * (y compris leur critique visuelle, dans la même conversation) ; `review` : critique isolée ;
 * `summary` : résumés et digests.
 */
export type LlmRole = 'chat' | 'autopilot' | 'plan' | 'generate' | 'review' | 'summary';
export const LLM_ROLES: readonly LlmRole[] = ['chat', 'autopilot', 'plan', 'generate', 'review', 'summary'];

/** Contexte d'un appel, pour le routage et la comptabilité (jamais envoyé à l'API). */
export interface LlmCallMeta {
  role: LlmRole;
  projectId?: string;
  /** Précision libre : id du générateur, de la tâche… */
  label?: string;
}

/** Requête envoyée au modèle (sous-ensemble utile de l'API Messages). */
export interface LlmRequest {
  system?: string | BetaTextBlockParam[];
  messages: BetaMessageParam[];
  tools?: BetaToolUnion[];
  maxTokens?: number;
  /** Active la compaction côté serveur pour les longues conversations. */
  compaction?: boolean;
  /** Modèle pour cette requête (sinon celui du client). */
  model?: string;
  /** Effort pour cette requête (sinon celui du client), ignoré si le modèle ne le gère pas. */
  effort?: Effort;
  meta?: LlmCallMeta;
}

/** Jetons consommés par un ou plusieurs appels. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: Readonly<LlmUsage> = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Jetons d'une réponse (les compteurs de cache absents valent 0). */
export function usageOf(message: Pick<BetaMessage, 'usage'>): LlmUsage {
  const u = message.usage as Partial<BetaMessage['usage']> | undefined;
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Fonctions de l'API prises en charge par un modèle (liste prudente : inconnu = non). */
export interface ModelCapabilities {
  /** `thinking: { type: 'adaptive' }` et `output_config.effort`. */
  adaptiveThinking: boolean;
  /** Compaction côté serveur (`compact_20260112`). */
  compaction: boolean;
  /** Repli serveur en cas de refus (`fallbacks: 'default'`). */
  refusalFallback: boolean;
}

const ADAPTIVE_MODELS = /^claude-(opus-(4-[678]|5)|sonnet-(4-6|5)|fable-5|mythos-5)/;

export function modelCapabilities(model: string): ModelCapabilities {
  const adaptive = ADAPTIVE_MODELS.test(model);
  return {
    adaptiveThinking: adaptive,
    compaction: adaptive,
    refusalFallback: FALLBACK_MODELS.includes(model),
  };
}

export interface LlmStreamHandlers {
  onText?(delta: string): void;
  /** Le modèle commence à réfléchir (bloc de réflexion). */
  onThinking?(): void;
}

/** Abstraction du modèle de langage : permet d'injecter un faux client dans les tests. */
export interface LlmClient {
  readonly model: string;
  send(request: LlmRequest, handlers?: LlmStreamHandlers, signal?: AbortSignal): Promise<BetaMessage>;
}

export interface ClaudeConfig {
  apiKey?: string;
  /** Modèle Claude (par défaut `claude-opus-5`). */
  model?: string;
  /** Niveau d'effort (par défaut celui du modèle). */
  effort?: Effort;
  /**
   * Repli serveur en cas de refus du modèle principal (`fallbacks: "default"`).
   * Activé par défaut pour les modèles qui le prennent en charge.
   */
  refusalFallback?: boolean;
  baseURL?: string;
}

export const DEFAULT_MODEL = 'claude-opus-5';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const COMPACTION_BETA = 'compact-2026-01-12';
const FALLBACK_MODELS = ['claude-opus-5', 'claude-fable-5-1', 'claude-fable-5'];

/** Client Claude réel (API Messages bêta, en streaming). */
export class ClaudeLlmClient implements LlmClient {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort | undefined;
  private readonly refusalFallback: boolean;

  constructor(config: ClaudeConfig = {}) {
    this.client = new Anthropic({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.effort = config.effort;
    this.refusalFallback = config.refusalFallback ?? true;
  }

  async send(request: LlmRequest, handlers: LlmStreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    const model = request.model ?? this.model;
    const caps = modelCapabilities(model);
    const effort = caps.adaptiveThinking ? (request.effort ?? this.effort) : undefined;
    const fallback = this.refusalFallback && caps.refusalFallback;
    const compaction = Boolean(request.compaction) && caps.compaction;
    const betas: string[] = [];
    if (fallback) betas.push(FALLBACK_BETA);
    if (compaction) betas.push(COMPACTION_BETA);
    const stream = this.client.beta.messages.stream(
      {
        model,
        max_tokens: request.maxTokens ?? 32000,
        ...(caps.adaptiveThinking ? { thinking: { type: 'adaptive' as const } } : {}),
        ...(effort ? { output_config: { effort } } : {}),
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages,
        ...(request.tools?.length ? { tools: request.tools } : {}),
        cache_control: { type: 'ephemeral' },
        ...(fallback ? { fallbacks: 'default' as const } : {}),
        ...(compaction ? { context_management: { edits: [{ type: 'compact_20260112' as const }] } } : {}),
        ...(betas.length ? { betas } : {}),
      },
      { signal },
    );
    if (handlers.onText) stream.on('text', (delta) => handlers.onText?.(delta));
    if (handlers.onThinking) {
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') handlers.onThinking?.();
      });
    }
    return stream.finalMessage();
  }
}

/** Erreur levée quand le modèle refuse une demande (`stop_reason: refusal`). */
export class AiRefusalError extends Error {
  constructor(message = 'La demande a été refusée par le modèle.') {
    super(message);
    this.name = 'AiRefusalError';
  }
}

/** Texte concaténé des blocs `text` d'une réponse. */
export function messageText(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Est-ce une erreur d'API (réseau, authentification, quota…) plutôt qu'une erreur de contenu ? */
export function isApiError(error: unknown): error is InstanceType<typeof Anthropic.APIError> {
  return error instanceof Anthropic.APIError;
}

/** Message d'erreur lisible en français pour les erreurs d'API. */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Clé API Claude invalide (ANTHROPIC_API_KEY).';
  if (error instanceof Anthropic.PermissionDeniedError) return "Accès refusé par l'API Claude.";
  if (error instanceof Anthropic.RateLimitError)
    return "Limite de débit de l'API Claude atteinte, réessayez plus tard.";
  if (error instanceof Anthropic.BadRequestError) return `Requête refusée par l'API Claude : ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Impossible de joindre l'API Claude (réseau).";
  if (error instanceof Anthropic.APIError) return `Erreur de l'API Claude (${error.status ?? '?'}) : ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

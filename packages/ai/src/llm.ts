import Anthropic from '@anthropic-ai/sdk';

export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
export type BetaToolUnion = Anthropic.Beta.BetaToolUnion;
export type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
export type BetaToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type BetaTextBlockParam = Anthropic.Beta.BetaTextBlockParam;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Requête envoyée au modèle (sous-ensemble utile de l'API Messages). */
export interface LlmRequest {
  system?: string | BetaTextBlockParam[];
  messages: BetaMessageParam[];
  tools?: BetaToolUnion[];
  maxTokens?: number;
  /** Active la compaction côté serveur pour les longues conversations. */
  compaction?: boolean;
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
    this.refusalFallback = (config.refusalFallback ?? true) && FALLBACK_MODELS.includes(this.model);
  }

  async send(request: LlmRequest, handlers: LlmStreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    const betas: string[] = [];
    if (this.refusalFallback) betas.push(FALLBACK_BETA);
    if (request.compaction) betas.push(COMPACTION_BETA);
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens ?? 32000,
        thinking: { type: 'adaptive' },
        ...(this.effort ? { output_config: { effort: this.effort } } : {}),
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages,
        ...(request.tools?.length ? { tools: request.tools } : {}),
        cache_control: { type: 'ephemeral' },
        ...(this.refusalFallback ? { fallbacks: 'default' as const } : {}),
        ...(request.compaction ? { context_management: { edits: [{ type: 'compact_20260112' as const }] } } : {}),
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
  if (error instanceof Anthropic.PermissionDeniedError) return 'Accès refusé par l\'API Claude.';
  if (error instanceof Anthropic.RateLimitError) return 'Limite de débit de l\'API Claude atteinte, réessayez plus tard.';
  if (error instanceof Anthropic.BadRequestError) return `Requête refusée par l'API Claude : ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Impossible de joindre l\'API Claude (réseau).';
  if (error instanceof Anthropic.APIError) return `Erreur de l'API Claude (${error.status ?? '?'}) : ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

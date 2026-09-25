import type { BetaContentBlock, BetaMessage, LlmClient, LlmRequest, LlmStreamHandlers } from './llm';

/** Réponse préparée : champs de message facultatifs, contenu libre. */
export type FakeResponse = Omit<Partial<BetaMessage>, 'content'> & { content: unknown[] };
type Responder = (request: LlmRequest) => FakeResponse;

/**
 * Faux client pour les tests et le mode démo : renvoie des réponses préparées, dans l'ordre.
 * Les requêtes reçues sont conservées dans `requests`.
 */
export class FakeLlmClient implements LlmClient {
  readonly model = 'fake-model';
  readonly requests: LlmRequest[] = [];
  private readonly queue: Responder[];

  constructor(responses: (Responder | FakeResponse)[] = []) {
    this.queue = responses.map((r) => (typeof r === 'function' ? r : () => r));
  }

  enqueue(response: Responder | FakeResponse): void {
    this.queue.push(typeof response === 'function' ? response : () => response);
  }

  async send(request: LlmRequest, handlers: LlmStreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    signal?.throwIfAborted();
    // Copie : l'appelant continue de modifier son tableau de messages.
    this.requests.push({ ...request, messages: [...request.messages] });
    const next = this.queue.shift();
    if (!next) throw new Error('FakeLlmClient : plus de réponse préparée');
    const partial = next(request);
    for (const block of partial.content as BetaContentBlock[]) {
      if (block.type === 'text') handlers.onText?.(block.text);
    }
    const hasTool = (partial.content as BetaContentBlock[]).some((b) => b.type === 'tool_use');
    return {
      id: `msg_fake_${this.requests.length}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      stop_reason: hasTool ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      ...partial,
    } as unknown as BetaMessage;
  }
}

/** Bloc texte pour les réponses préparées. */
export function textBlock(text: string) {
  return { type: 'text', text, citations: null };
}

let toolCounter = 0;
/** Bloc d'appel d'outil pour les réponses préparées. */
export function toolUseBlock(name: string, input: unknown, id = `toolu_fake_${++toolCounter}`) {
  return { type: 'tool_use', id, name, input };
}

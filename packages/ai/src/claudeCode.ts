import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
  Effort,
  LlmClient,
  LlmRequest,
  LlmStreamHandlers,
} from './llm';

/**
 * Backend « Claude Code » : passe par la commande `claude -p` installée sur la machine, connectée
 * à un abonnement Claude (Pro/Max), au lieu de l'API Messages facturée à la clé.
 *
 * Claude Code n'expose pas les outils personnalisés de Forge : ils sont décrits dans le prompt
 * système et le modèle les appelle en terminant sa réponse par un bloc `<tool_calls>[…]</tool_calls>`
 * (JSON), converti ici en blocs `tool_use`. Toute la conversation (textes, appels d'outils,
 * résultats, images) est aplatie en un seul message utilisateur à chaque appel : sans état côté
 * Claude Code, donc compatible avec la boucle d'agent et la génération structurée existantes.
 */

export interface ClaudeCodeConfig {
  /** Exécutable `claude` (défaut : `FORGE_CLAUDE_BIN`, puis `~/.local/bin/claude(.exe)`, puis `claude`). */
  command?: string;
  /** Modèle par défaut (alias `opus`, `sonnet`, `haiku` ou identifiant complet). */
  model?: string;
  effort?: Effort;
  /** Délai maximal d'un appel en millisecondes (défaut 10 min). */
  timeoutMs?: number;
  /** Lance le processus (injectable pour les tests). */
  run?: ClaudeCodeRunner;
}

/** Lance `claude` avec ces arguments et cette entrée ; appelle `onLine` pour chaque ligne de sortie. */
export type ClaudeCodeRunner = (
  args: string[],
  stdin: string,
  onLine: (line: string) => void,
  signal?: AbortSignal,
) => Promise<{ code: number; stderr: string }>;

/** Erreur de Claude Code (non connecté, limite d'usage atteinte…) : traitée comme une erreur d'API. */
export class ClaudeCodeError extends Anthropic.APIError {
  constructor(message: string) {
    super(undefined, undefined, message, undefined);
    this.name = 'ClaudeCodeError';
  }
}

const TOOL_OPEN = '<tool_calls>';
const TOOL_CLOSE = '</tool_calls>';

export function defaultClaudeCommand(env: Record<string, string | undefined> = process.env): string {
  if (env.FORGE_CLAUDE_BIN) return env.FORGE_CLAUDE_BIN;
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}

/** Identifiant de modèle Forge → alias Claude Code (les alias suivent l'abonnement). */
export function claudeCodeModel(model: string): string {
  if (/opus/.test(model)) return 'opus';
  if (/sonnet/.test(model)) return 'sonnet';
  if (/haiku/.test(model)) return 'haiku';
  return model;
}

type Block = { type: 'text'; text: string } | { type: 'image'; source: unknown };

/** Prompt système : celui de Forge, plus le protocole d'appel d'outils s'il y en a. */
export function buildSystemPrompt(request: LlmRequest): string {
  const base =
    typeof request.system === 'string' ? request.system : (request.system ?? []).map((b) => b.text).join('\n\n');
  const tools = request.tools ?? [];
  if (tools.length === 0) return base;
  const lines = [
    base,
    '## Appels d’outils',
    'Tu n’as pas d’accès direct aux outils. Pour en appeler, termine ta réponse par un bloc :',
    `${TOOL_OPEN}\n[{"name": "nom_de_l_outil", "input": { … }}]\n${TOOL_CLOSE}`,
    'Le contenu est un tableau JSON strict (guillemets doubles, pas de commentaire) ; chaque `input` respecte ' +
      'le schéma de l’outil. Tu peux écrire un court texte avant le bloc, rien après. Les résultats te ' +
      'seront renvoyés dans le message suivant. Une réponse sans bloc est ta réponse finale.',
    'Outils disponibles :',
    ...tools.map((tool) => describeTool(tool)),
  ];
  return lines.filter(Boolean).join('\n\n');
}

function describeTool(tool: BetaToolUnion): string {
  const t = tool as { name: string; description?: string; input_schema?: unknown };
  return `### ${t.name}\n${t.description ?? ''}\nSchéma de \`input\` : ${JSON.stringify(t.input_schema ?? {})}`;
}

/** Aplatit la conversation en blocs (texte et images) pour un unique message utilisateur. */
export function flattenConversation(messages: BetaMessageParam[]): Block[] {
  const blocks: Block[] = [];
  const text = (value: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'text') last.text += value;
    else blocks.push({ type: 'text', text: value });
  };
  const toolNames = new Map<string, string>();
  text('Voici la conversation jusqu’ici. Réponds en tant qu’assistant au dernier message.\n');
  for (const message of messages) {
    text(message.role === 'user' ? '\n=== Utilisateur ===\n' : '\n=== Assistant (toi) ===\n');
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    const calls: { name: string; input: unknown }[] = [];
    for (const raw of content as { type: string; [key: string]: unknown }[]) {
      if (raw.type === 'text') text(`${raw.text as string}\n`);
      else if (raw.type === 'image') blocks.push({ type: 'image', source: raw.source });
      else if (raw.type === 'tool_use') {
        toolNames.set(raw.id as string, raw.name as string);
        calls.push({ name: raw.name as string, input: raw.input });
      } else if (raw.type === 'tool_result') {
        const name = toolNames.get(raw.tool_use_id as string) ?? 'outil';
        text(`<tool_result name="${name}"${raw.is_error ? ' error="true"' : ''}>\n`);
        const inner = raw.content;
        if (typeof inner === 'string') text(`${inner}\n`);
        else if (Array.isArray(inner)) {
          for (const part of inner as { type: string; text?: string; source?: unknown }[]) {
            if (part.type === 'text') text(`${part.text ?? ''}\n`);
            else if (part.type === 'image') blocks.push({ type: 'image', source: part.source });
          }
        }
        text('</tool_result>\n');
      }
      // Les blocs de réflexion et de compaction ne sont pas rejoués.
    }
    if (calls.length) text(`${TOOL_OPEN}\n${JSON.stringify(calls)}\n${TOOL_CLOSE}\n`);
  }
  return blocks;
}

/** Sépare le texte visible des appels d'outils. Lève une erreur (non API) si le JSON est illisible. */
export function parseToolCalls(output: string): { text: string; calls: { name: string; input: unknown }[] } {
  const start = output.lastIndexOf(TOOL_OPEN);
  if (start < 0) return { text: output.trim(), calls: [] };
  const end = output.indexOf(TOOL_CLOSE, start);
  let json = output.slice(start + TOOL_OPEN.length, end < 0 ? undefined : end).trim();
  json = json
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('JSON illisible dans le bloc <tool_calls>.');
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tool_calls?: unknown }).tool_calls)
      ? (parsed as { tool_calls: unknown[] }).tool_calls
      : [parsed];
  const calls = list
    .filter(
      (c): c is { name: string; input?: unknown } => Boolean(c) && typeof (c as { name?: unknown }).name === 'string',
    )
    .map((c) => ({ name: c.name, input: c.input ?? {} }));
  return { text: output.slice(0, start).trim(), calls };
}

let callCounter = 0;

export class ClaudeCodeLlmClient implements LlmClient {
  readonly model: string;
  private readonly effort: Effort | undefined;
  private readonly timeoutMs: number;
  private readonly run: ClaudeCodeRunner;

  constructor(config: ClaudeCodeConfig = {}) {
    this.model = config.model ?? 'sonnet';
    this.effort = config.effort;
    this.timeoutMs = config.timeoutMs ?? 10 * 60_000;
    this.run = config.run ?? spawnRunner(config.command ?? defaultClaudeCommand());
  }

  async send(request: LlmRequest, handlers: LlmStreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    signal?.throwIfAborted();
    const model = request.model ?? this.model;
    const effort = request.effort ?? this.effort;
    // Dossier vide : Claude Code n'y trouve ni CLAUDE.md ni réglages de projet.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-cc-'));
    const systemFile = path.join(dir, 'system.md');
    writeFileSync(systemFile, buildSystemPrompt(request), 'utf8');
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      claudeCodeModel(model),
      '--system-prompt-file',
      systemFile,
      '--tools',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      ...(effort ? ['--effort', effort] : []),
    ];
    const stdin = `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: flattenConversation(request.messages) },
    })}\n`;

    let full = '';
    let emitted = 0;
    let result: Record<string, unknown> | null = null;
    // Diffuse le texte au fil de l'eau, sans jamais montrer le bloc d'appels d'outils.
    const flush = () => {
      if (!handlers.onText) return;
      const cut = full.indexOf(TOOL_OPEN);
      let visible = cut >= 0 ? cut : full.length;
      if (cut < 0) {
        const lt = full.lastIndexOf('<');
        if (lt >= 0 && TOOL_OPEN.startsWith(full.slice(lt))) visible = lt;
      }
      if (visible > emitted) {
        handlers.onText(full.slice(emitted, visible));
        emitted = visible;
      }
    };
    const onLine = (line: string) => {
      let event: Record<string, any>;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'stream_event') {
        const e = event.event;
        if (e?.type === 'content_block_start' && e.content_block?.type === 'thinking') handlers.onThinking?.();
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          full += e.delta.text;
          flush();
        }
      } else if (event.type === 'result') {
        result = event;
      }
    };

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let exit: { code: number; stderr: string };
    try {
      exit = await this.run(args, stdin, onLine, combined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    signal?.throwIfAborted();
    const res = result as Record<string, any> | null;
    if (!res) {
      if (timeout.aborted) throw new ClaudeCodeError('Claude Code : délai dépassé.');
      throw new ClaudeCodeError(
        `Claude Code n'a pas répondu (code ${exit.code}) : ${exit.stderr.trim().slice(0, 500)}`,
      );
    }
    if (res.is_error) throw new ClaudeCodeError(describeClaudeCodeFailure(String(res.result ?? res.subtype ?? '')));

    const output = typeof res.result === 'string' ? res.result : full;
    const { text, calls } = parseToolCalls(output);
    if (handlers.onText && emitted === 0 && text) handlers.onText(text);
    const content: BetaContentBlock[] = [];
    if (text) content.push({ type: 'text', text, citations: null } as BetaContentBlock);
    for (const call of calls) {
      content.push({
        type: 'tool_use',
        id: `toolu_cc_${Date.now()}_${++callCounter}`,
        name: call.name,
        input: call.input,
      } as BetaContentBlock);
    }
    const usage = (res.usage ?? {}) as Record<string, number>;
    const stop = res.stop_reason === 'max_tokens' || res.stop_reason === 'refusal' ? res.stop_reason : null;
    return {
      id: `msg_cc_${res.session_id ?? callCounter}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: stop ?? (calls.length ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      },
    } as unknown as BetaMessage;
  }
}

function describeClaudeCodeFailure(message: string): string {
  if (/not logged in|\/login/i.test(message)) {
    return 'Claude Code n’est pas connecté : lancez `claude auth login` puis relancez le serveur.';
  }
  if (/limit/i.test(message)) return `Limite d’usage de l’abonnement Claude atteinte : ${message}`;
  return `Claude Code : ${message}`;
}

function spawnRunner(command: string): ClaudeCodeRunner {
  const cwd = path.join(os.tmpdir(), 'forge-claude-code');
  return (args, stdin, onLine, signal) =>
    new Promise((resolve, reject) => {
      mkdirSync(cwd, { recursive: true });
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) onLine(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      const abort = () => child.kill();
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', (error) => {
        signal?.removeEventListener('abort', abort);
        reject(
          new ClaudeCodeError(
            `Impossible de lancer Claude Code (${command}) : ${error.message}. Installez-le ou définissez FORGE_CLAUDE_BIN.`,
          ),
        );
      });
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (buffer.trim()) onLine(buffer.trim());
        resolve({ code: code ?? 1, stderr });
      });
      child.stdin.end(stdin);
    });
}

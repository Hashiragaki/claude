import { promises as fs } from 'node:fs';
import {
  AiRefusalError,
  describeApiError,
  runAgent,
  type AgentTool,
  type BetaMessageParam,
  type LlmClient,
} from '@forge/ai';
import { nowIso, shortId } from '@forge/core';
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildContextBlock,
  createPlannerTools,
  handleOfflineCommand,
  plannerDigest,
} from '@forge/planner';
import type { AgentLock } from './agentLock';
import type { EventHub } from './events';
import type { PlannerService } from './plannerService';
import { createProjectTools, describeAsset, projectSummary, type ProjectToolDeps } from './projectTools';
import type { ProjectStore } from './storage';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  at: string;
  tool?: { name: string; input: unknown; ok?: boolean; result?: string };
}

export type ChatEvent =
  | { kind: 'message'; message: DisplayMessage }
  | { kind: 'delta'; id: string; delta: string }
  | { kind: 'status'; running: boolean; thinking?: boolean }
  | { kind: 'cleared' };

const API_LOG = 'chat/api.jsonl';
const DISPLAY_LOG = 'chat/display.jsonl';

const TOOL_LABELS: Record<string, string> = {
  list_tasks: 'Consultation des tâches',
  get_task: 'Lecture d\'une tâche',
  create_task: 'Création d\'une tâche',
  update_task: 'Mise à jour d\'une tâche',
  delete_task: 'Suppression d\'une tâche',
  create_milestone: 'Création d\'un jalon',
  update_milestone: 'Mise à jour d\'un jalon',
  plan_project: 'Création du plan',
  review_progress: 'Revue de l\'avancement',
  remember: 'Mémorisation',
  forget: 'Oubli d\'une note',
  get_project_summary: 'Lecture du projet',
  list_assets: 'Liste des assets',
  list_files: 'Liste des fichiers',
  read_file: 'Lecture d\'un fichier',
  write_file: 'Écriture d\'un fichier',
  validate_project: 'Vérification du projet',
  list_generators: 'Liste des générateurs',
  generate_asset: 'Génération d\'un asset',
};

export interface ChatDeps {
  store: ProjectStore;
  planners: PlannerService;
  hub: EventHub;
  llm: LlmClient | null;
  lock: AgentLock;
  toolDeps(projectId: string): Omit<ProjectToolDeps, 'aiAvailable'>;
}

/**
 * Chat de l'assistant de production. Deux journaux par projet :
 * - `chat/api.jsonl` : messages API, en ajout seul (mémoire exacte de la conversation) ;
 * - `chat/display.jsonl` : messages affichés (mises à jour par id, la dernière gagne).
 * Sans clé API, le chat interprète les commandes hors-ligne (`/tache`, `/revue`…).
 * L'exécution est protégée par `AgentLock` : le chat et le pilote automatique ne travaillent
 * jamais en même temps sur un même projet.
 */
export class ChatService {
  constructor(private readonly deps: ChatDeps) {}

  isRunning(projectId: string): boolean {
    return this.deps.lock.holder(projectId) === 'chat';
  }

  async history(projectId: string): Promise<DisplayMessage[]> {
    const lines = await this.readLines(projectId, DISPLAY_LOG);
    const byId = new Map<string, DisplayMessage>();
    for (const line of lines) {
      const msg = JSON.parse(line) as DisplayMessage;
      byId.set(msg.id, msg);
    }
    return [...byId.values()];
  }

  async clear(projectId: string): Promise<void> {
    if (this.deps.lock.holder(projectId) !== null) {
      throw Object.assign(new Error('Une réponse est en cours.'), { statusCode: 409 });
    }
    const stamp = nowIso().replace(/[:.]/g, '-');
    for (const file of [API_LOG, DISPLAY_LOG]) {
      try {
        const content = await this.deps.store.readFile(projectId, file);
        await this.deps.store.writeFile(projectId, `chat/archive/${stamp}-${file.split('/')[1]}`, content, true);
        await this.deps.store.deleteFile(projectId, file, true);
      } catch {
        // rien à archiver
      }
    }
    this.emit(projectId, { kind: 'cleared' });
  }

  stop(projectId: string): boolean {
    if (this.deps.lock.holder(projectId) !== 'chat') return false;
    return this.deps.lock.abort(projectId);
  }

  /** Traite un message utilisateur ; la réponse est diffusée par événements SSE. */
  async send(projectId: string, text: string): Promise<void> {
    const content = text.trim();
    if (!content) throw Object.assign(new Error('Message vide.'), { statusCode: 400 });
    // Lève une 409 si le chat ou le pilote automatique travaille déjà sur ce projet.
    const controller = this.deps.lock.acquire(projectId, 'chat');
    this.emit(projectId, { kind: 'status', running: true });
    try {
      await this.deps.store.readManifest(projectId);
      await this.display(projectId, { id: shortId('msg'), role: 'user', text: content, at: nowIso() });
      if (this.deps.llm) await this.runAi(projectId, content, controller.signal);
      else await this.runOffline(projectId, content);
    } catch (error) {
      const message =
        error instanceof AiRefusalError
          ? 'La demande a été refusée par le modèle. Reformulez-la autrement.'
          : controller.signal.aborted
            ? 'Réponse interrompue.'
            : describeApiError(error);
      await this.display(projectId, { id: shortId('msg'), role: 'system', text: `⚠️ ${message}`, at: nowIso() });
    } finally {
      this.deps.lock.release(projectId, controller);
      this.emit(projectId, { kind: 'status', running: false });
    }
  }

  /**
   * Ajoute un message affiché (assistant ou système) sans passer par l'IA : écrit seulement le
   * journal d'affichage et diffuse l'événement chat. Utilisé par le pilote automatique pour
   * annoncer ses actions dans le chat visible du projet.
   */
  async post(projectId: string, message: { role: 'assistant' | 'system'; text: string }): Promise<DisplayMessage> {
    const display: DisplayMessage = { id: shortId('msg'), role: message.role, text: message.text, at: nowIso() };
    await this.display(projectId, display);
    return display;
  }

  private async runOffline(projectId: string, text: string): Promise<void> {
    const planner = await this.deps.planners.get(projectId);
    const reply = handleOfflineCommand(planner, text);
    await this.display(projectId, { id: shortId('msg'), role: 'assistant', text: reply.text, at: nowIso() });
    const tools = this.deps.toolDeps(projectId);
    for (const action of reply.actions) {
      try {
        const asset = await tools.generate({ generator: action.generator, prompt: action.prompt, mode: 'procedural' });
        await this.display(projectId, { id: shortId('msg'), role: 'assistant', text: `✅ ${describeAsset(asset)}`, at: nowIso() });
      } catch (error) {
        await this.display(projectId, {
          id: shortId('msg'),
          role: 'system',
          text: `⚠️ ${error instanceof Error ? error.message : String(error)}`,
          at: nowIso(),
        });
      }
    }
  }

  private async runAi(projectId: string, text: string, signal: AbortSignal): Promise<void> {
    const llm = this.deps.llm as LlmClient;
    const planner = await this.deps.planners.get(projectId);
    const manifest = await this.deps.store.readManifest(projectId);
    const history = repairHistory(await this.apiHistory(projectId));
    for (const fix of history.appended) await this.appendApi(projectId, fix);
    const userMessage: BetaMessageParam = {
      role: 'user',
      content: [
        { type: 'text', text: buildContextBlock({ project: projectSummary(manifest), planner: plannerDigest(planner) }) },
        { type: 'text', text },
      ],
    };
    await this.appendApi(projectId, userMessage);

    const tools: AgentTool[] = [
      ...createPlannerTools(planner),
      ...createProjectTools(projectId, { ...this.deps.toolDeps(projectId), aiAvailable: true }),
    ];
    let current: DisplayMessage | null = null;
    const toolMessages = new Map<string, DisplayMessage>();
    const writes: Promise<unknown>[] = [];

    const finishCurrent = () => {
      if (current) writes.push(this.display(projectId, current, false));
      current = null;
    };

    await runAgent({
      llm,
      system: [{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT }],
      messages: [...history.messages, userMessage],
      tools,
      compaction: true,
      signal,
      meta: { role: 'chat', projectId },
      onEvent: (event) => {
        switch (event.type) {
          case 'thinking':
            this.emit(projectId, { kind: 'status', running: true, thinking: true });
            break;
          case 'text':
            if (!current) {
              current = { id: shortId('msg'), role: 'assistant', text: '', at: nowIso() };
              this.emit(projectId, { kind: 'message', message: { ...current } });
            }
            current.text += event.delta;
            this.emit(projectId, { kind: 'delta', id: current.id, delta: event.delta });
            break;
          case 'tool_start': {
            finishCurrent();
            const msg: DisplayMessage = {
              id: shortId('msg'),
              role: 'tool',
              text: TOOL_LABELS[event.name] ?? event.name,
              at: nowIso(),
              tool: { name: event.name, input: event.input },
            };
            toolMessages.set(event.id, msg);
            writes.push(this.display(projectId, msg));
            break;
          }
          case 'tool_end': {
            const msg = toolMessages.get(event.id);
            if (msg?.tool) {
              msg.tool.ok = event.ok;
              msg.tool.result = event.result.slice(0, 4000);
              writes.push(this.display(projectId, msg));
            }
            break;
          }
          case 'message':
            writes.push(this.appendApi(projectId, event.message));
            break;
          case 'done':
            finishCurrent();
            break;
        }
      },
    });
    await Promise.all(writes);
  }

  private async apiHistory(projectId: string): Promise<BetaMessageParam[]> {
    return (await this.readLines(projectId, API_LOG)).map((l) => JSON.parse(l) as BetaMessageParam);
  }

  private async readLines(projectId: string, file: string): Promise<string[]> {
    try {
      return (await this.deps.store.readText(projectId, file)).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private appendLine(projectId: string, file: string, value: unknown): Promise<void> {
    return fs.appendFile(this.deps.store.resolve(projectId, file), `${JSON.stringify(value)}\n`).catch(async () => {
      await this.deps.store.writeFile(projectId, file, `${JSON.stringify(value)}\n`, true);
    });
  }

  private appendApi(projectId: string, message: BetaMessageParam): Promise<void> {
    return this.appendLine(projectId, API_LOG, message);
  }

  /** Enregistre (et diffuse) un message affiché. */
  private async display(projectId: string, message: DisplayMessage, publish = true): Promise<void> {
    await this.appendLine(projectId, DISPLAY_LOG, message);
    if (publish) this.emit(projectId, { kind: 'message', message: { ...message, tool: message.tool && { ...message.tool } } });
  }

  private emit(projectId: string, event: ChatEvent): void {
    this.deps.hub.publish(projectId, { type: 'chat', data: event });
  }
}

/**
 * Rend l'historique valide sans le réécrire : si le dernier message de l'assistant contient des
 * appels d'outils sans résultat (réponse interrompue), on ajoute des résultats d'erreur.
 */
export function repairHistory(messages: BetaMessageParam[]): { messages: BetaMessageParam[]; appended: BetaMessageParam[] } {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return { messages, appended: [] };
  const calls = last.content.filter((b) => b.type === 'tool_use') as { id: string }[];
  if (!calls.length) return { messages, appended: [] };
  const fix: BetaMessageParam = {
    role: 'user',
    content: calls.map((c) => ({
      type: 'tool_result' as const,
      tool_use_id: c.id,
      is_error: true,
      content: 'Interrompu avant la fin de l\'exécution.',
    })),
  };
  return { messages: [...messages, fix], appended: [fix] };
}

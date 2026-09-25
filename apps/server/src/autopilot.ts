import { promises as fs } from 'node:fs';
import {
  defineTool,
  describeApiError,
  runAgent,
  type AgentTool,
  type BetaMessageParam,
  type LlmClient,
} from '@forge/ai';
import { nowIso } from '@forge/core';
import {
  AUTOPILOT_SYSTEM_PROMPT,
  buildContextBlock,
  createPlannerTools,
  plannerDigest,
  type Task,
} from '@forge/planner';
import { z } from 'zod';
import type { AgentLock } from './agentLock';
import type { ChatService } from './chat';
import type { EventHub } from './events';
import { createModeRegistry } from './modes';
import type { PlannerService } from './plannerService';
import { createProjectTools, projectSummary, type ProjectToolDeps } from './projectTools';
import { Mutex, type ProjectStore } from './storage';

/** Registre des modes, utilisé uniquement pour retrouver le guide IA (`aiGuide`) d'un projet. */
const MODES = createModeRegistry();

/** Journal (en ajout seul) de la conversation du pilote automatique pour une tâche donnée. */
const taskLogPath = (taskId: string) => `chat/autopilot/${taskId}.jsonl`;

/** Outils de planification que le pilote automatique n'a pas le droit d'utiliser : il réalise la
 * tâche confiée, il ne réorganise pas le planning. */
const EXCLUDED_PLANNER_TOOLS = new Set(['plan_project', 'delete_task', 'create_milestone', 'forget', 'create_task']);

export interface AutopilotStatus {
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  /** Ids des tâches terminées pendant l'exécution en cours / la dernière exécution. */
  completed: string[];
  /** Ids des tâches signalées bloquées. */
  blocked: string[];
  maxTasks: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export interface AutopilotDeps {
  store: ProjectStore;
  planners: PlannerService;
  hub: EventHub;
  chat: ChatService;
  lock: AgentLock;
  llm: LlmClient | null;
  toolDeps(projectId: string): Omit<ProjectToolDeps, 'aiAvailable'>;
}

interface TaskOutcome {
  kind: 'done' | 'blocked';
  note: string;
}

function emptyStatus(maxTasks = 5): AutopilotStatus {
  return {
    running: false,
    currentTaskId: null,
    currentTaskTitle: null,
    completed: [],
    blocked: [],
    maxTasks,
    startedAt: null,
    finishedAt: null,
    lastError: null,
  };
}

function cloneStatus(status: AutopilotStatus): AutopilotStatus {
  return { ...status, completed: [...status.completed], blocked: [...status.blocked] };
}

/**
 * Pilote automatique : enchaîne, dans l'ordre du planning, les tâches confiées à l'IA
 * (`assignee: 'ai'`), une par une, jusqu'à `maxTasks` ou jusqu'à épuisement des tâches actionnables.
 * Tourne en tâche de fond (jamais dans la `JobQueue`, qui serait bloquée par `generate_asset`
 * attendant justement un job). Un seul agent (chat ou pilote) travaille à la fois sur un projet :
 * voir `AgentLock`.
 */
export class AutopilotService {
  private readonly statuses = new Map<string, AutopilotStatus>();
  /** Sérialise les écritures du journal d'une tâche : `runAgent` peut émettre plusieurs
   * messages consécutifs sans attendre l'écriture précédente, et deux ajouts concurrents au
   * même fichier peuvent se marcher dessus (le repli non atomique de `fs.appendFile` recrée le
   * fichier via un nom temporaire qui peut entrer en collision entre deux écritures simultanées). */
  private readonly logMutexes = new Map<string, Mutex>();

  constructor(private readonly deps: AutopilotDeps) {}

  status(projectId: string): AutopilotStatus {
    const current = this.statuses.get(projectId);
    return current ? cloneStatus(current) : emptyStatus();
  }

  /** Lance le pilote en arrière-plan et renvoie l'état immédiatement. */
  start(projectId: string, options: { maxTasks?: number } = {}): AutopilotStatus {
    const promise = this.run(projectId, options);
    // La boucle gère elle-même ses erreurs ; on évite seulement un rejet non observé.
    promise.catch(() => undefined);
    return this.status(projectId);
  }

  stop(projectId: string): AutopilotStatus {
    // N'interrompt que le pilote : si le chat détient le verrou, on ne touche pas à sa réponse.
    if (this.deps.lock.holder(projectId) === 'autopilot') this.deps.lock.abort(projectId);
    return this.status(projectId);
  }

  /** Lance (et attend) une exécution du pilote. Utilisé par `start` et directement par les tests. */
  run(projectId: string, options: { maxTasks?: number } = {}): Promise<AutopilotStatus> {
    if (!this.deps.llm) throw Object.assign(new Error("L'assistant IA n'est pas configuré."), { statusCode: 400 });
    const maxTasks = Math.min(20, Math.max(1, Math.round(options.maxTasks ?? 5)));
    // Lève une 409 (message selon le détenteur) si le chat ou le pilote travaille déjà.
    const controller = this.deps.lock.acquire(projectId, 'autopilot');
    return this.loop(projectId, maxTasks, controller);
  }

  private async loop(projectId: string, maxTasks: number, controller: AbortController): Promise<AutopilotStatus> {
    const status: AutopilotStatus = { ...emptyStatus(maxTasks), running: true, startedAt: nowIso() };
    this.statuses.set(projectId, status);
    this.publish(projectId, status);
    try {
      const attempted = new Set<string>();
      while (status.completed.length + status.blocked.length < maxTasks) {
        if (controller.signal.aborted) break;
        const planner = await this.deps.planners.get(projectId);
        const task = planner.nextActions(50, { assignee: 'ai' }).find((t) => !attempted.has(t.id));
        if (!task) break;
        attempted.add(task.id);
        if (controller.signal.aborted) break;

        status.currentTaskId = task.id;
        status.currentTaskTitle = task.title;
        this.publish(projectId, status);

        planner.updateTask(task.id, { status: 'in_progress' }, 'ai', 'Prise en charge par le pilote automatique.');
        await this.deps.planners.flush(projectId);
        await this.deps.chat.post(projectId, {
          role: 'assistant',
          text: `🤖 Pilote automatique : je commence « ${task.title} »`,
        });

        let outcome: TaskOutcome | null;
        try {
          outcome = await this.runTask(projectId, task, controller.signal);
        } catch (error) {
          const message = describeApiError(error);
          status.lastError = message;
          planner.updateTask(task.id, { status: 'blocked' }, 'ai', message);
          status.blocked.push(task.id);
          await this.deps.chat.post(projectId, {
            role: 'system',
            text: `🤖 Pilote automatique : « ${task.title} » bloquée — ${message}`,
          });
          this.publish(projectId, status);
          break; // Erreur d'API : on arrête la boucle plutôt que d'enchaîner sur du sable.
        }

        await this.concludeTask(projectId, task, outcome, status);
        status.currentTaskId = null;
        status.currentTaskTitle = null;
        this.publish(projectId, status);
      }
    } finally {
      status.running = false;
      status.finishedAt = nowIso();
      status.currentTaskId = null;
      status.currentTaskTitle = null;
      this.deps.lock.release(projectId, controller);
      this.publish(projectId, status);
    }
    return cloneStatus(status);
  }

  /** Détermine et applique l'issue d'une tâche à partir du résultat de l'agent. */
  private async concludeTask(
    projectId: string,
    task: Task,
    outcome: TaskOutcome | null,
    status: AutopilotStatus,
  ): Promise<void> {
    const planner = await this.deps.planners.get(projectId);
    const finalTask = planner.requireTask(task.id);
    if (outcome?.kind === 'done' || finalTask.status === 'done') {
      const note = outcome?.kind === 'done' ? outcome.note : undefined;
      if (finalTask.status !== 'done') planner.updateTask(task.id, { status: 'done' }, 'ai', note);
      else if (note) planner.addLog(task.id, note, 'ai');
      status.completed.push(task.id);
      await this.deps.chat.post(projectId, {
        role: 'assistant',
        text: `🤖 Pilote automatique : « ${task.title} » terminée.`,
      });
      return;
    }
    const note = outcome?.kind === 'blocked' ? outcome.note : 'Aucune conclusion du pilote automatique.';
    planner.updateTask(task.id, { status: 'blocked' }, 'ai', note);
    status.blocked.push(task.id);
    await this.deps.chat.post(projectId, {
      role: 'assistant',
      text: `🤖 Pilote automatique : « ${task.title} » bloquée — ${note}`,
    });
  }

  /** Fait tourner l'agent sur une tâche unique ; renvoie l'issue déclarée par `complete_task` /
   * `report_blocked`, ou `null` si l'agent s'est arrêté sans conclure. */
  private async runTask(projectId: string, task: Task, signal: AbortSignal): Promise<TaskOutcome | null> {
    const planner = await this.deps.planners.get(projectId);
    const manifest = await this.deps.store.readManifest(projectId);
    const instruction = [
      `Tâche à réaliser : [${task.id}] ${task.title}`,
      task.description ? `Description : ${task.description}` : '',
      task.tags.length ? `Tags : ${task.tags.join(', ')}` : '',
      task.links.length
        ? `Liens : ${task.links.map((l) => `${l.kind}:${l.ref}${l.label ? ` (${l.label})` : ''}`).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const aiGuide = MODES.get(manifest.mode).aiGuide;
    const userMessage: BetaMessageParam = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildContextBlock({
            project: projectSummary(manifest),
            planner: plannerDigest(planner),
            extra: aiGuide ? `## Guide du mode\n${aiGuide}` : undefined,
          }),
        },
        { type: 'text', text: instruction },
      ],
    };

    let outcome: TaskOutcome | null = null;
    const tools: AgentTool[] = [
      ...createPlannerTools(planner).filter((t) => !EXCLUDED_PLANNER_TOOLS.has(t.name)),
      ...createProjectTools(projectId, { ...this.deps.toolDeps(projectId), aiAvailable: true }),
      defineTool({
        name: 'complete_task',
        description: 'Marque la tâche en cours comme terminée, avec un résumé factuel de ce qui a été fait.',
        schema: z.object({ summary: z.string().min(1) }),
        run: ({ summary }) => {
          outcome = { kind: 'done', note: summary };
          return 'Tâche marquée comme terminée.';
        },
      }),
      defineTool({
        name: 'report_blocked',
        description:
          'Signale que la tâche ne peut pas être terminée maintenant (information manquante, décision humaine ' +
          'requise…), avec la raison précise.',
        schema: z.object({ reason: z.string().min(1) }),
        run: ({ reason }) => {
          outcome = { kind: 'blocked', note: reason };
          return 'Tâche signalée comme bloquée.';
        },
      }),
    ];

    const writes: Promise<unknown>[] = [this.appendTaskLog(projectId, task.id, userMessage)];
    await runAgent({
      llm: this.deps.llm as LlmClient,
      system: AUTOPILOT_SYSTEM_PROMPT,
      messages: [userMessage],
      tools,
      maxIterations: 20,
      signal,
      meta: { role: 'autopilot', projectId, label: task.id },
      onEvent: (event) => {
        if (event.type === 'message') writes.push(this.appendTaskLog(projectId, task.id, event.message));
      },
    });
    await Promise.all(writes);
    this.logMutexes.delete(`${projectId}/${task.id}`);
    return outcome;
  }

  private appendTaskLog(projectId: string, taskId: string, value: unknown): Promise<void> {
    const key = `${projectId}/${taskId}`;
    let mutex = this.logMutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.logMutexes.set(key, mutex);
    }
    const file = taskLogPath(taskId);
    return mutex.run(() =>
      fs.appendFile(this.deps.store.resolve(projectId, file), `${JSON.stringify(value)}\n`).catch(async () => {
        await this.deps.store.writeFile(projectId, file, `${JSON.stringify(value)}\n`, true);
      }),
    );
  }

  private publish(projectId: string, status: AutopilotStatus): void {
    this.deps.hub.publish(projectId, { type: 'autopilot', data: cloneStatus(status) });
  }
}

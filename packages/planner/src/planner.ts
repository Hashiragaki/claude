import { shortId } from '@forge/core';
import { addDays, addMonths, daysBetween, toDateString } from './dates';
import {
  PRIORITY_WEIGHT,
  PlannerDataSchema,
  type LogEntry,
  type MemoryNote,
  type Milestone,
  type PlannerData,
  type Priority,
  type Recurrence,
  type Task,
  type TaskLink,
  type TaskStatus,
} from './model';

export type Actor = LogEntry['by'];

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  milestoneId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  dependsOn?: string[];
  tags?: string[];
  assignee?: 'user' | 'ai';
  links?: TaskLink[];
  recurrence?: Recurrence | null;
}

export type TaskPatch = Partial<TaskInput>;

export interface MilestoneInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  status?: Milestone['status'];
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  /** `null` : tâches sans jalon. */
  milestoneId?: string | null;
  tag?: string;
  assignee?: 'user' | 'ai';
  search?: string;
}

/** Plan en bloc (typiquement proposé par l'IA) : jalons et tâches, dépendances par titre. */
export interface PlanInput {
  milestones: {
    title: string;
    description?: string;
    dueDate?: string;
    tasks: (Omit<TaskInput, 'dependsOn' | 'milestoneId'> & { dependsOnTitles?: string[] })[];
  }[];
}

export interface MilestoneProgress {
  milestone: Milestone;
  total: number;
  done: number;
  ratio: number;
  estimateHours: number;
  remainingHours: number;
}

export interface PlannerReview {
  date: string;
  stats: ReturnType<Planner['stats']>;
  completedLast7Days: Task[];
  inProgress: Task[];
  overdue: Task[];
  upcoming: Task[];
  blocked: Task[];
  next: Task[];
  milestones: MilestoneProgress[];
}

export interface PlannerOptions {
  now?: () => Date;
  idGenerator?: (prefix: string) => string;
}

const OPEN: TaskStatus[] = ['todo', 'in_progress', 'blocked'];

/**
 * Planificateur long terme d'un projet : jalons, tâches avec dépendances, journal, récurrence,
 * mémoire du projet et requêtes (prochaines actions, retards, revue). Toutes les modifications
 * passent par cette classe, qui valide les données (dépendances existantes, pas de cycle).
 */
export class Planner {
  private state: PlannerData;
  private readonly listeners = new Set<(reason: string) => void>();
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;

  constructor(data?: unknown, options: PlannerOptions = {}) {
    this.state = PlannerDataSchema.parse(data ?? {});
    this.now = options.now ?? (() => new Date());
    this.newId = options.idGenerator ?? ((prefix) => shortId(prefix, 6));
  }

  get data(): PlannerData {
    return structuredClone(this.state);
  }

  toJSON(): PlannerData {
    return this.data;
  }

  today(): string {
    return toDateString(this.now());
  }

  onChange(listener: (reason: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(reason: string): void {
    this.state.updatedAt = this.now().toISOString();
    for (const l of this.listeners) l(reason);
  }

  // -------------------------------------------------------------------------
  // Tâches
  // -------------------------------------------------------------------------

  getTask(id: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  requireTask(id: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Tâche introuvable : ${id}`);
    return task;
  }

  /** Trouve une tâche par id ou par titre (insensible à la casse). */
  findTask(ref: string): Task | undefined {
    const lower = ref.trim().toLowerCase();
    return this.getTask(ref) ?? this.state.tasks.find((t) => t.title.toLowerCase() === lower);
  }

  listTasks(filter: TaskFilter = {}): Task[] {
    const statuses = filter.status === undefined ? null : Array.isArray(filter.status) ? filter.status : [filter.status];
    const search = filter.search?.toLowerCase();
    return this.state.tasks
      .filter((t) => !statuses || statuses.includes(t.status))
      .filter((t) => filter.milestoneId === undefined || (t.milestoneId ?? null) === filter.milestoneId)
      .filter((t) => !filter.tag || t.tags.includes(filter.tag))
      .filter((t) => !filter.assignee || t.assignee === filter.assignee)
      .filter((t) => !search || `${t.title} ${t.description}`.toLowerCase().includes(search))
      .sort((a, b) => a.order - b.order);
  }

  createTask(input: TaskInput, by: Actor = 'user'): Task {
    const title = input.title.trim();
    if (!title) throw new Error('Le titre de la tâche est obligatoire.');
    const now = this.now().toISOString();
    const id = this.newId('t');
    if (input.milestoneId) this.requireMilestone(input.milestoneId);
    const dependsOn = this.checkDependencies(id, input.dependsOn ?? []);
    const status = input.status ?? 'todo';
    const task: Task = {
      id,
      title,
      description: input.description ?? '',
      status,
      priority: input.priority ?? 'medium',
      ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.estimateHours != null ? { estimateHours: input.estimateHours } : {}),
      dependsOn,
      tags: input.tags ?? [],
      assignee: input.assignee ?? 'user',
      links: input.links ?? [],
      log: [{ at: now, by, text: 'Tâche créée.' }],
      ...(input.recurrence ? { recurrence: input.recurrence } : {}),
      order: this.nextOrder(status),
      createdAt: now,
      updatedAt: now,
      ...(status === 'done' ? { completedAt: now } : {}),
    };
    this.state.tasks.push(task);
    this.changed('task-created');
    return structuredClone(task);
  }

  updateTask(id: string, patch: TaskPatch, by: Actor = 'user', note?: string): Task {
    const task = this.requireTask(id);
    const now = this.now().toISOString();
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error('Le titre de la tâche est obligatoire.');
      if (title !== task.title) changes.push(`titre → « ${title} »`);
      task.title = title;
    }
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.priority !== undefined && patch.priority !== task.priority) {
      changes.push(`priorité → ${patch.priority}`);
      task.priority = patch.priority;
    }
    if (patch.milestoneId !== undefined) {
      if (patch.milestoneId) this.requireMilestone(patch.milestoneId);
      setOptional(task, 'milestoneId', patch.milestoneId);
    }
    if (patch.startDate !== undefined) setOptional(task, 'startDate', patch.startDate);
    if (patch.dueDate !== undefined) {
      if ((patch.dueDate ?? undefined) !== task.dueDate) changes.push(`échéance → ${patch.dueDate ?? 'aucune'}`);
      setOptional(task, 'dueDate', patch.dueDate);
    }
    if (patch.estimateHours !== undefined) setOptional(task, 'estimateHours', patch.estimateHours);
    if (patch.dependsOn !== undefined) task.dependsOn = this.checkDependencies(task.id, patch.dependsOn);
    if (patch.tags !== undefined) task.tags = patch.tags;
    if (patch.assignee !== undefined) task.assignee = patch.assignee;
    if (patch.links !== undefined) task.links = patch.links;
    if (patch.recurrence !== undefined) setOptional(task, 'recurrence', patch.recurrence);
    let spawned: Task | null = null;
    if (patch.status !== undefined && patch.status !== task.status) {
      changes.push(`statut → ${patch.status}`);
      spawned = this.applyStatus(task, patch.status, now, by);
    }
    task.updatedAt = now;
    if (changes.length || note) {
      task.log.push({ at: now, by, text: [changes.join(', '), note].filter(Boolean).join(' — ') });
    }
    this.changed(spawned ? 'task-recurred' : 'task-updated');
    return structuredClone(task);
  }

  setStatus(id: string, status: TaskStatus, by: Actor = 'user', note?: string): Task {
    return this.updateTask(id, { status }, by, note);
  }

  private applyStatus(task: Task, status: TaskStatus, now: string, by: Actor): Task | null {
    task.status = status;
    task.order = this.nextOrder(status);
    if (status !== 'done') {
      delete task.completedAt;
      return null;
    }
    task.completedAt = now;
    if (!task.recurrence) return null;
    // Tâche récurrente : on crée l'occurrence suivante.
    const base = task.dueDate ?? this.today();
    const due =
      task.recurrence.unit === 'month'
        ? addMonths(base, task.recurrence.every)
        : addDays(base, task.recurrence.every * (task.recurrence.unit === 'week' ? 7 : 1));
    const next: Task = {
      ...structuredClone(task),
      id: this.newId('t'),
      status: 'todo',
      dueDate: due,
      log: [{ at: now, by, text: `Occurrence suivante de « ${task.title} ».` }],
      order: this.nextOrder('todo'),
      createdAt: now,
      updatedAt: now,
    };
    delete next.completedAt;
    this.state.tasks.push(next);
    return next;
  }

  deleteTask(id: string): void {
    this.requireTask(id);
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    for (const t of this.state.tasks) t.dependsOn = t.dependsOn.filter((d) => d !== id);
    this.changed('task-deleted');
  }

  /** Déplace une tâche dans une colonne du Kanban, à la position `index`. */
  moveTask(id: string, status: TaskStatus, index: number, by: Actor = 'user'): Task {
    const task = this.requireTask(id);
    if (task.status !== status) this.updateTask(id, { status }, by);
    const column = this.listTasks({ status }).filter((t) => t.id !== id);
    column.splice(Math.max(0, Math.min(index, column.length)), 0, task);
    column.forEach((t, i) => {
      const stored = this.requireTask(t.id);
      stored.order = i;
    });
    this.changed('task-moved');
    return structuredClone(this.requireTask(id));
  }

  addLog(id: string, text: string, by: Actor = 'user'): Task {
    const task = this.requireTask(id);
    const now = this.now().toISOString();
    task.log.push({ at: now, by, text });
    task.updatedAt = now;
    this.changed('task-log');
    return structuredClone(task);
  }

  private nextOrder(status: TaskStatus): number {
    const orders = this.state.tasks.filter((t) => t.status === status).map((t) => t.order);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }

  /** Vérifie que les dépendances existent et ne créent pas de cycle. */
  private checkDependencies(taskId: string, deps: string[]): string[] {
    const unique = [...new Set(deps)];
    for (const dep of unique) {
      if (dep === taskId) throw new Error('Une tâche ne peut pas dépendre d\'elle-même.');
      if (!this.getTask(dep)) throw new Error(`Dépendance introuvable : ${dep}`);
      if (this.dependsTransitively(dep, taskId)) {
        throw new Error(`Dépendance circulaire : ${dep} dépend déjà (indirectement) de ${taskId}.`);
      }
    }
    return unique;
  }

  private dependsTransitively(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const task = this.getTask(from);
    return task ? task.dependsOn.some((d) => this.dependsTransitively(d, target, seen)) : false;
  }

  // -------------------------------------------------------------------------
  // Jalons
  // -------------------------------------------------------------------------

  listMilestones(): Milestone[] {
    return [...this.state.milestones].sort((a, b) => a.order - b.order);
  }

  getMilestone(id: string): Milestone | undefined {
    return this.state.milestones.find((m) => m.id === id);
  }

  requireMilestone(id: string): Milestone {
    const m = this.getMilestone(id);
    if (!m) throw new Error(`Jalon introuvable : ${id}`);
    return m;
  }

  findMilestone(ref: string): Milestone | undefined {
    const lower = ref.trim().toLowerCase();
    return this.getMilestone(ref) ?? this.state.milestones.find((m) => m.title.toLowerCase() === lower);
  }

  createMilestone(input: MilestoneInput): Milestone {
    const title = input.title.trim();
    if (!title) throw new Error('Le titre du jalon est obligatoire.');
    const now = this.now().toISOString();
    const milestone: Milestone = {
      id: this.newId('m'),
      title,
      description: input.description ?? '',
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      status: input.status ?? 'planned',
      order: this.state.milestones.length,
      createdAt: now,
      updatedAt: now,
    };
    this.state.milestones.push(milestone);
    this.changed('milestone-created');
    return structuredClone(milestone);
  }

  updateMilestone(id: string, patch: Partial<MilestoneInput>): Milestone {
    const m = this.requireMilestone(id);
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new Error('Le titre du jalon est obligatoire.');
      m.title = patch.title.trim();
    }
    if (patch.description !== undefined) m.description = patch.description;
    if (patch.dueDate !== undefined) setOptional(m, 'dueDate', patch.dueDate);
    if (patch.status !== undefined) m.status = patch.status;
    m.updatedAt = this.now().toISOString();
    this.changed('milestone-updated');
    return structuredClone(m);
  }

  /** Supprime un jalon ; ses tâches sont détachées (ou supprimées si `deleteTasks`). */
  deleteMilestone(id: string, options: { deleteTasks?: boolean } = {}): void {
    this.requireMilestone(id);
    this.state.milestones = this.state.milestones.filter((m) => m.id !== id);
    if (options.deleteTasks) {
      for (const t of this.state.tasks.filter((x) => x.milestoneId === id)) this.deleteTask(t.id);
    } else {
      for (const t of this.state.tasks) if (t.milestoneId === id) delete t.milestoneId;
    }
    this.changed('milestone-deleted');
  }

  milestoneProgress(id: string): MilestoneProgress {
    const milestone = this.requireMilestone(id);
    const tasks = this.state.tasks.filter((t) => t.milestoneId === id && t.status !== 'cancelled');
    const done = tasks.filter((t) => t.status === 'done');
    const hours = (list: Task[]) => list.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
    return {
      milestone: structuredClone(milestone),
      total: tasks.length,
      done: done.length,
      ratio: tasks.length ? done.length / tasks.length : 0,
      estimateHours: hours(tasks),
      remainingHours: hours(tasks.filter((t) => t.status !== 'done')),
    };
  }

  // -------------------------------------------------------------------------
  // Mémoire du projet
  // -------------------------------------------------------------------------

  remember(text: string, tags: string[] = []): MemoryNote {
    const clean = text.trim();
    if (!clean) throw new Error('La note est vide.');
    const note: MemoryNote = { id: this.newId('n'), at: this.now().toISOString(), text: clean, tags };
    this.state.memory.push(note);
    this.changed('memory-added');
    return structuredClone(note);
  }

  forget(id: string): void {
    const before = this.state.memory.length;
    this.state.memory = this.state.memory.filter((n) => n.id !== id);
    if (this.state.memory.length === before) throw new Error(`Note introuvable : ${id}`);
    this.changed('memory-removed');
  }

  listMemory(): MemoryNote[] {
    return structuredClone(this.state.memory);
  }

  // -------------------------------------------------------------------------
  // Requêtes
  // -------------------------------------------------------------------------

  /** Dépendances non terminées d'une tâche. */
  blockingTasks(id: string): Task[] {
    return this.requireTask(id)
      .dependsOn.map((d) => this.getTask(d))
      .filter((t): t is Task => Boolean(t) && t!.status !== 'done' && t!.status !== 'cancelled');
  }

  isActionable(task: Task): boolean {
    return (task.status === 'todo' || task.status === 'in_progress') && this.blockingTasks(task.id).length === 0;
  }

  /** Prochaines actions : en cours d'abord, puis par priorité, échéance et ordre. */
  nextActions(limit = 5): Task[] {
    return this.state.tasks
      .filter((t) => this.isActionable(t))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
        const p = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
        if (p) return p;
        const da = a.dueDate ?? '9999-12-31';
        const db = b.dueDate ?? '9999-12-31';
        return da === db ? a.order - b.order : da.localeCompare(db);
      })
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }

  overdue(): Task[] {
    const today = this.today();
    return this.state.tasks.filter((t) => OPEN.includes(t.status) && t.dueDate && t.dueDate < today);
  }

  upcoming(days = 7): Task[] {
    const today = this.today();
    const limit = addDays(today, days);
    return this.state.tasks
      .filter((t) => OPEN.includes(t.status) && t.dueDate && t.dueDate >= today && t.dueDate <= limit)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }

  stats() {
    const byStatus: Record<TaskStatus, number> = { todo: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0 };
    let estimate = 0;
    let doneEstimate = 0;
    for (const t of this.state.tasks) {
      byStatus[t.status]++;
      if (t.status === 'cancelled') continue;
      estimate += t.estimateHours ?? 0;
      if (t.status === 'done') doneEstimate += t.estimateHours ?? 0;
    }
    const active = this.state.tasks.length - byStatus.cancelled;
    return {
      total: this.state.tasks.length,
      byStatus,
      estimateHours: estimate,
      doneHours: doneEstimate,
      percent: active ? Math.round((byStatus.done / active) * 100) : 0,
    };
  }

  /** Revue de l'avancement (quotidienne/hebdomadaire). */
  review(): PlannerReview {
    const today = this.today();
    const weekAgo = addDays(today, -7);
    return {
      date: today,
      stats: this.stats(),
      completedLast7Days: this.state.tasks.filter(
        (t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) >= weekAgo,
      ),
      inProgress: this.listTasks({ status: 'in_progress' }),
      overdue: this.overdue(),
      upcoming: this.upcoming(7),
      blocked: this.state.tasks.filter(
        (t) => t.status === 'blocked' || (t.status === 'todo' && this.blockingTasks(t.id).length > 0),
      ),
      next: this.nextActions(5),
      milestones: this.listMilestones().map((m) => this.milestoneProgress(m.id)),
    };
  }

  /** Nombre de jours avant l'échéance (négatif si dépassée). */
  daysUntilDue(task: Task): number | null {
    return task.dueDate ? daysBetween(this.today(), task.dueDate) : null;
  }

  // -------------------------------------------------------------------------
  // Plan en bloc
  // -------------------------------------------------------------------------

  /**
   * Crée des jalons et leurs tâches en une fois. Les dépendances sont exprimées par titre
   * (tâches du plan ou tâches existantes). Tout est validé avant la moindre écriture.
   */
  applyPlan(plan: PlanInput, by: Actor = 'ai'): { milestones: Milestone[]; tasks: Task[] } {
    const titles = new Set<string>();
    for (const m of plan.milestones) {
      for (const t of m.tasks) titles.add(t.title.trim().toLowerCase());
    }
    for (const m of plan.milestones) {
      for (const t of m.tasks) {
        for (const dep of t.dependsOnTitles ?? []) {
          const key = dep.trim().toLowerCase();
          if (!titles.has(key) && !this.findTask(dep)) throw new Error(`Dépendance inconnue dans le plan : « ${dep} »`);
        }
      }
    }
    const snapshot = structuredClone(this.state);
    try {
      const createdMilestones: Milestone[] = [];
      const createdTasks: Task[] = [];
      const idByTitle = new Map<string, string>();
      const pending: { id: string; deps: string[] }[] = [];
      for (const m of plan.milestones) {
        const milestone = this.createMilestone({ title: m.title, description: m.description, dueDate: m.dueDate });
        createdMilestones.push(milestone);
        for (const t of m.tasks) {
          const { dependsOnTitles, ...rest } = t;
          const task = this.createTask({ ...rest, milestoneId: milestone.id }, by);
          idByTitle.set(task.title.toLowerCase(), task.id);
          pending.push({ id: task.id, deps: dependsOnTitles ?? [] });
          createdTasks.push(task);
        }
      }
      for (const { id, deps } of pending) {
        if (!deps.length) continue;
        const ids = deps.map((d) => idByTitle.get(d.trim().toLowerCase()) ?? this.findTask(d)!.id);
        const updated = this.updateTask(id, { dependsOn: ids }, by);
        const index = createdTasks.findIndex((t) => t.id === id);
        createdTasks[index] = updated;
      }
      return { milestones: createdMilestones, tasks: createdTasks };
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}

function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value === null || value === undefined || value === '') delete target[key];
  else target[key] = value;
}

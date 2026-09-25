import { addDays, addWorkDays, maxDate } from './dates';
import { PRIORITY_WEIGHT, type Task, type TaskStatus } from './model';

export interface ScheduleOptions {
  /** Date de début du planning (aujourd'hui en général). */
  start: string;
  /** Heures de travail disponibles par jour pour l'utilisateur. */
  hoursPerDay?: number;
  /** Estimation par défaut d'une tâche sans estimation. */
  defaultHours?: number;
  skipWeekends?: boolean;
  includeDone?: boolean;
}

export interface ScheduledTask {
  id: string;
  title: string;
  status: TaskStatus;
  milestoneId?: string;
  assignee: 'user' | 'ai';
  /** Premier jour (inclus). */
  start: string;
  /** Dernier jour (inclus). */
  end: string;
  days: number;
  dueDate?: string;
  /** La fin prévue dépasse l'échéance. */
  late: boolean;
}

export interface Schedule {
  items: ScheduledTask[];
  start: string;
  end: string;
}

/** Heures de travail par jour utilisées quand `hoursPerDay` est absent, non fini ou ≤ 0. */
const DEFAULT_HOURS_PER_DAY = 4;

/**
 * Nombre maximal de jours qu'une tâche peut occuper dans le planning. Borne de sécurité : sans
 * elle, un `hoursPerDay` minuscule ou une estimation énorme ferait avancer `addWorkDays` jour par
 * jour un nombre de fois arbitrairement grand (ou l'appellerait avec `Infinity`, qui ne se
 * termine jamais), bloquant tout le serveur (boucle synchrone dans l'event loop Node).
 */
const MAX_TASK_DAYS = 3650;

/**
 * Planning prévisionnel (diagramme de Gantt) : ordonnancement par liste.
 * L'utilisateur réalise une tâche à la fois (capacité `hoursPerDay`) ; les tâches confiées à
 * l'IA peuvent se dérouler en parallèle. Une tâche commence après ses dépendances.
 */
export function scheduleTasks(tasks: Task[], options: ScheduleOptions): Schedule {
  // Un `hoursPerDay` non fini (NaN, Infinity) ou ≤ 0 rendrait `days` infini ou négatif plus bas ;
  // on retombe alors sur la valeur par défaut documentée plutôt que de boucler indéfiniment.
  const hoursPerDay =
    Number.isFinite(options.hoursPerDay) && (options.hoursPerDay as number) > 0
      ? (options.hoursPerDay as number)
      : DEFAULT_HOURS_PER_DAY;
  const defaultHours = options.defaultHours ?? 2;
  const addDuration = (from: string, days: number) =>
    options.skipWeekends ? addWorkDays(from, days - 1) : addDays(from, days - 1);
  const nextDay = (d: string) => (options.skipWeekends ? addWorkDays(d, 1) : addDays(d, 1));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const endById = new Map<string, string>();
  const items: ScheduledTask[] = [];

  // Les tâches terminées sont placées à leur date de fin.
  for (const t of tasks) {
    if (t.status !== 'done') continue;
    const day = (t.completedAt ?? t.updatedAt).slice(0, 10);
    endById.set(t.id, day);
    if (options.includeDone) items.push(item(t, day, day, 1));
  }

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const remaining = new Set(open.map((t) => t.id));
  let cursor = options.start;

  const ready = (t: Task) =>
    t.dependsOn.every((d) => {
      const dep = byId.get(d);
      return !dep || dep.status === 'cancelled' || endById.has(d);
    });

  while (remaining.size > 0) {
    const candidates = open.filter((t) => remaining.has(t.id) && ready(t));
    if (candidates.length === 0) {
      // Dépendances circulaires ou manquantes : on place le reste à la suite.
      for (const id of remaining) candidates.push(byId.get(id) as Task);
    }
    candidates.sort(
      (a, b) =>
        (a.status === 'in_progress' ? -1 : 0) - (b.status === 'in_progress' ? -1 : 0) ||
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.order - b.order,
    );
    const task = candidates[0] as Task;
    remaining.delete(task.id);
    const depsEnd = maxDate(...task.dependsOn.map((d) => endById.get(d)));
    const afterDeps = depsEnd ? nextDay(depsEnd) : undefined;
    const hours = task.estimateHours ?? defaultHours;
    const days = Math.max(1, Math.min(MAX_TASK_DAYS, Math.ceil(hours / hoursPerDay)));
    let start: string;
    if (task.assignee === 'ai') {
      start = maxDate(options.start, afterDeps, task.startDate) as string;
    } else {
      start = maxDate(cursor, afterDeps, task.startDate) as string;
    }
    if (options.skipWeekends) start = addWorkDays(start, 0);
    const end = addDuration(start, task.assignee === 'ai' ? 1 : days);
    if (task.assignee !== 'ai') cursor = nextDay(end);
    endById.set(task.id, end);
    items.push(item(task, start, end, task.assignee === 'ai' ? 1 : days));
  }

  items.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return {
    items,
    start: items[0]?.start ?? options.start,
    end: maxDate(...items.map((i) => i.end)) ?? options.start,
  };
}

function item(t: Task, start: string, end: string, days: number): ScheduledTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
    assignee: t.assignee,
    start,
    end,
    days,
    ...(t.dueDate ? { dueDate: t.dueDate } : {}),
    late: Boolean(t.dueDate && end > t.dueDate && t.status !== 'done'),
  };
}

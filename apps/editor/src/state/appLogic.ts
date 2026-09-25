import type { TaskStatus } from '@forge/planner';
import type { Job } from '../api';

// ---------------------------------------------------------------------------
// Jeton de génération (requêtes concurrentes, ex. ouvertures de projet)
// ---------------------------------------------------------------------------

/**
 * Suit une séquence de requêtes concurrentes (ex. plusieurs `openProject()` lancés avant que
 * le premier n'ait fini) : seule la dernière requête démarrée doit pouvoir écrire son résultat.
 * Une requête plus ancienne qui se termine après elle doit être ignorée.
 */
export function createSequencer() {
  let current = 0;
  return {
    /** À appeler juste avant de démarrer une requête : renvoie son jeton. */
    next(): number {
      return ++current;
    },
    /** Vrai si `token` correspond toujours à la dernière requête démarrée. */
    isCurrent(token: number): boolean {
      return token === current;
    },
  };
}

// ---------------------------------------------------------------------------
// Fusion d'un statut de job
// ---------------------------------------------------------------------------

const TERMINAL_JOB_STATUSES: ReadonlySet<Job['status']> = new Set(['done', 'error', 'cancelled']);

/**
 * Fusionne un job reçu (réponse POST /generate ou événement SSE 'job') dans la liste existante.
 * Si la liste contient déjà ce job dans un état terminal, on le garde : le job reçu est
 * forcément plus ancien (ex. la réponse POST /generate, encore 'running', arrivée après
 * l'événement SSE 'done' d'un job très rapide).
 */
export function mergeJobUpdate(jobs: Job[], job: Job): Job[] {
  const existing = jobs.find((j) => j.id === job.id);
  if (existing && TERMINAL_JOB_STATUSES.has(existing.status) && !TERMINAL_JOB_STATUSES.has(job.status)) {
    return jobs;
  }
  return [job, ...jobs.filter((j) => j.id !== job.id)];
}

// ---------------------------------------------------------------------------
// Index de dépôt Kanban
// ---------------------------------------------------------------------------

/**
 * Index où insérer, dans la colonne `status`, une tâche déposée en fin de colonne — calculé sur
 * la liste COMPLÈTE des tâches du projet, jamais sur une liste déjà filtrée (ex. par jalon).
 * Utiliser la liste filtrée insère la tâche avant les tâches masquées par le filtre au lieu de
 * la mettre réellement en dernier dans la colonne.
 */
export function computeKanbanDropIndex(
  allTasks: readonly { id: string; status: TaskStatus }[],
  status: TaskStatus,
  draggedTaskId: string,
): number {
  return allTasks.filter((t) => t.status === status && t.id !== draggedTaskId).length;
}

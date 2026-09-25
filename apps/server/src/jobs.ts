import { shortId } from '@forge/core';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface Job<R = unknown> {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  status: JobStatus;
  progress: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: R;
  error?: string;
}

type Runner<R> = (report: (progress: string) => void, signal: AbortSignal) => Promise<R>;

interface Entry {
  job: Job;
  run: Runner<unknown>;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * File de tâches de fond (générations d'assets) avec concurrence limitée.
 * Chaque changement d'état est signalé à `onUpdate` (diffusé en SSE par le serveur).
 */
export class JobQueue {
  private readonly jobs = new Map<string, Entry>();
  private readonly waiting: Entry[] = [];
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly onUpdate: (job: Job) => void = () => undefined,
  ) {}

  /** Ajoute une tâche ; `done` se résout avec son résultat. */
  enqueue<R>(projectId: string, kind: string, label: string, run: Runner<R>): { job: Job<R>; done: Promise<R> } {
    const job: Job = {
      id: shortId('job'),
      projectId,
      kind,
      label,
      status: 'queued',
      progress: 'En attente…',
      createdAt: new Date().toISOString(),
    };
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const done = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    done.catch(() => undefined);
    const entry: Entry = { job, run: run as Runner<unknown>, controller: new AbortController(), resolve, reject };
    this.jobs.set(job.id, entry);
    this.waiting.push(entry);
    this.onUpdate({ ...job });
    this.pump();
    this.prune();
    return { job: job as Job<R>, done: done as Promise<R> };
  }

  get(id: string): Job | undefined {
    const e = this.jobs.get(id);
    return e ? { ...e.job } : undefined;
  }

  list(projectId?: string): Job[] {
    return [...this.jobs.values()]
      .map((e) => ({ ...e.job }))
      .filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  cancel(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry || entry.job.status === 'done' || entry.job.status === 'error') return false;
    entry.controller.abort();
    if (entry.job.status === 'queued') {
      this.waiting.splice(this.waiting.indexOf(entry), 1);
      this.finish(entry, 'cancelled', undefined, 'Annulée');
    }
    return true;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const entry = this.waiting.shift() as Entry;
      this.running++;
      entry.job.status = 'running';
      entry.job.startedAt = new Date().toISOString();
      entry.job.progress = 'En cours…';
      this.onUpdate({ ...entry.job });
      const report = (progress: string) => {
        entry.job.progress = progress;
        this.onUpdate({ ...entry.job });
      };
      entry
        .run(report, entry.controller.signal)
        .then(
          (result) => this.finish(entry, 'done', result),
          (error: unknown) =>
            this.finish(
              entry,
              entry.controller.signal.aborted ? 'cancelled' : 'error',
              undefined,
              error instanceof Error ? error.message : String(error),
            ),
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private finish(entry: Entry, status: JobStatus, result?: unknown, error?: string): void {
    entry.job.status = status;
    entry.job.finishedAt = new Date().toISOString();
    entry.job.progress = status === 'done' ? 'Terminé' : (error ?? status);
    if (result !== undefined) entry.job.result = result;
    if (error) entry.job.error = error;
    this.onUpdate({ ...entry.job });
    if (status === 'done') entry.resolve(result);
    else entry.reject(new Error(error ?? status));
  }

  /** Garde les 200 dernières tâches terminées. */
  private prune(): void {
    const finished = [...this.jobs.values()].filter((e) => e.job.finishedAt);
    if (finished.length <= 200) return;
    finished
      .sort((a, b) => (a.job.finishedAt ?? '').localeCompare(b.job.finishedAt ?? ''))
      .slice(0, finished.length - 200)
      .forEach((e) => this.jobs.delete(e.job.id));
  }
}

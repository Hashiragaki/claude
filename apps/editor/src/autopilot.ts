import { Store, useSelector } from './state/store';

/** Statut du pilote automatique (contrat partagé avec le serveur — voir apps/server). */
export interface AutopilotStatus {
  running: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  completed: string[];
  blocked: string[];
  maxTasks: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export class AutopilotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // réponse non JSON
    }
    throw new AutopilotApiError(message, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const p = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/autopilot`;

export const getAutopilot = (projectId: string): Promise<AutopilotStatus> => request('GET', p(projectId));

export const startAutopilot = (projectId: string, maxTasks?: number): Promise<AutopilotStatus> =>
  request('POST', `${p(projectId)}/start`, maxTasks != null ? { maxTasks } : {});

export const stopAutopilot = (projectId: string): Promise<AutopilotStatus> => request('POST', `${p(projectId)}/stop`);

/** État global du pilote automatique côté éditeur (mis à jour via l'événement SSE « autopilot »). */
export const autopilotStore = new Store<{ status: AutopilotStatus | null }>({ status: null });

export function useAutopilot(): AutopilotStatus | null {
  return useSelector(autopilotStore, (s) => s.status);
}

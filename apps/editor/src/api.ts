import type { AssetMeta, Diagnostic, ProjectManifest } from '@forge/core';
import type { Milestone, PlannerData, PlannerReview, Schedule, Task, TaskInput, TaskStatus } from '@forge/planner';

/** Types renvoyés par @forge/server (copiés ici pour éviter une dépendance à Node côté navigateur). */
export interface Health {
  ok: boolean;
  version: string;
  ai: { enabled: boolean; model: string | null; defaultModel: string };
  dataDir: string;
}

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
  templates: { id: string; name: string; description: string }[];
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  required?: string[];
}

export interface GeneratorInfo {
  id: string;
  kind: AssetMeta['kind'];
  label: string;
  description: string;
  params: JsonSchema;
}

export interface ProjectSummary {
  id: string;
  name: string;
  mode: string;
  description: string;
  updatedAt: string;
  assetCount: number;
}

export interface Job {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: string;
  createdAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  at: string;
  tool?: { name: string; input: unknown; ok?: boolean; result?: string };
}

export interface GenerateRequest {
  generator: string;
  params?: Record<string, unknown>;
  prompt?: string;
  mode?: 'auto' | 'ai' | 'procedural';
  name?: string;
  alias?: string;
  tags?: string[];
  seed?: number;
  parentId?: string;
  instruction?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string') {
      (init.headers as Record<string, string>)['Content-Type'] = 'text/plain; charset=utf-8';
      init.body = body;
    } else {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
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
    throw new ApiError(message, res.status);
  }
  if (raw) return res as unknown as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  health: () => request<Health>('GET', '/api/health'),
  modes: () => request<ModeInfo[]>('GET', '/api/modes'),
  generators: () => request<GeneratorInfo[]>('GET', '/api/generators'),

  listProjects: () => request<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (input: { name: string; mode: string; template?: string; description?: string }) =>
    request<ProjectManifest>('POST', '/api/projects', input),
  getProject: (id: string) => request<ProjectManifest>('GET', p(id)),
  updateProject: (id: string, patch: Partial<Pick<ProjectManifest, 'name' | 'description' | 'locale' | 'resolution' | 'pixelArt'>>) =>
    request<ProjectManifest>('PATCH', p(id), patch),
  deleteProject: (id: string) => request<{ ok: boolean }>('DELETE', p(id)),
  validate: (id: string) => request<Diagnostic[]>('GET', `${p(id)}/validate`),
  tree: (id: string) => request<{ path: string; size: number }[]>('GET', `${p(id)}/tree`),
  exportUrl: (id: string) => `${p(id)}/export`,

  fileUrl: (id: string, path: string) => `${p(id)}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
  readText: async (id: string, path: string) => {
    const res = await request<Response>('GET', api.fileUrl(id, path), undefined, true);
    return res.text();
  },
  readJson: async <T>(id: string, path: string): Promise<T> => JSON.parse(await api.readText(id, path)) as T,
  writeText: (id: string, path: string, content: string) =>
    request<{ ok: boolean }>('PUT', api.fileUrl(id, path), content),
  writeJson: (id: string, path: string, data: unknown) =>
    request<{ ok: boolean }>('PUT', api.fileUrl(id, path), `${JSON.stringify(data, null, 2)}\n`),
  deleteFile: (id: string, path: string) => request<{ ok: boolean }>('DELETE', api.fileUrl(id, path)),

  generate: (id: string, req: GenerateRequest) => request<Job>('POST', `${p(id)}/generate`, req),
  jobs: (id: string) => request<Job[]>('GET', `${p(id)}/jobs`),
  cancelJob: (jobId: string) => request<{ ok: boolean }>('POST', `/api/jobs/${jobId}/cancel`),
  updateAsset: (id: string, assetId: string, patch: { name?: string; alias?: string | null; tags?: string[] }) =>
    request<AssetMeta>('PATCH', `${p(id)}/assets/${assetId}`, patch),
  deleteAsset: (id: string, assetId: string) => request<{ ok: boolean }>('DELETE', `${p(id)}/assets/${assetId}`),
  importAsset: (
    id: string,
    body: { name: string; kind: AssetMeta['kind']; filename: string; dataBase64: string; alias?: string },
  ) => request<AssetMeta>('POST', `${p(id)}/assets/import`, body),

  planner: (id: string) =>
    request<{ data: PlannerData; review: PlannerReview; statusLabels: Record<TaskStatus, string> }>('GET', `${p(id)}/planner`),
  schedule: (id: string, hoursPerDay: number, skipWeekends: boolean) =>
    request<Schedule>('GET', `${p(id)}/planner/schedule?hoursPerDay=${hoursPerDay}&skipWeekends=${skipWeekends}&includeDone=true`),
  createTask: (id: string, input: TaskInput) => request<Task>('POST', `${p(id)}/planner/tasks`, input),
  updateTask: (id: string, taskId: string, patch: Partial<TaskInput> & { note?: string }) =>
    request<Task>('PATCH', `${p(id)}/planner/tasks/${taskId}`, patch),
  moveTask: (id: string, taskId: string, status: TaskStatus, index: number) =>
    request<Task>('POST', `${p(id)}/planner/tasks/${taskId}/move`, { status, index }),
  addTaskLog: (id: string, taskId: string, text: string) =>
    request<Task>('POST', `${p(id)}/planner/tasks/${taskId}/log`, { text }),
  deleteTask: (id: string, taskId: string) => request<{ ok: boolean }>('DELETE', `${p(id)}/planner/tasks/${taskId}`),
  createMilestone: (id: string, input: { title: string; description?: string; dueDate?: string }) =>
    request<Milestone>('POST', `${p(id)}/planner/milestones`, input),
  updateMilestone: (id: string, milestoneId: string, patch: Partial<Milestone>) =>
    request<Milestone>('PATCH', `${p(id)}/planner/milestones/${milestoneId}`, patch),
  deleteMilestone: (id: string, milestoneId: string, deleteTasks = false) =>
    request<{ ok: boolean }>('DELETE', `${p(id)}/planner/milestones/${milestoneId}?deleteTasks=${deleteTasks}`),
  remember: (id: string, text: string, tags: string[] = []) =>
    request<unknown>('POST', `${p(id)}/planner/memory`, { text, tags }),
  forget: (id: string, noteId: string) => request<{ ok: boolean }>('DELETE', `${p(id)}/planner/memory/${noteId}`),

  chat: (id: string) => request<{ messages: DisplayMessage[]; running: boolean; ai: boolean }>('GET', `${p(id)}/chat`),
  sendChat: (id: string, message: string) => request<{ ok: boolean }>('POST', `${p(id)}/chat`, { message }),
  stopChat: (id: string) => request<{ ok: boolean }>('POST', `${p(id)}/chat/stop`),
  clearChat: (id: string) => request<{ ok: boolean }>('DELETE', `${p(id)}/chat`),

  eventsUrl: (id: string) => `${p(id)}/events`,
};

import type { AssetMeta, Diagnostic, ProjectManifest } from '@forge/core';
import type { PlannerData, PlannerReview } from '@forge/planner';
import { ToastQueue } from '@adobe/react-spectrum';
import {
  api,
  type DisplayMessage,
  type GenerateRequest,
  type GeneratorInfo,
  type Health,
  type Job,
  type ModeInfo,
  type ProjectSummary,
} from '../api';
import { autopilotStore, getAutopilot, type AutopilotStatus } from '../autopilot';
import { createSequencer, mergeJobUpdate } from './appLogic';
import { Store, useSelector } from './store';

export interface LogEntry {
  id: number;
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: 'jeu' | 'éditeur' | 'génération' | 'validation';
  message: string;
}

/** Document ouvert dans la zone centrale (onglet). */
export interface OpenDocument {
  id: string;
  kind: 'script' | 'json' | 'map' | 'database' | 'scene';
  path: string;
  title: string;
}

export interface PlayRequest {
  session: number;
  startLabel?: string;
  startMap?: string;
  startX?: number;
  startY?: number;
  skipTitle?: boolean;
}

export interface AppState {
  ready: boolean;
  health: Health | null;
  modes: ModeInfo[];
  generators: GeneratorInfo[];
  projects: ProjectSummary[];
  project: ProjectManifest | null;
  jobs: Job[];
  planner: { data: PlannerData; review: PlannerReview } | null;
  chat: { messages: DisplayMessage[]; running: boolean; thinking: boolean; ai: boolean };
  logs: LogEntry[];
  diagnostics: Diagnostic[];
  selectedAssetId: string | null;
  play: PlayRequest | null;
  documents: OpenDocument[];
  /** Incrémenté quand un fichier du projet change (rechargement des éditeurs). */
  fileRevision: Record<string, number>;
  locale: 'fr' | 'en';
}

export const store = new Store<AppState>({
  ready: false,
  health: null,
  modes: [],
  generators: [],
  projects: [],
  project: null,
  jobs: [],
  planner: null,
  chat: { messages: [], running: false, thinking: false, ai: false },
  logs: [],
  diagnostics: [],
  selectedAssetId: null,
  play: null,
  documents: [],
  fileRevision: {},
  locale: (localStorage.getItem('forge:locale') as 'fr' | 'en' | null) ?? 'fr',
});

export function useApp<T>(selector: (state: AppState) => T): T {
  return useSelector(store, selector);
}

let logCounter = 0;

export function log(level: LogEntry['level'], source: LogEntry['source'], message: string): void {
  store.set((s) => ({
    logs: [...s.logs.slice(-499), { id: ++logCounter, at: new Date().toISOString(), level, source, message }],
  }));
}

export function toastError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  ToastQueue.negative(message, { timeout: 6000 });
  log('error', 'éditeur', message);
}

export function toastOk(message: string): void {
  ToastQueue.positive(message, { timeout: 3500 });
}

// ---------------------------------------------------------------------------
// Chargement initial et projets
// ---------------------------------------------------------------------------

export async function loadInitial(): Promise<void> {
  try {
    const [health, modes, generators, projects] = await Promise.all([
      api.health(),
      api.modes(),
      api.generators(),
      api.listProjects(),
    ]);
    store.set({ health, modes, generators, projects, ready: true });
    const last = localStorage.getItem('forge:lastProject');
    if (last && projects.some((p) => p.id === last)) await openProject(last);
  } catch (error) {
    store.set({ ready: true });
    toastError(new Error(`Serveur Forge injoignable : ${error instanceof Error ? error.message : String(error)}`));
  }
}

export async function refreshProjects(): Promise<void> {
  store.set({ projects: await api.listProjects() });
}

let events: EventSource | null = null;

/** Jeton anti-course : seule la dernière `openProject()` lancée peut écrire dans le store. */
const openSequencer = createSequencer();

export async function openProject(id: string): Promise<void> {
  const seq = openSequencer.next();
  closeProject();
  const [project, planner, chat, jobs] = await Promise.all([
    api.getProject(id),
    api.planner(id),
    api.chat(id),
    api.jobs(id),
  ]);
  // Un openProject() plus récent a démarré entre-temps (double clic, ou changement de projet
  // pendant le chargement) : ce résultat est périmé, on ne touche pas au store.
  if (!openSequencer.isCurrent(seq)) return;
  localStorage.setItem('forge:lastProject', id);
  store.set({
    project,
    planner: { data: planner.data, review: planner.review },
    chat: { messages: chat.messages, running: chat.running, thinking: false, ai: chat.ai },
    jobs,
    selectedAssetId: null,
    documents: [],
    play: null,
    diagnostics: [],
  });
  connectEvents(id);
  log('info', 'éditeur', `Projet « ${project.name} » ouvert.`);
  void validateProject();
  getAutopilot(id)
    .then((status) => autopilotStore.set({ status }))
    .catch(toastError);
}

export function closeProject(): void {
  events?.close();
  events = null;
  autopilotStore.set({ status: null });
  store.set({ project: null, planner: null, jobs: [], selectedAssetId: null, documents: [], play: null });
}

export async function createProject(input: { name: string; mode: string; template?: string }): Promise<void> {
  const manifest = await api.createProject(input);
  await refreshProjects();
  await openProject(manifest.id);
  toastOk(`Projet « ${manifest.name} » créé.`);
}

export async function deleteProject(id: string): Promise<void> {
  await api.deleteProject(id);
  if (store.get().project?.id === id) closeProject();
  await refreshProjects();
}

export async function refreshManifest(): Promise<void> {
  const id = store.get().project?.id;
  if (!id) return;
  const project = await api.getProject(id);
  // Le projet a été fermé ou changé pendant la requête : ce manifeste est celui d'un autre
  // projet (ou d'aucun), il ne faut pas l'écrire dans le store.
  if (store.get().project?.id !== id) return;
  store.set({ project });
}

export async function updateProject(patch: Parameters<typeof api.updateProject>[1]): Promise<void> {
  const id = requireProjectId();
  store.set({ project: await api.updateProject(id, patch) });
}

export async function validateProject(): Promise<Diagnostic[]> {
  const id = store.get().project?.id;
  if (!id) return [];
  const diagnostics = await api.validate(id);
  // Le projet a été fermé ou changé pendant la requête : ces diagnostics ne concernent plus
  // le projet actuellement ouvert.
  if (store.get().project?.id !== id) return diagnostics;
  store.set({ diagnostics });
  for (const d of diagnostics.filter((x) => x.severity === 'error')) {
    log('error', 'validation', `${d.file}${d.line ? `:${d.line}` : ''} — ${d.message}`);
  }
  return diagnostics;
}

export function requireProjectId(): string {
  const id = store.get().project?.id;
  if (!id) throw new Error('Aucun projet ouvert.');
  return id;
}

// ---------------------------------------------------------------------------
// Événements temps réel
// ---------------------------------------------------------------------------

let plannerTimer: ReturnType<typeof setTimeout> | null = null;

/** Relit chat, jobs, projet et planner depuis le serveur après une (re)connexion SSE. */
async function resyncProject(projectId: string): Promise<void> {
  const [project, planner, chat, jobs] = await Promise.all([
    api.getProject(projectId),
    api.planner(projectId),
    api.chat(projectId),
    api.jobs(projectId),
  ]);
  if (store.get().project?.id !== projectId) return;
  store.set({
    project,
    planner: { data: planner.data, review: planner.review },
    chat: { messages: chat.messages, running: chat.running, thinking: false, ai: chat.ai },
    jobs,
  });
}

function connectEvents(projectId: string): void {
  // Ferme un flux précédent encore ouvert (ex. deux openProject() qui se chevauchent) : sinon
  // ses événements continuent de modifier le store même après avoir été « remplacés » ici.
  events?.close();
  const source = new EventSource(api.eventsUrl(projectId));
  events = source;
  let firstOpen = true;
  source.addEventListener('open', () => {
    if (firstOpen) {
      // Première connexion : le snapshot vient d'être chargé par openProject(), inutile de le
      // relire tout de suite.
      firstOpen = false;
      return;
    }
    // Reconnexion automatique de l'EventSource (ex. redémarrage du serveur pendant une
    // réponse en cours) : des événements ont pu être manqués pendant la coupure, on
    // resynchronise donc l'état depuis le serveur.
    void resyncProject(projectId);
  });
  events.addEventListener('job', (e) => {
    const job = JSON.parse((e as MessageEvent).data) as Job;
    store.set((s) => ({ jobs: mergeJobUpdate(s.jobs, job).slice(0, 100) }));
    if (job.status === 'error') log('error', 'génération', `${job.label} : ${job.error ?? 'échec'}`);
    if (job.status === 'done') log('info', 'génération', `${job.label} : terminé`);
  });
  events.addEventListener('asset', (e) => {
    const { action, asset } = JSON.parse((e as MessageEvent).data) as { action: string; asset?: AssetMeta };
    void refreshManifest();
    if (action === 'created' && asset) store.set({ selectedAssetId: asset.id });
  });
  events.addEventListener('manifest', (e) => {
    store.set({ project: JSON.parse((e as MessageEvent).data) as ProjectManifest });
  });
  events.addEventListener('planner', () => {
    if (plannerTimer) clearTimeout(plannerTimer);
    plannerTimer = setTimeout(() => void refreshPlanner(), 150);
  });
  events.addEventListener('file', (e) => {
    const { path } = JSON.parse((e as MessageEvent).data) as { path: string };
    store.set((s) => ({ fileRevision: { ...s.fileRevision, [path]: (s.fileRevision[path] ?? 0) + 1 } }));
  });
  events.addEventListener('chat', (e) => applyChatEvent(JSON.parse((e as MessageEvent).data)));
  events.addEventListener('autopilot', (e) => {
    autopilotStore.set({ status: JSON.parse((e as MessageEvent).data) as AutopilotStatus });
  });
}

type ChatEvent =
  | { kind: 'message'; message: DisplayMessage }
  | { kind: 'delta'; id: string; delta: string }
  | { kind: 'status'; running: boolean; thinking?: boolean }
  | { kind: 'cleared' };

function applyChatEvent(event: ChatEvent): void {
  store.set((s) => {
    const chat = { ...s.chat };
    switch (event.kind) {
      case 'message': {
        const index = chat.messages.findIndex((m) => m.id === event.message.id);
        chat.messages =
          index >= 0
            ? chat.messages.map((m, i) => (i === index ? event.message : m))
            : [...chat.messages, event.message];
        if (event.message.role === 'assistant') chat.thinking = false;
        break;
      }
      case 'delta': {
        chat.thinking = false;
        const index = chat.messages.findIndex((m) => m.id === event.id);
        if (index >= 0) {
          chat.messages = chat.messages.map((m, i) => (i === index ? { ...m, text: m.text + event.delta } : m));
        } else {
          // Le message initial ('message', texte vide) n'a pas été vu par ce client (connecté
          // après coup : rechargement de page, deuxième onglet) : on le recrée à partir des
          // deltas plutôt que de les jeter, sinon la réponse de l'assistant reste invisible.
          chat.messages = [
            ...chat.messages,
            { id: event.id, role: 'assistant', text: event.delta, at: new Date().toISOString() },
          ];
        }
        break;
      }
      case 'status':
        chat.running = event.running;
        chat.thinking = event.running && Boolean(event.thinking);
        break;
      case 'cleared':
        chat.messages = [];
        break;
    }
    return { chat };
  });
}

export async function refreshPlanner(): Promise<void> {
  const id = store.get().project?.id;
  if (!id) return;
  const planner = await api.planner(id);
  // Idem : ne pas écraser le planner d'un autre projet ouvert entre-temps.
  if (store.get().project?.id !== id) return;
  store.set({ planner: { data: planner.data, review: planner.review } });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function generateAsset(req: GenerateRequest): Promise<void> {
  const id = requireProjectId();
  const job = await api.generate(id, req);
  // Le job a pu déjà se terminer via SSE avant que cette réponse POST (encore 'queued' ou
  // 'running') ne revienne : mergeJobUpdate garde alors la version terminée.
  store.set((s) => ({ jobs: mergeJobUpdate(s.jobs, job) }));
  log('info', 'génération', `Lancé : ${job.label}`);
}

export function selectAsset(assetId: string | null): void {
  store.set({ selectedAssetId: assetId });
}

export function assetUrl(asset: AssetMeta, path = asset.file): string {
  const id = store.get().project?.id ?? '';
  return `${api.fileUrl(id, path)}?v=${encodeURIComponent(asset.createdAt)}`;
}

// ---------------------------------------------------------------------------
// Documents et lecture
// ---------------------------------------------------------------------------

export function openDocument(doc: Omit<OpenDocument, 'id'>): OpenDocument {
  const existing = store.get().documents.find((d) => d.path === doc.path && d.kind === doc.kind);
  if (existing) {
    documentRequests.emit(existing);
    return existing;
  }
  const created: OpenDocument = { ...doc, id: `doc:${doc.kind}:${doc.path}` };
  store.set((s) => ({ documents: [...s.documents, created] }));
  documentRequests.emit(created);
  return created;
}

export function closeDocument(id: string): void {
  store.set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
}

let playCounter = 0;

export function play(options: Omit<PlayRequest, 'session'> = {}): void {
  store.set({ play: { ...options, session: ++playCounter } });
  panelRequests.emit('game');
}

export function stopPlay(): void {
  store.set({ play: null });
}

/** Petits canaux d'événements entre l'état et la disposition des panneaux. */
function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(l: (value: T) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(value: T) {
      for (const l of listeners) l(value);
    },
  };
}

export const panelRequests = channel<string>();
export const documentRequests = channel<OpenDocument>();

export function showPanel(id: string): void {
  panelRequests.emit(id);
}

export function setLocale(locale: 'fr' | 'en'): void {
  localStorage.setItem('forge:locale', locale);
  store.set({ locale });
}

export const resetLayoutRequests = channel<void>();

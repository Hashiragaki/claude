import { existsSync } from 'node:fs';
import { ClaudeLlmClient, DEFAULT_MODEL, type LlmClient } from '@forge/ai';
import { AssetKindSchema, guessMime, nowIso, shortId, slugify, type AssetMeta, type ModeRegistry } from '@forge/core';
import { STATUS_LABELS, TaskStatusSchema, scheduleTasks, type PlanInput, type TaskInput } from '@forge/planner';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { ChatService } from './chat';
import type { ServerConfig } from './config';
import { EventHub } from './events';
import { exportProject } from './exporter';
import { GenerationService, describeGenerators, type GenerateRequest } from './generation';
import { JobQueue } from './jobs';
import { createModeRegistry } from './modes';
import { PlannerService } from './plannerService';
import { ProjectService } from './projects';
import { ProjectStore } from './storage';

export interface AppOptions {
  config: ServerConfig;
  /** Client IA injecté (tests) ; sinon créé d'après la configuration. */
  llm?: LlmClient | null;
  modes?: ModeRegistry;
  logger?: boolean;
}

export interface ForgeServer {
  app: FastifyInstance;
  store: ProjectStore;
  hub: EventHub;
  jobs: JobQueue;
  generation: GenerationService;
  projects: ProjectService;
  planners: PlannerService;
  chat: ChatService;
}

const KIND_DIRS: Record<string, string> = {
  image: 'images',
  spritesheet: 'animations',
  charset: 'characters',
  tileset: 'tilesets',
  sfx: 'sounds',
  music: 'music',
  model: 'models',
};

type IdParams = { id: string };

export async function createServer(options: AppOptions): Promise<ForgeServer> {
  const { config } = options;
  const store = new ProjectStore(config.dataDir);
  await store.init();
  const hub = new EventHub();
  const llm =
    options.llm !== undefined
      ? options.llm
      : config.ai.enabled
        ? new ClaudeLlmClient({ model: config.ai.model, effort: config.ai.effort, refusalFallback: config.ai.refusalFallback })
        : null;
  const modes = options.modes ?? createModeRegistry();
  const jobs = new JobQueue(config.jobConcurrency, (job) => hub.publish(job.projectId, { type: 'job', data: job }));
  const generation = new GenerationService(store, llm);
  const planners = new PlannerService(store, hub);
  const projects = new ProjectService(store, modes, generation, planners, hub);

  /** Génération via la file de jobs, avec diffusion du nouvel asset. */
  const enqueueGeneration = (projectId: string, request: GenerateRequest) => {
    const label = `${request.generator} : ${request.name ?? request.prompt ?? ''}`.trim();
    return jobs.enqueue(projectId, 'generate', label, async (report, signal) => {
      const asset = await generation.generate(projectId, request, report, signal);
      hub.publish(projectId, { type: 'asset', data: { action: 'created', asset } });
      return asset;
    });
  };

  const chat = new ChatService({
    store,
    planners,
    hub,
    llm,
    toolDeps: (projectId) => ({
      store,
      projects,
      generate: (request) => enqueueGeneration(projectId, request).done,
    }),
  });

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32 * 1024 * 1024 });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: error.issues.map((i) => `${i.path.join('.') || 'requête'} : ${i.message}`).join(' ; '),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    const code = typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
    if (code >= 500) app.log.error(error);
    return reply.status(code).send({ error: error instanceof Error ? error.message : String(error) });
  });

  // ---------------------------------------------------------------------------
  // Général
  // ---------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    ok: true,
    name: 'Forge',
    version: '0.1.0',
    ai: { enabled: llm !== null, model: llm ? llm.model : null, defaultModel: DEFAULT_MODEL },
    dataDir: config.dataDir,
  }));

  app.get('/api/modes', async () =>
    modes.list().map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      templates: m.templates.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    })),
  );

  app.get('/api/generators', async () => describeGenerators());

  // ---------------------------------------------------------------------------
  // Projets
  // ---------------------------------------------------------------------------

  app.get('/api/projects', async () => store.list());

  app.post('/api/projects', async (request) => projects.create(request.body as never));

  app.get<{ Params: IdParams }>('/api/projects/:id', async (request) => store.readManifest(request.params.id));

  app.patch<{ Params: IdParams }>('/api/projects/:id', async (request) =>
    projects.update(request.params.id, request.body as never),
  );

  app.delete<{ Params: IdParams }>('/api/projects/:id', async (request) => {
    await projects.delete(request.params.id);
    return { ok: true };
  });

  app.get<{ Params: IdParams }>('/api/projects/:id/validate', async (request) => projects.validate(request.params.id));

  app.get<{ Params: IdParams }>('/api/projects/:id/tree', async (request) => store.tree(request.params.id));

  app.get<{ Params: IdParams }>('/api/projects/:id/export', async (request, reply) => {
    const manifest = await store.readManifest(request.params.id);
    const zip = await exportProject(store, manifest.id, config.playerDist);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${slugify(manifest.name)}-web.zip"`)
      .send(Buffer.from(zip));
  });

  // Fichiers du projet
  app.get<{ Params: IdParams & { '*': string } }>('/api/projects/:id/files/*', async (request, reply) => {
    const rel = request.params['*'];
    const data = await store.readFile(request.params.id, rel);
    const mime = guessMime(rel);
    return reply
      .header('Content-Type', mime.startsWith('text/') || mime.endsWith('json') ? `${mime}; charset=utf-8` : mime)
      .header('Cache-Control', 'no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      // Un fichier ouvert directement (ex. SVG importé) ne peut exécuter aucun script.
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox")
      .send(data);
  });

  app.put<{ Params: IdParams & { '*': string } }>('/api/projects/:id/files/*', async (request) => {
    const { id } = request.params;
    const rel = request.params['*'];
    const body = request.body;
    const data =
      typeof body === 'string' || Buffer.isBuffer(body)
        ? body
        : body && typeof body === 'object'
          ? `${JSON.stringify(body, null, 2)}\n`
          : '';
    await store.writeFile(id, rel, data);
    await store.updateManifest(id, () => undefined);
    hub.publish(id, { type: 'file', data: { action: 'written', path: rel } });
    return { ok: true, path: rel };
  });

  app.delete<{ Params: IdParams & { '*': string } }>('/api/projects/:id/files/*', async (request) => {
    await store.deleteFile(request.params.id, request.params['*']);
    hub.publish(request.params.id, { type: 'file', data: { action: 'deleted', path: request.params['*'] } });
    return { ok: true };
  });

  // Événements temps réel
  app.get<{ Params: IdParams }>('/api/projects/:id/events', async (request, reply) => {
    await store.readManifest(request.params.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
    const unsubscribe = hub.subscribe(request.params.id, reply.raw);
    request.raw.on('close', unsubscribe);
  });

  // ---------------------------------------------------------------------------
  // Assets et génération
  // ---------------------------------------------------------------------------

  app.get<{ Params: IdParams }>('/api/projects/:id/assets', async (request) => (await store.readManifest(request.params.id)).assets);

  app.patch<{ Params: IdParams & { assetId: string } }>('/api/projects/:id/assets/:assetId', async (request) => {
    const patch = z
      .object({ name: z.string().min(1).optional(), alias: z.string().nullable().optional(), tags: z.array(z.string()).optional() })
      .parse(request.body);
    let updated: AssetMeta | undefined;
    await store.updateManifest(request.params.id, (m) => {
      const asset = m.assets.find((a) => a.id === request.params.assetId);
      if (!asset) throw Object.assign(new Error('Asset introuvable'), { statusCode: 404 });
      if (patch.alias) {
        const clash = m.assets.find((a) => a.id !== asset.id && a.alias?.toLowerCase() === patch.alias!.toLowerCase());
        if (clash) throw Object.assign(new Error(`Alias déjà utilisé par « ${clash.name} »`), { statusCode: 409 });
      }
      if (patch.name) asset.name = patch.name;
      if (patch.alias === null || patch.alias === '') delete asset.alias;
      else if (patch.alias) asset.alias = patch.alias;
      if (patch.tags) asset.tags = patch.tags;
      updated = asset;
    });
    hub.publish(request.params.id, { type: 'asset', data: { action: 'updated', asset: updated } });
    return updated;
  });

  app.delete<{ Params: IdParams & { assetId: string } }>('/api/projects/:id/assets/:assetId', async (request) => {
    const { id, assetId } = request.params;
    let removed: AssetMeta | undefined;
    await store.updateManifest(id, (m) => {
      removed = m.assets.find((a) => a.id === assetId);
      if (!removed) throw Object.assign(new Error('Asset introuvable'), { statusCode: 404 });
      m.assets = m.assets.filter((a) => a.id !== assetId);
      // Les versions suivantes gardent leur historique sans pointer vers un asset supprimé.
      for (const a of m.assets) if (a.parentId === assetId) delete a.parentId;
    });
    if (removed) {
      for (const file of [removed.file, removed.source, ...Object.values(removed.extra)]) {
        if (file) await store.deleteFile(id, file).catch(() => undefined);
      }
    }
    hub.publish(id, { type: 'asset', data: { action: 'deleted', asset: removed } });
    return { ok: true };
  });

  app.post<{ Params: IdParams }>('/api/projects/:id/assets/import', async (request) => {
    const { id } = request.params;
    const body = z
      .object({
        name: z.string().min(1),
        kind: AssetKindSchema,
        filename: z.string().min(1),
        dataBase64: z.string().min(1),
        alias: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(request.body);
    const ext = body.filename.split('.').pop()?.toLowerCase() ?? 'bin';
    const data = Buffer.from(body.dataBase64, 'base64');
    const assetId = shortId('a');
    const file = `assets/${KIND_DIRS[body.kind] ?? 'misc'}/${slugify(body.name, 32)}-${assetId.slice(2, 8)}.${ext}`;
    await store.writeFile(id, file, data);
    const info: Record<string, number> = {};
    if (ext === 'png' && data.length > 24 && data.toString('ascii', 12, 16) === 'IHDR') {
      info.width = data.readUInt32BE(16);
      info.height = data.readUInt32BE(20);
    }
    const asset: AssetMeta = {
      id: assetId,
      kind: body.kind,
      name: body.name,
      ...(body.alias ? { alias: body.alias } : {}),
      file,
      extra: {},
      mime: guessMime(file),
      tags: body.tags ?? [],
      origin: 'import',
      version: 1,
      info,
      createdAt: nowIso(),
    };
    await store.updateManifest(id, (m) => {
      if (asset.alias) for (const a of m.assets) if (a.alias?.toLowerCase() === asset.alias.toLowerCase()) delete a.alias;
      m.assets.push(asset);
    });
    hub.publish(id, { type: 'asset', data: { action: 'created', asset } });
    return asset;
  });

  app.post<{ Params: IdParams }>('/api/projects/:id/generate', async (request, reply) => {
    await store.readManifest(request.params.id);
    const { job } = enqueueGeneration(request.params.id, request.body as GenerateRequest);
    return reply.status(202).send(job);
  });

  app.get<{ Params: IdParams }>('/api/projects/:id/jobs', async (request) => jobs.list(request.params.id));

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId', async (request) => {
    const job = jobs.get(request.params.jobId);
    if (!job) throw Object.assign(new Error('Tâche de fond introuvable'), { statusCode: 404 });
    return job;
  });

  app.post<{ Params: { jobId: string } }>('/api/jobs/:jobId/cancel', async (request) => ({
    ok: jobs.cancel(request.params.jobId),
  }));

  // ---------------------------------------------------------------------------
  // Planificateur
  // ---------------------------------------------------------------------------

  const planner = (id: string) => planners.get(id);
  /** Les erreurs métier du planificateur deviennent des 400 (ou 404 si l'élément est introuvable). */
  const plannerOp = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as { statusCode?: number }).statusCode === undefined && !(err instanceof ZodError)) {
        Object.assign(err, { statusCode: /introuvable/i.test(err.message) ? 404 : 400 });
      }
      throw err;
    }
  };

  app.get<{ Params: IdParams }>('/api/projects/:id/planner', async (request) => {
    const p = await planner(request.params.id);
    return { data: p.data, review: p.review(), statusLabels: STATUS_LABELS };
  });

  app.get<{ Params: IdParams; Querystring: { hoursPerDay?: string; skipWeekends?: string; includeDone?: string } }>(
    '/api/projects/:id/planner/schedule',
    async (request) => {
      const p = await planner(request.params.id);
      return scheduleTasks(p.listTasks(), {
        start: p.today(),
        hoursPerDay: request.query.hoursPerDay ? Number(request.query.hoursPerDay) : 4,
        skipWeekends: request.query.skipWeekends === 'true',
        includeDone: request.query.includeDone === 'true',
      });
    },
  );

  app.post<{ Params: IdParams }>('/api/projects/:id/planner/tasks', async (request) => {
    const p = await planner(request.params.id);
    return plannerOp(() => p.createTask(request.body as TaskInput, 'user'));
  });

  app.patch<{ Params: IdParams & { taskId: string } }>('/api/projects/:id/planner/tasks/:taskId', async (request) => {
    const { note, ...patch } = (request.body ?? {}) as Partial<TaskInput> & { note?: string };
    const p = await planner(request.params.id);
    return plannerOp(() => p.updateTask(request.params.taskId, patch, 'user', note));
  });

  app.post<{ Params: IdParams & { taskId: string } }>('/api/projects/:id/planner/tasks/:taskId/move', async (request) => {
    const body = z.object({ status: TaskStatusSchema, index: z.number().int().min(0) }).parse(request.body);
    const p = await planner(request.params.id);
    return plannerOp(() => p.moveTask(request.params.taskId, body.status, body.index, 'user'));
  });

  app.post<{ Params: IdParams & { taskId: string } }>('/api/projects/:id/planner/tasks/:taskId/log', async (request) => {
    const body = z.object({ text: z.string().min(1) }).parse(request.body);
    const p = await planner(request.params.id);
    return plannerOp(() => p.addLog(request.params.taskId, body.text, 'user'));
  });

  app.delete<{ Params: IdParams & { taskId: string } }>('/api/projects/:id/planner/tasks/:taskId', async (request) => {
    const p = await planner(request.params.id);
    await plannerOp(() => p.deleteTask(request.params.taskId));
    return { ok: true };
  });

  app.post<{ Params: IdParams }>('/api/projects/:id/planner/milestones', async (request) => {
    const p = await planner(request.params.id);
    return plannerOp(() => p.createMilestone(request.body as never));
  });

  app.patch<{ Params: IdParams & { milestoneId: string } }>(
    '/api/projects/:id/planner/milestones/:milestoneId',
    async (request) => {
      const p = await planner(request.params.id);
      return plannerOp(() => p.updateMilestone(request.params.milestoneId, request.body as never));
    },
  );

  app.delete<{ Params: IdParams & { milestoneId: string }; Querystring: { deleteTasks?: string } }>(
    '/api/projects/:id/planner/milestones/:milestoneId',
    async (request) => {
      const p = await planner(request.params.id);
      await plannerOp(() => p.deleteMilestone(request.params.milestoneId, { deleteTasks: request.query.deleteTasks === 'true' }));
      return { ok: true };
    },
  );

  app.post<{ Params: IdParams }>('/api/projects/:id/planner/plan', async (request) => {
    const p = await planner(request.params.id);
    return plannerOp(() => p.applyPlan(request.body as PlanInput, 'user'));
  });

  app.post<{ Params: IdParams }>('/api/projects/:id/planner/memory', async (request) => {
    const body = z.object({ text: z.string().min(1), tags: z.array(z.string()).optional() }).parse(request.body);
    const p = await planner(request.params.id);
    return plannerOp(() => p.remember(body.text, body.tags));
  });

  app.delete<{ Params: IdParams & { noteId: string } }>('/api/projects/:id/planner/memory/:noteId', async (request) => {
    const p = await planner(request.params.id);
    await plannerOp(() => p.forget(request.params.noteId));
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  app.get<{ Params: IdParams }>('/api/projects/:id/chat', async (request) => ({
    messages: await chat.history(request.params.id),
    running: chat.isRunning(request.params.id),
    ai: llm !== null,
  }));

  app.post<{ Params: IdParams }>('/api/projects/:id/chat', async (request, reply) => {
    const body = z.object({ message: z.string().min(1) }).parse(request.body);
    if (chat.isRunning(request.params.id)) {
      throw Object.assign(new Error('Une réponse est déjà en cours.'), { statusCode: 409 });
    }
    await store.readManifest(request.params.id);
    // La réponse est diffusée par SSE ; on ne bloque pas la requête.
    void chat.send(request.params.id, body.message).catch((error) => app.log.error(error));
    return reply.status(202).send({ ok: true });
  });

  app.post<{ Params: IdParams }>('/api/projects/:id/chat/stop', async (request) => ({ ok: chat.stop(request.params.id) }));

  app.delete<{ Params: IdParams }>('/api/projects/:id/chat', async (request) => {
    await chat.clear(request.params.id);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Éditeur (production)
  // ---------------------------------------------------------------------------

  if (existsSync(config.editorDist)) {
    await app.register(fastifyStatic, { root: config.editorDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Introuvable' });
    });
  }

  return { app, store, hub, jobs, generation, projects, planners, chat };
}

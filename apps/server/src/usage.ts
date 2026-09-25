import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  addUsage,
  BudgetExceededError,
  ZERO_USAGE,
  type LlmCallMeta,
  type LlmRole,
  type LlmUsage,
  type UsageEvent,
} from '@forge/ai';
import type { EventHub } from './events';
import { Mutex, type ProjectStore } from './storage';

/** Journal des appels IA d'un projet (fichier interne). */
const USAGE_FILE = 'usage.jsonl';
/** Réglages IA d'un projet (fichier interne) : budget uniquement pour l'instant. */
const AI_FILE = 'ai.json';

export interface UsageLedgerOptions {
  /** Budget par défaut d'un projet qui n'a jamais appelé `setBudget`. */
  defaultBudgetUsd: number | null;
}

/** Contrat HTTP `GET /api/projects/:id/usage`. */
export interface UsageSummary {
  budgetUsd: number | null;
  spentUsd: number;
  calls: number;
  usage: LlmUsage;
  /** `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)`, 0 si aucun jeton. */
  cacheHitRate: number;
  byRole: Partial<Record<LlmRole, { calls: number; costUsd: number; usage: LlmUsage }>>;
  byModel: Record<string, { calls: number; costUsd: number }>;
  /** 30 derniers jours ayant au moins un appel, ordre croissant. */
  byDay: { day: string; calls: number; costUsd: number }[];
  /** 50 derniers appels, le plus récent en premier. */
  recent: UsageEvent[];
}

interface BudgetCache {
  spentUsd: number;
  budgetUsd: number | null;
}

/**
 * Comptabilité des appels IA : un fichier `usage.jsonl` par projet (ou `<dataDir>/usage.jsonl`
 * pour les appels sans projet), un budget par projet (`ai.json`), et un contrôle synchrone du
 * budget avant chaque appel (cache mémoire des dépenses, alimenté par `record`/`summary`).
 */
export class UsageLedger {
  private readonly cache = new Map<string, BudgetCache>();
  private readonly mutexes = new Map<string, Mutex>();

  constructor(
    private readonly store: ProjectStore,
    private readonly hub: EventHub,
    private readonly options: UsageLedgerOptions,
  ) {}

  /** Enregistre un appel terminé : fichier `usage.jsonl` (du projet si connu, sinon global). */
  record = async (event: UsageEvent): Promise<void> => {
    const projectId = event.meta.projectId;
    const scoped = Boolean(projectId) && (await this.store.exists(projectId!));
    if (scoped && projectId) {
      await this.append(this.store.resolve(projectId, USAGE_FILE), event);
      const entry = this.cache.get(projectId) ?? (await this.loadCache(projectId));
      entry.spentUsd += event.costUsd;
      this.cache.set(projectId, entry);
      this.hub.publish(projectId, {
        type: 'usage',
        data: { projectId, event, spentUsd: entry.spentUsd, budgetUsd: entry.budgetUsd },
      });
    } else {
      await this.append(path.join(this.store.root, USAGE_FILE), event);
    }
  };

  /** Résumé agrégé (contrat HTTP), recalculé (et le cache de dépenses rafraîchi) à chaque appel. */
  async summary(projectId: string): Promise<UsageSummary> {
    const events = await this.readEvents(projectId);
    const spentUsd = events.reduce((sum, e) => sum + e.costUsd, 0);
    const budgetUsd = await this.readBudget(projectId);
    this.cache.set(projectId, { spentUsd, budgetUsd });

    const usage = events.reduce((acc, e) => addUsage(acc, e.usage), ZERO_USAGE as LlmUsage);
    const denom = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    const cacheHitRate = denom > 0 ? usage.cacheReadTokens / denom : 0;

    const byRole: UsageSummary['byRole'] = {};
    const byModel: UsageSummary['byModel'] = {};
    const byDayMap = new Map<string, { calls: number; costUsd: number }>();
    for (const e of events) {
      const role = byRole[e.meta.role] ?? { calls: 0, costUsd: 0, usage: ZERO_USAGE as LlmUsage };
      role.calls += 1;
      role.costUsd += e.costUsd;
      role.usage = addUsage(role.usage, e.usage);
      byRole[e.meta.role] = role;

      const model = byModel[e.model] ?? { calls: 0, costUsd: 0 };
      model.calls += 1;
      model.costUsd += e.costUsd;
      byModel[e.model] = model;

      const day = e.at.slice(0, 10);
      const d = byDayMap.get(day) ?? { calls: 0, costUsd: 0 };
      d.calls += 1;
      d.costUsd += e.costUsd;
      byDayMap.set(day, d);
    }
    const byDay = [...byDayMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-30);
    const recent = events.slice(-50).reverse();

    return { budgetUsd, spentUsd, calls: events.length, usage, cacheHitRate, byRole, byModel, byDay, recent };
  }

  /** Fixe (ou retire) le budget d'un projet ; met à jour le cache de dépenses. */
  async setBudget(projectId: string, budgetUsd: number | null): Promise<void> {
    if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) {
      throw Object.assign(new Error('Le budget doit être un nombre positif ou nul.'), { statusCode: 400 });
    }
    await this.store.writeFile(projectId, AI_FILE, JSON.stringify({ budgetUsd }), true);
    const events = await this.readEvents(projectId);
    const spentUsd = events.reduce((sum, e) => sum + e.costUsd, 0);
    this.cache.set(projectId, { spentUsd, budgetUsd });
  }

  /**
   * Contrôle synchrone du budget (utilisé comme `beforeSend` du client IA) : lève
   * `BudgetExceededError` si les dépenses connues du projet ont atteint son budget. Sans entrée
   * en cache (projet jamais vu par `record`/`summary`/`setBudget`), utilise le budget par défaut
   * avec des dépenses nulles.
   */
  checkBudget = (meta: LlmCallMeta | undefined): void => {
    const projectId = meta?.projectId;
    if (!projectId) return;
    const entry = this.cache.get(projectId) ?? { spentUsd: 0, budgetUsd: this.options.defaultBudgetUsd };
    if (entry.budgetUsd !== null && entry.spentUsd >= entry.budgetUsd) {
      throw new BudgetExceededError(
        `Budget IA du projet atteint (${entry.spentUsd.toFixed(4)} $ dépensés / ${entry.budgetUsd.toFixed(4)} $).`,
      );
    }
  };

  private async loadCache(projectId: string): Promise<BudgetCache> {
    const events = await this.readEvents(projectId);
    const spentUsd = events.reduce((sum, e) => sum + e.costUsd, 0);
    const budgetUsd = await this.readBudget(projectId);
    const entry = { spentUsd, budgetUsd };
    this.cache.set(projectId, entry);
    return entry;
  }

  private async readEvents(projectId: string): Promise<UsageEvent[]> {
    let raw: string;
    try {
      raw = await this.store.readText(projectId, USAGE_FILE);
    } catch {
      return [];
    }
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UsageEvent);
  }

  private async readBudget(projectId: string): Promise<number | null> {
    try {
      const raw = await this.store.readText(projectId, AI_FILE);
      const parsed = JSON.parse(raw) as { budgetUsd?: unknown };
      if (parsed.budgetUsd === null) return null;
      if (typeof parsed.budgetUsd === 'number' && Number.isFinite(parsed.budgetUsd) && parsed.budgetUsd >= 0) {
        return parsed.budgetUsd;
      }
    } catch {
      // Pas de fichier (ou JSON invalide) : budget par défaut du serveur.
    }
    return this.options.defaultBudgetUsd;
  }

  private mutex(key: string): Mutex {
    let m = this.mutexes.get(key);
    if (!m) {
      m = new Mutex();
      this.mutexes.set(key, m);
    }
    return m;
  }

  /** Écriture en ajout seul, sérialisée par fichier (les jobs de génération sont concurrents). */
  private append(file: string, event: UsageEvent): Promise<void> {
    return this.mutex(file).run(async () => {
      const line = `${JSON.stringify(event)}\n`;
      await fs.appendFile(file, line).catch(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, line);
      });
    });
  }
}

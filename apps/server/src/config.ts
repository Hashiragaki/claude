import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PRICES, routingFromEnv, type Effort, type ModelPrice, type RoutingTable } from '@forge/ai';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Racine du dépôt (apps/server/src → ../../..). */
export const REPO_ROOT = path.resolve(here, '../../..');

export interface ServerConfig {
  port: number;
  host: string;
  /** Dossier contenant les projets. */
  dataDir: string;
  /** Build de l'éditeur servi en production (`apps/editor/dist`). */
  editorDist: string;
  /** Build du lecteur autonome utilisé pour l'export (`apps/editor/dist-player`). */
  playerDist: string;
  ai: {
    enabled: boolean;
    /** `api` : API Messages (clé) ; `claude-code` : commande `claude` connectée à un abonnement. */
    backend: 'api' | 'claude-code';
    model?: string;
    effort?: Effort;
    refusalFallback: boolean;
  };
  /** Nombre de générations simultanées. */
  jobConcurrency: number;
  /** Table de routage modèle/effort par rôle d'appel IA. */
  routing: RoutingTable;
  /** Prix par modèle ($/M jetons), pour l'estimation des coûts. */
  prices: Record<string, ModelPrice>;
  /** Budget IA par défaut d'un projet (dollars), `null` = illimité. */
  budgetUsd: number | null;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const aiSetting = (env.FORGE_AI ?? 'auto').toLowerCase();
  const backend = (env.FORGE_AI_BACKEND ?? 'api').toLowerCase() === 'claude-code' ? 'claude-code' : 'api';
  // Claude Code gère lui-même sa connexion (abonnement) : pas de clé requise.
  const hasCredentials = backend === 'claude-code' || Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const effort = env.FORGE_EFFORT as Effort | undefined;
  let prices = DEFAULT_PRICES;
  if (env.FORGE_PRICES) {
    try {
      const parsed = JSON.parse(env.FORGE_PRICES) as Record<string, ModelPrice>;
      if (parsed && typeof parsed === 'object') prices = { ...DEFAULT_PRICES, ...parsed };
    } catch {
      // JSON invalide : prix par défaut.
    }
  }
  const budgetEnv = env.FORGE_BUDGET_USD !== undefined ? Number(env.FORGE_BUDGET_USD) : NaN;
  const budgetUsd = Number.isFinite(budgetEnv) && budgetEnv >= 0 ? budgetEnv : null;
  return {
    port: Number(env.PORT ?? env.FORGE_PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir: path.resolve(env.FORGE_DATA_DIR ?? path.join(REPO_ROOT, 'workspace')),
    editorDist: path.join(REPO_ROOT, 'apps/editor/dist'),
    playerDist: path.join(REPO_ROOT, 'apps/editor/dist-player'),
    ai: {
      enabled: aiSetting === 'on' || (aiSetting === 'auto' && hasCredentials),
      backend,
      ...(env.FORGE_MODEL ? { model: env.FORGE_MODEL } : {}),
      ...(effort && EFFORTS.includes(effort) ? { effort } : {}),
      refusalFallback: (env.FORGE_REFUSAL_FALLBACK ?? 'on').toLowerCase() !== 'off',
    },
    jobConcurrency: Math.max(1, Number(env.FORGE_JOB_CONCURRENCY ?? 2)),
    routing: routingFromEnv(env),
    prices,
    budgetUsd,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type UsageSummary } from './api';
import { toastError, useApp } from './state/app';

/**
 * Panneau « Coûts IA » : `state/app.ts` n'expose pas d'écoute générique pour les événements SSE
 * (seulement des gestionnaires par type déjà câblés). Faute d'y ajouter un relais pour l'événement
 * `usage` sans modifier ce fichier (hors périmètre de cette tâche), on rafraîchit par sondage pendant
 * que le panneau est visible.
 */
const POLL_MS = 10_000;

/** Charge le résumé de consommation IA du projet ouvert et le rafraîchit pendant que `active` est vrai. */
export function useUsage(active: boolean): {
  summary: UsageSummary | null;
  loading: boolean;
  refresh(): Promise<void>;
} {
  const projectId = useApp((s) => s.project?.id ?? null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const data = await api.usage(projectId);
      if (id === requestId.current) setSummary(data);
    } catch (error) {
      if (id === requestId.current) toastError(error);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setSummary(null);
    if (!active || !projectId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, projectId, refresh]);

  return { summary, loading, refresh };
}

/** Enregistre le budget IA du projet (`null` = aucun budget). */
export async function saveUsageBudget(projectId: string, budgetUsd: number | null): Promise<UsageSummary> {
  return api.setUsageBudget(projectId, budgetUsd);
}

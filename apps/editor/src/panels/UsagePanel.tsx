import { ActionButton, Flex, Meter, NumberField, Text } from '@adobe/react-spectrum';
import Refresh from '@spectrum-icons/workflow/Refresh';
import { useEffect, useState } from 'react';
import type { LlmRole, UsageEvent } from '../api';
import { requireProjectId, toastError, toastOk } from '../state/app';
import { saveUsageBudget, useUsage } from '../usage';

const ROLE_LABELS: Record<LlmRole, string> = {
  chat: 'Chat',
  autopilot: 'Pilote automatique',
  plan: 'Planification',
  generate: 'Génération',
  review: 'Critique',
  summary: 'Résumés',
};

const ROLE_ORDER: LlmRole[] = ['chat', 'autopilot', 'plan', 'generate', 'review', 'summary'];

function formatUsd(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatTokens(value: number): string {
  return value.toLocaleString('fr-FR');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function totalTokens(usage: UsageEvent['usage']): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** Panneau « Coûts IA » : dépenses, budget, taux de cache et détail par rôle, modèle et appel. */
export function UsagePanel() {
  const { summary, loading, refresh } = useUsage(true);
  const [budgetInput, setBudgetInput] = useState<number | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    if (summary) setBudgetInput(summary.budgetUsd);
  }, [summary?.budgetUsd]);

  if (!summary) {
    return (
      <div className="fg-panel">
        <div className="fg-empty">{loading ? 'Chargement…' : 'Aucune donnée de consommation pour ce projet.'}</div>
      </div>
    );
  }

  const percent = summary.budgetUsd ? Math.min(1, summary.spentUsd / summary.budgetUsd) : 0;
  const meterVariant = percent >= 1 ? 'critical' : percent >= 0.8 ? 'warning' : 'informative';

  const onSaveBudget = async () => {
    setSavingBudget(true);
    try {
      await saveUsageBudget(requireProjectId(), budgetInput);
      toastOk('Budget IA enregistré.');
      await refresh();
    } catch (error) {
      toastError(error);
    } finally {
      setSavingBudget(false);
    }
  };

  const maxDayCost = Math.max(1, ...summary.byDay.map((d) => d.costUsd));

  return (
    <div className="fg-panel">
      <div className="fg-toolbar" style={{ gap: 18 }}>
        <strong style={{ fontSize: 13 }}>Dépensé : {formatUsd(summary.spentUsd)}</strong>
        {summary.budgetUsd !== null && (
          <div style={{ width: 200 }}>
            <Meter
              aria-label="Budget consommé"
              size="S"
              variant={meterVariant}
              value={Math.round(percent * 100)}
              valueLabel={`${formatUsd(summary.spentUsd)} / ${formatUsd(summary.budgetUsd)}`}
            />
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
          {summary.calls} appel{summary.calls > 1 ? 's' : ''} · Cache : {formatPercent(summary.cacheHitRate)}
        </span>
        <div className="fg-spacer" />
        <ActionButton isQuiet aria-label="Rafraîchir" onPress={() => void refresh()}>
          <Refresh />
        </ActionButton>
      </div>
      <div className="fg-scroll" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section>
          <div className="fg-section-title">Budget</div>
          <Flex gap="size-150" alignItems="end" wrap>
            <NumberField
              label="Budget IA (USD, vide = aucun)"
              value={budgetInput ?? undefined}
              minValue={0}
              onChange={(v) => setBudgetInput(Number.isNaN(v) ? null : v)}
              width="size-2400"
            />
            <ActionButton onPress={() => void onSaveBudget()} isDisabled={savingBudget}>
              Enregistrer
            </ActionButton>
            {budgetInput !== null && (
              <ActionButton isQuiet onPress={() => setBudgetInput(null)}>
                Effacer
              </ActionButton>
            )}
          </Flex>
        </section>

        <section>
          <div className="fg-section-title">Par rôle</div>
          <table className="fg-usage-table">
            <thead>
              <tr>
                <th>Rôle</th>
                <th>Appels</th>
                <th>Jetons</th>
                <th>Coût</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_ORDER.filter((role) => summary.byRole[role]).map((role) => {
                const row = summary.byRole[role]!;
                return (
                  <tr key={role}>
                    <td>{ROLE_LABELS[role]}</td>
                    <td>{row.calls}</td>
                    <td>{formatTokens(totalTokens(row.usage))}</td>
                    <td>{formatUsd(row.costUsd)}</td>
                  </tr>
                );
              })}
              {Object.keys(summary.byRole).length === 0 && (
                <tr>
                  <td colSpan={4} className="fg-empty" style={{ height: 'auto', padding: 8 }}>
                    Aucun appel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <div className="fg-section-title">Par modèle</div>
          <table className="fg-usage-table">
            <thead>
              <tr>
                <th>Modèle</th>
                <th>Appels</th>
                <th>Coût</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.byModel).map(([model, row]) => (
                <tr key={model}>
                  <td>{model}</td>
                  <td>{row.calls}</td>
                  <td>{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
              {Object.keys(summary.byModel).length === 0 && (
                <tr>
                  <td colSpan={3} className="fg-empty" style={{ height: 'auto', padding: 8 }}>
                    Aucun appel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <div className="fg-section-title">30 derniers jours</div>
          <div className="fg-usage-histogram" title="Coût quotidien (USD)">
            {summary.byDay.map((d) => (
              <div
                key={d.day}
                className="fg-usage-bar"
                style={{ height: `${Math.max(2, Math.round((d.costUsd / maxDayCost) * 100))}%` }}
                title={`${d.day} — ${d.calls} appel${d.calls > 1 ? 's' : ''} — ${formatUsd(d.costUsd)}`}
              />
            ))}
            {summary.byDay.length === 0 && (
              <div className="fg-empty" style={{ height: 'auto', padding: 8 }}>
                Aucune donnée.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="fg-section-title">10 derniers appels</div>
          <table className="fg-usage-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rôle</th>
                <th>Modèle</th>
                <th>Jetons</th>
                <th>Coût</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent.slice(0, 10).map((event, i) => (
                <tr key={`${event.at}-${i}`}>
                  <td>{new Date(event.at).toLocaleString('fr-FR')}</td>
                  <td>{ROLE_LABELS[event.meta.role] ?? event.meta.role}</td>
                  <td>{event.model}</td>
                  <td>{formatTokens(totalTokens(event.usage))}</td>
                  <td>{formatUsd(event.costUsd)}</td>
                </tr>
              ))}
              {summary.recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="fg-empty" style={{ height: 'auto', padding: 8 }}>
                    Aucun appel récent.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

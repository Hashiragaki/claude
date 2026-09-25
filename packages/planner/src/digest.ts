import { PRIORITY_LABELS, STATUS_LABELS, type Task } from './model';
import type { Planner, PlannerReview } from './planner';

/** Ligne compacte décrivant une tâche (pour l'IA et le chat hors-ligne). */
export function describeTask(task: Task, planner?: Planner): string {
  const parts = [PRIORITY_LABELS[task.priority], STATUS_LABELS[task.status]];
  if (task.milestoneId) parts.push(`jalon ${task.milestoneId}`);
  if (task.dueDate) parts.push(`échéance ${task.dueDate}`);
  if (task.estimateHours != null) parts.push(`${task.estimateHours} h`);
  if (task.assignee === 'ai') parts.push("confiée à l'IA");
  if (task.dependsOn.length) parts.push(`dépend de ${task.dependsOn.join(', ')}`);
  if (planner && task.status === 'todo' && planner.blockingTasks(task.id).length) parts.push('en attente');
  if (task.tags.length) parts.push(task.tags.map((t) => `#${t}`).join(' '));
  return `[${task.id}] ${task.title} (${parts.join(', ')})`;
}

/**
 * Résumé textuel du planning injecté dans le contexte de l'agent à chaque message.
 * Limité en taille : tâches ouvertes détaillées, tâches terminées résumées.
 */
export function plannerDigest(planner: Planner, options: { maxTasks?: number; maxNotes?: number } = {}): string {
  const maxTasks = options.maxTasks ?? 60;
  const maxNotes = options.maxNotes ?? 30;
  const lines: string[] = [`Date du jour : ${planner.today()}`];
  const stats = planner.stats();
  lines.push(
    `Avancement global : ${stats.percent} % (${stats.byStatus.done} terminées / ${stats.total - stats.byStatus.cancelled} tâches, ` +
      `${stats.doneHours} h / ${stats.estimateHours} h estimées).`,
  );

  const milestones = planner.listMilestones();
  lines.push('', milestones.length ? 'Jalons :' : 'Jalons : aucun.');
  for (const m of milestones) {
    const p = planner.milestoneProgress(m.id);
    lines.push(
      `- [${m.id}] ${m.title} — ${m.status}${m.dueDate ? `, échéance ${m.dueDate}` : ''}, ${p.done}/${p.total} tâches, ` +
        `${p.remainingHours} h restantes`,
    );
  }

  const open = planner.listTasks({ status: ['in_progress', 'todo', 'blocked'] });
  lines.push('', open.length ? `Tâches ouvertes (${open.length}) :` : 'Tâches ouvertes : aucune.');
  for (const t of open.slice(0, maxTasks)) lines.push(`- ${describeTask(t, planner)}`);
  if (open.length > maxTasks) lines.push(`- … ${open.length - maxTasks} autres (utilise list_tasks)`);

  const overdue = planner.overdue();
  if (overdue.length) lines.push('', `En retard : ${overdue.map((t) => `[${t.id}] ${t.title}`).join(' ; ')}`);

  const done = planner.listTasks({ status: 'done' });
  if (done.length) {
    const recent = done
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 10)
      .map((t) => `[${t.id}] ${t.title}`);
    lines.push('', `Dernières tâches terminées : ${recent.join(' ; ')}`);
  }

  const notes = planner.listMemory();
  if (notes.length) {
    lines.push('', 'Mémoire du projet :');
    for (const n of notes.slice(-maxNotes)) {
      lines.push(
        `- [${n.id}] (${n.at.slice(0, 10)}) ${n.text}${n.tags.length ? ` ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

/** Revue lisible (markdown) de l'avancement. */
export function formatReview(review: PlannerReview, planner?: Planner): string {
  const list = (title: string, tasks: Task[]) =>
    tasks.length ? [`**${title}** (${tasks.length})`, ...tasks.map((t) => `- ${describeTask(t, planner)}`), ''] : [];
  return [
    `### Revue du ${review.date}`,
    `Avancement : **${review.stats.percent} %** — ${review.stats.byStatus.done} tâches terminées sur ${
      review.stats.total - review.stats.byStatus.cancelled
    }.`,
    '',
    ...review.milestones.map(
      (m) => `- Jalon « ${m.milestone.title} » : ${m.done}/${m.total} (${Math.round(m.ratio * 100)} %)`,
    ),
    '',
    ...list('Terminées ces 7 derniers jours', review.completedLast7Days),
    ...list('En cours', review.inProgress),
    ...list('En retard', review.overdue),
    ...list('Échéances des 7 prochains jours', review.upcoming),
    ...list('Bloquées ou en attente', review.blocked),
    ...list('Prochaines actions conseillées', review.next),
  ]
    .join('\n')
    .trim();
}

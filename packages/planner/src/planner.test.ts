import { FakeLlmClient, runAgent, textBlock, toolUseBlock } from '@forge/ai';
import { describe, expect, it } from 'vitest';
import { addMonths, addWorkDays } from './dates';
import { plannerDigest } from './digest';
import { handleOfflineCommand, parseTaskShorthand } from './offline';
import { Planner } from './planner';
import { scheduleTasks } from './schedule';
import { createPlannerTools } from './tools';

function makePlanner(date = '2026-09-25T10:00:00.000Z') {
  let n = 0;
  let now = new Date(date);
  const planner = new Planner(undefined, { now: () => now, idGenerator: (p) => `${p}_${++n}` });
  return { planner, setNow: (d: string) => (now = new Date(d)) };
}

describe('Planner', () => {
  it('crée, met à jour et journalise les tâches', () => {
    const { planner } = makePlanner();
    const t = planner.createTask({ title: '  Écrire le chapitre 1 ', priority: 'high', estimateHours: 3 });
    expect(t).toMatchObject({ id: 't_1', title: 'Écrire le chapitre 1', status: 'todo', priority: 'high' });
    const u = planner.updateTask(t.id, { status: 'in_progress', dueDate: '2026-10-01' }, 'ai', 'Commencé');
    expect(u.status).toBe('in_progress');
    expect(u.log.at(-1)?.text).toContain('Commencé');
    expect(u.log.at(-1)?.by).toBe('ai');
    planner.updateTask(t.id, { dueDate: null });
    expect(planner.requireTask(t.id).dueDate).toBeUndefined();
    expect(() => planner.createTask({ title: '   ' })).toThrow(/obligatoire/);
  });

  it('valide les dépendances et refuse les cycles', () => {
    const { planner } = makePlanner();
    const a = planner.createTask({ title: 'A' });
    const b = planner.createTask({ title: 'B', dependsOn: [a.id] });
    const c = planner.createTask({ title: 'C', dependsOn: [b.id] });
    expect(() => planner.updateTask(a.id, { dependsOn: [c.id] })).toThrow(/circulaire/);
    expect(() => planner.createTask({ title: 'D', dependsOn: ['t_404'] })).toThrow(/introuvable/);
    expect(planner.isActionable(planner.requireTask(c.id))).toBe(false);
    planner.setStatus(a.id, 'done');
    planner.setStatus(b.id, 'done');
    expect(planner.isActionable(planner.requireTask(c.id))).toBe(true);
    planner.deleteTask(b.id);
    expect(planner.requireTask(c.id).dependsOn).toEqual([]);
  });

  it('ordonne les prochaines actions', () => {
    const { planner } = makePlanner();
    const low = planner.createTask({ title: 'Basse', priority: 'low' });
    const high = planner.createTask({ title: 'Haute', priority: 'high', dueDate: '2026-10-10' });
    const highSoon = planner.createTask({ title: 'Haute urgente', priority: 'high', dueDate: '2026-09-30' });
    const wip = planner.createTask({ title: 'En cours', status: 'in_progress', priority: 'low' });
    planner.createTask({ title: 'Attend', priority: 'critical', dependsOn: [low.id] });
    expect(planner.nextActions(4).map((t) => t.id)).toEqual([wip.id, highSoon.id, high.id, low.id]);
  });

  it('gère retards, échéances proches et revue', () => {
    const { planner, setNow } = makePlanner();
    const late = planner.createTask({ title: 'En retard', dueDate: '2026-09-20' });
    planner.createTask({ title: 'Bientôt', dueDate: '2026-09-28' });
    const done = planner.createTask({ title: 'Faite' });
    planner.setStatus(done.id, 'done');
    expect(planner.overdue().map((t) => t.id)).toEqual([late.id]);
    expect(planner.upcoming(7).map((t) => t.title)).toEqual(['Bientôt']);
    const review = planner.review();
    expect(review.completedLast7Days.map((t) => t.id)).toEqual([done.id]);
    expect(review.stats.percent).toBe(33);
    setNow('2026-10-20T10:00:00.000Z');
    expect(planner.review().completedLast7Days).toHaveLength(0);
  });

  it("crée l'occurrence suivante d'une tâche récurrente", () => {
    const { planner } = makePlanner();
    const t = planner.createTask({
      title: 'Revue hebdo',
      dueDate: '2026-09-26',
      recurrence: { every: 1, unit: 'week' },
    });
    planner.setStatus(t.id, 'done');
    const next = planner.listTasks({ status: 'todo' });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ title: 'Revue hebdo', dueDate: '2026-10-03' });
  });

  it('gère les jalons et leur avancement', () => {
    const { planner } = makePlanner();
    const m = planner.createMilestone({ title: 'Prototype', dueDate: '2026-11-01' });
    const a = planner.createTask({ title: 'A', milestoneId: m.id, estimateHours: 4 });
    planner.createTask({ title: 'B', milestoneId: m.id, estimateHours: 6 });
    planner.setStatus(a.id, 'done');
    expect(planner.milestoneProgress(m.id)).toMatchObject({ total: 2, done: 1, ratio: 0.5, remainingHours: 6 });
    planner.deleteMilestone(m.id);
    expect(planner.requireTask(a.id).milestoneId).toBeUndefined();
  });

  it('déplace les tâches dans le Kanban', () => {
    const { planner } = makePlanner();
    const a = planner.createTask({ title: 'A' });
    const b = planner.createTask({ title: 'B' });
    const c = planner.createTask({ title: 'C' });
    planner.moveTask(c.id, 'todo', 0);
    expect(planner.listTasks({ status: 'todo' }).map((t) => t.title)).toEqual(['C', 'A', 'B']);
    planner.moveTask(a.id, 'in_progress', 0);
    expect(planner.listTasks({ status: 'in_progress' }).map((t) => t.id)).toEqual([a.id]);
    expect(planner.listTasks({ status: 'todo' }).map((t) => t.id)).toEqual([c.id, b.id]);
  });

  it('applique un plan complet avec dépendances par titre, de façon atomique', () => {
    const { planner } = makePlanner();
    const result = planner.applyPlan({
      milestones: [
        {
          title: 'Prototype',
          tasks: [
            { title: 'Écrire le scénario', estimateHours: 4 },
            { title: 'Créer les personnages', dependsOnTitles: ['écrire le scénario'] },
          ],
        },
        { title: 'Démo', tasks: [{ title: 'Tester', dependsOnTitles: ['Créer les personnages'] }] },
      ],
    });
    expect(result.milestones).toHaveLength(2);
    const [scenario, persos, test] = result.tasks;
    expect(persos?.dependsOn).toEqual([scenario?.id]);
    expect(test?.dependsOn).toEqual([persos?.id]);
    const before = planner.data;
    expect(() =>
      planner.applyPlan({ milestones: [{ title: 'X', tasks: [{ title: 'Y', dependsOnTitles: ['Inexistante'] }] }] }),
    ).toThrow(/Dépendance inconnue/);
    expect(planner.data.tasks).toHaveLength(before.tasks.length);
  });

  it('sérialise et recharge ses données', () => {
    const { planner } = makePlanner();
    planner.createTask({ title: 'A', tags: ['art'] });
    planner.remember('Style : pixel-art 16×16, palette chaude', ['style']);
    const copy = new Planner(JSON.parse(JSON.stringify(planner.toJSON())));
    expect(copy.listTasks()[0]?.tags).toEqual(['art']);
    expect(copy.listMemory()[0]?.text).toContain('pixel-art');
  });
});

describe('dates et planning', () => {
  it('ajoute des mois et des jours ouvrés', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addWorkDays('2026-09-25', 1)).toBe('2026-09-28'); // vendredi → lundi
  });

  it("ordonnance les tâches séquentiellement pour l'utilisateur et en parallèle pour l'IA", () => {
    const { planner } = makePlanner();
    const a = planner.createTask({ title: 'A', estimateHours: 8, priority: 'high' });
    const b = planner.createTask({ title: 'B', estimateHours: 4, dependsOn: [a.id], dueDate: '2026-09-26' });
    const ai = planner.createTask({ title: 'Générer les sons', assignee: 'ai' });
    const schedule = scheduleTasks(planner.listTasks(), { start: '2026-09-25', hoursPerDay: 4 });
    const byId = Object.fromEntries(schedule.items.map((i) => [i.id, i]));
    expect(byId[a.id]).toMatchObject({ start: '2026-09-25', end: '2026-09-26', days: 2 });
    expect(byId[b.id]).toMatchObject({ start: '2026-09-27', end: '2026-09-27', late: true });
    expect(byId[ai.id]).toMatchObject({ start: '2026-09-25', end: '2026-09-25' });
    expect(schedule.end).toBe('2026-09-27');
  });
});

describe('commandes hors-ligne', () => {
  it('analyse les raccourcis', () => {
    expect(parseTaskShorthand('Dessiner la carte !haute @2026-10-02 ~3h #art')).toEqual({
      title: 'Dessiner la carte',
      priority: 'high',
      dueDate: '2026-10-02',
      estimateHours: 3,
      tags: ['art'],
    });
  });

  it('crée, liste et termine des tâches', () => {
    const { planner } = makePlanner();
    expect(handleOfflineCommand(planner, '/tâche Écrire la fin !critique').text).toContain('Tâche créée');
    expect(handleOfflineCommand(planner, '/taches').text).toContain('Écrire la fin');
    expect(handleOfflineCommand(planner, '/fait écrire la fin').text).toContain('Terminée');
    expect(handleOfflineCommand(planner, '/jalon Démo @2026-12-01').text).toContain('Jalon créé');
    expect(handleOfflineCommand(planner, '/revue').text).toContain('Revue du');
    expect(handleOfflineCommand(planner, '/générer sfx pièce').actions).toEqual([
      { type: 'generate', generator: 'sfx', prompt: 'pièce' },
    ]);
    expect(handleOfflineCommand(planner, 'bonjour').text).toContain('Mode hors-ligne');
    expect(handleOfflineCommand(planner, '/fait inexistante').text).toContain('introuvable');
  });
});

describe('agent de planification', () => {
  it('crée un plan via les outils et le reflète dans le résumé', async () => {
    const { planner } = makePlanner();
    const llm = new FakeLlmClient([
      {
        content: [
          toolUseBlock('plan_project', {
            milestones: [
              { title: 'Prototype', dueDate: '2026-10-31', tasks: [{ title: 'Écrire le scénario', estimateHours: 6 }] },
            ],
          }),
          toolUseBlock('remember', { text: 'Le jeu est un visual novel de 30 minutes.', tags: ['concept'] }),
        ],
      },
      { content: [textBlock('Plan créé avec un jalon.')] },
    ]);
    const result = await runAgent({
      llm,
      system: 'test',
      messages: [{ role: 'user', content: 'Planifie mon visual novel' }],
      tools: createPlannerTools(planner),
    });
    expect(result.text).toBe('Plan créé avec un jalon.');
    expect(planner.listMilestones()).toHaveLength(1);
    const digest = plannerDigest(planner);
    expect(digest).toContain('Prototype');
    expect(digest).toContain('Écrire le scénario');
    expect(digest).toContain('visual novel de 30 minutes');
  });
});

import { describe, expect, it } from 'vitest';
import { handleOfflineCommand } from './offline';
import { Planner } from './planner';
import { scheduleTasks } from './schedule';

function makePlanner(date = '2026-09-25T10:00:00.000Z') {
  let n = 0;
  let now = new Date(date);
  const planner = new Planner(undefined, { now: () => now, idGenerator: (p) => `${p}_${++n}` });
  return { planner, setNow: (d: string) => (now = new Date(d)) };
}

describe('correctifs revue g1-planner', () => {
  // findings-g1-planner.json : packages/planner/src/planner.ts:221
  it("updateTask n'applique aucun champ si le patch échoue plus loin (atomicité)", () => {
    const { planner } = makePlanner();
    const a = planner.createTask({ title: 'A', priority: 'low' });
    const b = planner.createTask({ title: 'B', dependsOn: [a.id] });
    expect(() =>
      planner.updateTask(a.id, { priority: 'critical', dueDate: '2026-10-01', dependsOn: [b.id] }),
    ).toThrow(/circulaire/);
    // Ni la priorité ni l'échéance n'ont dû être écrites : le patch a été rejeté en bloc.
    const reloaded = planner.requireTask(a.id);
    expect(reloaded.priority).toBe('low');
    expect(reloaded.dueDate).toBeUndefined();
    expect(reloaded.log).toHaveLength(1); // aucune entrée de journal ajoutée
  });

  // findings-g1-planner.json : packages/planner/src/schedule.ts:89
  it('scheduleTasks ne boucle pas avec hoursPerDay <= 0 (repli sur la valeur par défaut)', () => {
    const { planner } = makePlanner();
    const task = planner.createTask({ title: 'A', estimateHours: 4 });
    const schedule = scheduleTasks(planner.listTasks(), {
      start: '2026-09-25',
      hoursPerDay: 0,
      skipWeekends: true,
    });
    expect(schedule.items.find((i) => i.id === task.id)).toBeDefined();
  });

  it('scheduleTasks ne boucle pas avec hoursPerDay non fini (NaN/Infinity)', () => {
    const { planner } = makePlanner();
    planner.createTask({ title: 'A', estimateHours: 4 });
    expect(() => scheduleTasks(planner.listTasks(), { start: '2026-09-25', hoursPerDay: NaN })).not.toThrow();
    expect(() =>
      scheduleTasks(planner.listTasks(), { start: '2026-09-25', hoursPerDay: Number.POSITIVE_INFINITY }),
    ).not.toThrow();
  });

  // findings-g1-planner.json : packages/planner/src/offline.ts:85
  it('/fait par titre agit sur l\'occurrence ouverte, pas sur l\'original déjà terminé', () => {
    const { planner } = makePlanner();
    planner.createTask({ title: 'Revue hebdo', dueDate: '2026-09-26', recurrence: { every: 1, unit: 'week' } });
    const first = handleOfflineCommand(planner, '/fait Revue hebdo');
    expect(first.text).toContain('Terminée');
    const open = planner.listTasks({ status: 'todo' });
    expect(open).toHaveLength(1); // la nouvelle occurrence

    const second = handleOfflineCommand(planner, '/fait Revue hebdo');
    expect(second.text).toContain('Terminée');
    expect(second.text).toContain(open[0]!.id); // c'est bien la nouvelle occurrence qui a été terminée
    expect(planner.requireTask(open[0]!.id).status).toBe('done');
    // Une seule occurrence encore ouverte a été créée pour la semaine suivante.
    expect(planner.listTasks({ status: 'todo' })).toHaveLength(1);
  });

  it('/encours par titre reprend l\'occurrence ouverte, pas l\'original terminé', () => {
    const { planner } = makePlanner();
    planner.createTask({ title: 'Revue hebdo', dueDate: '2026-09-26', recurrence: { every: 1, unit: 'week' } });
    handleOfflineCommand(planner, '/fait Revue hebdo');
    const reply = handleOfflineCommand(planner, '/encours Revue hebdo');
    expect(reply.text).toContain('En cours');
    const inProgress = planner.listTasks({ status: 'in_progress' });
    expect(inProgress).toHaveLength(1);
  });

  // findings-g1-planner.json : packages/planner/src/planner.ts:251
  it('rouvrir puis reterminer une tâche récurrente ne duplique pas la prochaine occurrence', () => {
    const { planner } = makePlanner();
    const r = planner.createTask({ title: 'R', dueDate: '2026-09-25', recurrence: { every: 1, unit: 'week' } });
    planner.setStatus(r.id, 'done'); // spawn la première occurrence suivante
    planner.setStatus(r.id, 'todo'); // ex. glissement Kanban « fait » → « à faire » par erreur
    planner.setStatus(r.id, 'done'); // re-terminée : ne doit pas générer une deuxième occurrence
    const open = planner.listTasks({ status: 'todo' });
    expect(open).toHaveLength(1);
  });

  // findings-g1-planner.json : apps/server/src/app.ts:386 — validé côté domaine (Planner), sans toucher app.ts.
  describe('validation des entrées publiques (reprend les schémas zod du package)', () => {
    it('createTask refuse un statut invalide', () => {
      const { planner } = makePlanner();
      expect(() => planner.createTask({ title: 'A', status: 'doing' as never })).toThrow(/invalide/);
    });

    it('createTask refuse une date mal formée', () => {
      const { planner } = makePlanner();
      expect(() => planner.createTask({ title: 'A', dueDate: '15/11/2026' })).toThrow(/invalide/);
    });

    it('createTask refuse une estimation supérieure à 1000 heures', () => {
      const { planner } = makePlanner();
      expect(() => planner.createTask({ title: 'A', estimateHours: 1e7 })).toThrow(/invalide/);
    });

    it('createTask refuse une estimation négative', () => {
      const { planner } = makePlanner();
      expect(() => planner.createTask({ title: 'A', estimateHours: -1 })).toThrow(/invalide/);
    });

    it('updateTask refuse une priorité invalide sans rien modifier', () => {
      const { planner } = makePlanner();
      const t = planner.createTask({ title: 'A' });
      expect(() => planner.updateTask(t.id, { priority: 'urgent' as never })).toThrow(/invalide/);
      expect(planner.requireTask(t.id).priority).toBe('medium');
    });

    it('createMilestone refuse une échéance mal formée', () => {
      const { planner } = makePlanner();
      expect(() => planner.createMilestone({ title: 'Démo', dueDate: '15/11/2026' })).toThrow(/invalide/);
    });

    it('updateMilestone refuse un statut invalide', () => {
      const { planner } = makePlanner();
      const m = planner.createMilestone({ title: 'Démo' });
      expect(() => planner.updateMilestone(m.id, { status: 'archived' as never })).toThrow(/invalide/);
    });

    it("applyPlan refuse une tâche du plan avec une date invalide (rien n'est créé)", () => {
      const { planner } = makePlanner();
      expect(() =>
        planner.applyPlan({
          milestones: [{ title: 'M', tasks: [{ title: 'T', dueDate: '15/11/2026' } as never] }],
        }),
      ).toThrow(/invalide/);
      expect(planner.listMilestones()).toHaveLength(0);
      expect(planner.listTasks()).toHaveLength(0);
    });

    it('un id de tâche inconnu passé via une API non typée reste rejeté proprement', () => {
      // Simule un corps de requête HTTP non validé (comme apps/server/src/app.ts) : la validation
      // doit désormais avoir lieu dans le domaine, quel que soit l'appelant.
      const { planner } = makePlanner();
      const body: unknown = { title: 'Sortie', status: 'doing', estimateHours: -5 };
      expect(() => planner.createTask(body as never)).toThrow(/invalide/);
    });
  });
});

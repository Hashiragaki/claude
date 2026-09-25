import { describe, expect, it } from 'vitest';
import type { Job } from '../api';
import { computeKanbanDropIndex, createSequencer, mergeJobUpdate } from './appLogic';

describe('createSequencer', () => {
  it("ignore le jeton d'une requête abandonnée après qu'une plus récente a démarré", () => {
    // Simule deux openProject() qui se chevauchent (double clic sur un projet) : le second
    // démarre avant que le premier n'ait fini, donc seul son jeton doit rester « courant ».
    const seq = createSequencer();
    const first = seq.next();
    const second = seq.next();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);
  });

  it('reste courant pour une requête unique non concurrencée', () => {
    const seq = createSequencer();
    const only = seq.next();
    expect(seq.isCurrent(only)).toBe(true);
  });
});

describe('mergeJobUpdate', () => {
  const base: Job = {
    id: 'j1',
    projectId: 'p1',
    kind: 'sfx',
    label: 'Effet sonore',
    status: 'running',
    progress: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it("garde le job terminé reçu par SSE plutôt que la réponse POST /generate périmée 'running'", () => {
    // Un sfx très rapide se termine et son événement SSE 'done' est traité avant que la
    // réponse HTTP du POST /generate (encore 'running') ne revienne au client.
    const afterSse = mergeJobUpdate([], { ...base, status: 'done', finishedAt: '2026-01-01T00:00:01.000Z' });
    const afterStalePost = mergeJobUpdate(afterSse, { ...base, status: 'running' });
    expect(afterStalePost).toEqual(afterSse);
  });

  it('ajoute un job encore inconnu de la liste', () => {
    expect(mergeJobUpdate([], base)).toEqual([base]);
  });

  it('remplace un job existant non terminal par sa mise à jour', () => {
    const updated: Job = { ...base, progress: '50%' };
    expect(mergeJobUpdate([base], updated)).toEqual([updated]);
  });
});

describe('computeKanbanDropIndex', () => {
  it("calcule l'index de fin de colonne dans la liste COMPLÈTE, pas la vue filtrée par jalon", () => {
    // Colonne todo complète : A(m1), B(m2), C(m1). Un filtre sur le jalon m1 n'affiche que A et
    // C (longueur filtrée = 2), mais insérer la carte déposée en fin de colonne doit se faire
    // après les 3 tâches réellement présentes dans la colonne, pas après les 2 visibles.
    const tasks = [
      { id: 'A', status: 'todo' as const },
      { id: 'B', status: 'in_progress' as const },
      { id: 'C', status: 'todo' as const },
    ];
    expect(computeKanbanDropIndex(tasks, 'todo', 'D')).toBe(2);
  });

  it('exclut la tâche déposée elle-même quand elle est déjà présente dans la colonne', () => {
    const tasks = [
      { id: 'A', status: 'todo' as const },
      { id: 'C', status: 'todo' as const },
    ];
    expect(computeKanbanDropIndex(tasks, 'todo', 'A')).toBe(1);
  });
});

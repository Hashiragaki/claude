import type { Engine } from '@forge/core';
import { Store, useSelector } from './store';

/** Moteur en cours d'exécution dans le panneau Jeu (lu par l'inspecteur de variables). */
export const playSession = new Store<{ engine: Engine | null; revision: number; paused: boolean }>({
  engine: null,
  revision: 0,
  paused: false,
});

export function usePlaySession<T>(selector: (s: { engine: Engine | null; revision: number; paused: boolean }) => T): T {
  return useSelector(playSession, selector);
}

export function bumpDebugRevision(): void {
  playSession.set((s) => ({ revision: s.revision + 1 }));
}

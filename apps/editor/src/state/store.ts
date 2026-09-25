import { useSyncExternalStore } from 'react';

/** Petit store observable (état global de l'éditeur), lu via `useStore(selector)`. */
export class Store<S extends object> {
  private listeners = new Set<() => void>();

  constructor(private state: S) {}

  get(): S {
    return this.state;
  }

  set(update: Partial<S> | ((state: S) => Partial<S>)): void {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useSelector<S extends object, T>(store: Store<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

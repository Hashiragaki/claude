/** Hash FNV-1a 32 bits d'une chaîne, utile pour dériver une graine d'un texte. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Tous les contenus procéduraux passent par lui pour être reproductibles à partir d'une graine.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string = Date.now()) {
    this.state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  }

  /** Nombre flottant dans [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Flottant dans [min, max). */
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }

  /** Entier dans [min, max] (bornes incluses). */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: liste vide');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Tirage pondéré : `weights[i]` est le poids de `items[i]`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }

  /** Crée un générateur enfant indépendant (utile pour isoler des sous-générations). */
  fork(label = ''): Rng {
    return new Rng(hashString(`${this.state}:${label}`));
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

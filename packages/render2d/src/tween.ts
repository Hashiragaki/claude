export type Easing = (t: number) => number;

export const Easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Easing>;

export type EasingName = keyof typeof Easings;

interface ActiveTween {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  elapsed: number;
  delay: number;
  easing: Easing;
  resolve: () => void;
}

export interface TweenOptions {
  easing?: Easing | EasingName;
  delay?: number;
}

/**
 * Animations de propriétés numériques pilotées par `update(dt)` (indépendant du moteur de rendu).
 * Les durées sont en secondes.
 */
export class Tweens {
  private tweens: ActiveTween[] = [];

  to<T extends object>(target: T, props: Partial<Record<keyof T, number>>, duration: number, options: TweenOptions = {}): Promise<void> {
    const t = target as unknown as Record<string, number>;
    const from: Record<string, number> = {};
    const to: Record<string, number> = {};
    for (const [key, value] of Object.entries(props) as [string, number][]) {
      from[key] = t[key] ?? 0;
      to[key] = value;
    }
    // Une nouvelle animation sur les mêmes propriétés remplace l'ancienne.
    for (const existing of this.tweens) {
      if (existing.target === t) for (const key of Object.keys(to)) delete existing.to[key];
    }
    const easing = typeof options.easing === 'string' ? Easings[options.easing] : (options.easing ?? Easings.easeInOutQuad);
    return new Promise((resolve) => {
      if (duration <= 0 && !options.delay) {
        Object.assign(t, to);
        resolve();
        return;
      }
      this.tweens.push({ target: t, from, to, duration: Math.max(duration, 1e-6), elapsed: 0, delay: options.delay ?? 0, easing, resolve });
    });
  }

  /** Attend `seconds` (utile pour enchaîner des séquences). */
  wait(seconds: number): Promise<void> {
    return this.to({ v: 0 }, { v: 1 }, seconds, { easing: 'linear' });
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return;
    const done: ActiveTween[] = [];
    for (const tw of this.tweens) {
      let step = dt;
      if (tw.delay > 0) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        step = -tw.delay;
        tw.delay = 0;
      }
      tw.elapsed = Math.min(tw.elapsed + step, tw.duration);
      const k = tw.easing(tw.elapsed / tw.duration);
      for (const key of Object.keys(tw.to)) {
        const a = tw.from[key] ?? 0;
        const b = tw.to[key] ?? 0;
        tw.target[key] = a + (b - a) * k;
      }
      if (tw.elapsed >= tw.duration) done.push(tw);
    }
    if (done.length) {
      this.tweens = this.tweens.filter((t) => !done.includes(t));
      for (const tw of done) tw.resolve();
    }
  }

  /** Termine immédiatement toutes les animations (valeurs finales appliquées). */
  finishAll(): void {
    const all = this.tweens;
    this.tweens = [];
    for (const tw of all) {
      Object.assign(tw.target, tw.to);
      tw.resolve();
    }
  }

  cancel(target: object): void {
    const keep: ActiveTween[] = [];
    for (const tw of this.tweens) {
      if (tw.target === (target as unknown)) tw.resolve();
      else keep.push(tw);
    }
    this.tweens = keep;
  }

  get active(): number {
    return this.tweens.length;
  }
}

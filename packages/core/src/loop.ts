export interface GameLoopOptions {
  /** Logique à pas fixe (secondes). */
  update(dt: number): void;
  /** Rendu, avec le facteur d'interpolation entre deux pas logiques. */
  render?(alpha: number): void;
  /** Durée d'un pas logique en secondes (1/60 par défaut). */
  fixedStep?: number;
  /** Temps maximum rattrapé par frame, pour éviter la « spirale de la mort ». */
  maxFrameTime?: number;
}

/** Boucle de jeu à pas fixe. Utilise requestAnimationFrame dans le navigateur. */
export class GameLoop {
  timeScale = 1;
  private readonly fixedStep: number;
  private readonly maxFrameTime: number;
  private accumulator = 0;
  private lastTime = 0;
  private handle: number | ReturnType<typeof setTimeout> | null = null;
  private _running = false;
  private _paused = false;

  constructor(private readonly options: GameLoopOptions) {
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
  }

  get running(): boolean {
    return this._running;
  }

  get paused(): boolean {
    return this._paused;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.lastTime = now();
    this.schedule();
  }

  stop(): void {
    this._running = false;
    if (this.handle !== null) {
      if (typeof cancelAnimationFrame === 'function' && typeof this.handle === 'number') cancelAnimationFrame(this.handle);
      else clearTimeout(this.handle as ReturnType<typeof setTimeout>);
      this.handle = null;
    }
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.lastTime = now();
  }

  /** Avance manuellement de `seconds` (tests, rendu hors-ligne). */
  step(seconds: number): void {
    this.accumulator += seconds * this.timeScale;
    while (this.accumulator >= this.fixedStep - 1e-9) {
      this.options.update(this.fixedStep);
      this.accumulator = Math.max(0, this.accumulator - this.fixedStep);
    }
    this.options.render?.(this.accumulator / this.fixedStep);
  }

  private schedule(): void {
    const tick = () => {
      if (!this._running) return;
      const t = now();
      const frame = Math.min((t - this.lastTime) / 1000, this.maxFrameTime);
      this.lastTime = t;
      if (!this._paused) this.step(frame);
      this.schedule();
    };
    this.handle = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : setTimeout(tick, 16);
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

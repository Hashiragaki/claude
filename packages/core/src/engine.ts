import { AssetRegistry } from './assets';
import { AudioManager } from './audio';
import { Emitter } from './events';
import { I18n } from './i18n';
import { InputManager } from './input';
import { GameLoop } from './loop';
import type { EngineEvents, GameRuntime, LogLevel, ModeRegistry, RunOptions, RuntimeContext } from './mode';
import type { ProjectBundle } from './project';
import { Rng } from './rng';
import { LocalSaveStorage, MemorySaveStorage, SaveManager, type SaveSlotInfo, type SaveStorage } from './save';

export interface EngineOptions {
  bundle: ProjectBundle;
  modes: ModeRegistry;
  mount?: HTMLElement | null;
  saveStorage?: SaveStorage;
  locale?: string;
  run?: RunOptions;
  seed?: number;
  /** Démarre la boucle `requestAnimationFrame` (désactiver pour les tests : utiliser `step`). */
  autoLoop?: boolean;
}

/**
 * Point d'entrée d'exécution d'un jeu : crée le contexte, instancie le mode du projet et
 * fait tourner la boucle de jeu.
 */
export class Engine {
  readonly events = new Emitter<EngineEvents>();
  readonly input = new InputManager();
  readonly audio = new AudioManager();
  readonly i18n: I18n;
  readonly assets: AssetRegistry;
  readonly saves: SaveManager;
  readonly loop: GameLoop;
  readonly context: RuntimeContext;
  runtime: GameRuntime | null = null;
  playTime = 0;
  private detachInput: (() => void) | null = null;
  private readonly autoLoop: boolean;

  constructor(private readonly options: EngineOptions) {
    const { bundle } = options;
    this.autoLoop = options.autoLoop ?? true;
    this.i18n = new I18n(options.locale ?? bundle.manifest.locale, bundle.manifest.locale);
    this.assets = new AssetRegistry(bundle.manifest.assets, bundle.files);
    this.saves = new SaveManager(
      options.saveStorage ?? (typeof localStorage !== 'undefined' ? new LocalSaveStorage() : new MemorySaveStorage()),
      bundle.manifest.id,
      bundle.manifest.mode,
    );
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: (alpha) => this.runtime?.render?.(alpha),
    });
    this.context = {
      bundle,
      assets: this.assets,
      input: this.input,
      audio: this.audio,
      saves: this.saves,
      i18n: this.i18n,
      events: this.events,
      rng: new Rng(options.seed ?? Date.now()),
      mount: options.mount ?? null,
      options: options.run ?? {},
      log: (level, message) => this.log(level, message),
    };
  }

  log(level: LogLevel, message: string): void {
    this.events.emit('log', { level, message });
  }

  async start(): Promise<void> {
    const mode = this.options.modes.get(this.options.bundle.manifest.mode);
    this.runtime = await mode.createRuntime(this.context);
    if (typeof window !== 'undefined' && this.options.mount) {
      this.detachInput = this.input.attach(window, this.options.mount);
      const unlock = () => void this.audio.unlock();
      this.options.mount.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
    await this.runtime.start();
    if (this.autoLoop) this.loop.start();
    this.log('info', `Jeu « ${this.options.bundle.manifest.name} » démarré (mode ${mode.name}).`);
  }

  private update(dt: number): void {
    if (!this.runtime) return;
    this.input.update();
    this.playTime += dt;
    try {
      this.runtime.update(dt);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.loop.pause();
      this.log('error', err.message);
      this.events.emit('error', { error: err });
    }
  }

  /** Avance le jeu manuellement (tests, captures). */
  step(seconds: number): void {
    this.loop.step(seconds);
  }

  pause(): void {
    this.loop.pause();
  }

  resume(): void {
    this.loop.resume();
  }

  get paused(): boolean {
    return this.loop.paused;
  }

  async save(slot: string, label = ''): Promise<SaveSlotInfo> {
    if (!this.runtime) throw new Error('Jeu non démarré');
    const info = await this.saves.save(slot, this.runtime.serialize(), label, this.playTime);
    this.log('info', this.i18n.t('save.saved'));
    return info;
  }

  async load(slot: string): Promise<boolean> {
    if (!this.runtime) throw new Error('Jeu non démarré');
    const data = await this.saves.load(slot);
    if (!data) return false;
    await this.runtime.deserialize(data.state);
    this.playTime = data.playTime;
    this.log('info', this.i18n.t('save.loaded'));
    return true;
  }

  debugState(): Record<string, unknown> {
    return this.runtime?.getDebugState?.() ?? {};
  }

  setDebugValue(path: string, value: unknown): void {
    this.runtime?.setDebugValue?.(path, value);
    this.events.emit('state-changed', { reason: 'debug' });
  }

  destroy(): void {
    this.loop.stop();
    this.detachInput?.();
    this.detachInput = null;
    this.runtime?.destroy();
    this.runtime = null;
    void this.audio.dispose();
    this.events.clear();
  }
}

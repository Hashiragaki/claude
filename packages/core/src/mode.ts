import type { AssetRegistry } from './assets';
import type { AudioManager } from './audio';
import type { Emitter } from './events';
import type { I18n } from './i18n';
import type { InputManager } from './input';
import type { Diagnostic, ProjectBundle, ProjectManifestInput } from './project';
import type { Rng } from './rng';
import type { SaveManager } from './save';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type EngineEvents = {
  log: { level: LogLevel; message: string };
  /** L'état observable du jeu a changé (rafraîchit l'inspecteur de variables). */
  'state-changed': { reason: string };
  /** Fin de partie atteinte (écran de fin, game over…). */
  'game-end': { reason: 'end' | 'gameover' | 'quit' };
  error: { error: Error };
};

/** Options de lancement (ex. « jouer depuis ce label » dans l'éditeur). */
export interface RunOptions {
  /** VN : label de départ. */
  startLabel?: string;
  /** RPG : carte et position de départ. */
  startMap?: string;
  startX?: number;
  startY?: number;
  /** Affiche des informations de débogage (collisions, FPS…). */
  debug?: boolean;
  /** Passe l'écran titre. */
  skipTitle?: boolean;
}

/** Tout ce qu'un mode reçoit pour s'exécuter. */
export interface RuntimeContext {
  bundle: ProjectBundle;
  assets: AssetRegistry;
  input: InputManager;
  audio: AudioManager;
  saves: SaveManager;
  i18n: I18n;
  events: Emitter<EngineEvents>;
  rng: Rng;
  /** Élément DOM dans lequel dessiner ; `null` en mode sans affichage (tests). */
  mount: HTMLElement | null;
  options: RunOptions;
  log(level: LogLevel, message: string): void;
}

/** Instance d'un jeu en cours d'exécution. */
export interface GameRuntime {
  start(): Promise<void>;
  /** Logique à pas fixe (secondes). */
  update(dt: number): void;
  render?(alpha: number): void;
  destroy(): void;
  /** État sérialisable pour les sauvegardes. */
  serialize(): unknown;
  deserialize(state: unknown): void | Promise<void>;
  /** Variables exposées à l'inspecteur de l'éditeur. */
  getDebugState?(): Record<string, unknown>;
  setDebugValue?(path: string, value: unknown): void;
}

/** Fichier créé par un modèle de projet (texte ou JSON). */
export interface TemplateFile {
  path: string;
  content: string | object;
}

/** Asset à générer (procéduralement, de façon déterministe) à la création du projet. */
export interface TemplateAssetRequest {
  /** Alias utilisé par les scripts/cartes pour référencer l'asset. */
  alias: string;
  name: string;
  /** Identifiant du générateur (`image.svg`, `charset`, `tileset`, `sfx`, `music`, `model3d`…). */
  generator: string;
  params: Record<string, unknown>;
  seed: number;
  tags?: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  manifest: Partial<Pick<ProjectManifestInput, 'resolution' | 'pixelArt' | 'entry' | 'locale' | 'description'>> & {
    entry: string;
  };
  files: TemplateFile[];
  assets: TemplateAssetRequest[];
}

/** Définition d'un mode de jeu (plugin). */
export interface GameModeDefinition {
  id: string;
  name: string;
  description: string;
  /** Au moins un modèle « vide » et, idéalement, une démo. */
  templates: ProjectTemplate[];
  createRuntime(ctx: RuntimeContext): GameRuntime | Promise<GameRuntime>;
  /** Vérifie les fichiers du projet (erreurs de script, références manquantes…). */
  validate?(bundle: ProjectBundle): Promise<Diagnostic[]>;
}

/** Registre des modes disponibles. */
export class ModeRegistry {
  private readonly modes = new Map<string, GameModeDefinition>();

  constructor(modes: GameModeDefinition[] = []) {
    for (const m of modes) this.register(m);
  }

  register(mode: GameModeDefinition): void {
    if (this.modes.has(mode.id)) throw new Error(`Mode déjà enregistré : ${mode.id}`);
    this.modes.set(mode.id, mode);
  }

  get(id: string): GameModeDefinition {
    const mode = this.modes.get(id);
    if (!mode) throw new Error(`Mode inconnu : ${id}`);
    return mode;
  }

  has(id: string): boolean {
    return this.modes.has(id);
  }

  list(): GameModeDefinition[] {
    return [...this.modes.values()];
  }
}

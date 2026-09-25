import { PlatformerStateSchema, type PlatformerLevel, type PlatformerState, type PlatformerSystem } from './schema';
import type { HudView, PlatformerInput, SessionPhase, WorldEvent } from './types';
import { PlatformerWorld } from './world';

/** Durée (s) de l'écran de mort avant réapparition ou game over. */
const DYING_DURATION = 1;
/** Durée (s) de l'écran de fin de niveau avant le niveau suivant (ou game won). */
const LEVEL_COMPLETE_DURATION = 1.5;
/** Points marqués pour chaque événement (arrivée : voir {@link goalScore}). */
const COIN_SCORE = 10;
const STOMP_SCORE = 50;
const GOAL_BASE_SCORE = 500;
const GOAL_SECOND_SCORE = 10;

function goalScore(timeLeft: number | undefined): number {
  return GOAL_BASE_SCORE + Math.round(GOAL_SECOND_SCORE * (timeLeft ?? 0));
}

/**
 * Partie en cours (vies, score, progression entre niveaux), indépendante du rendu. Pilote un
 * {@link PlatformerWorld} par niveau et gère les transitions (mort, arrivée, fin de partie).
 *
 * Vie bonus : `coins` est un compteur cumulatif (jamais réinitialisé) ; une vie est accordée à
 * chaque multiple de `system.coinsPerLife` franchi (le contrat ne précise pas s'il doit être
 * remis à zéro ; ce choix évite de faire redescendre le score de pièces affiché au HUD).
 */
export class PlatformerSession {
  private _phase: SessionPhase = 'playing';
  private _world: PlatformerWorld;

  private currentLevelId: string;
  private lives: number;
  private coins: number;
  private score: number;
  /** Pièces déjà ramassées, par niveau (mis à jour en quittant un niveau ou via `state()`). */
  private readonly collectedByLevel: Record<string, string[]>;
  private readonly completedLevels: string[];
  private phaseTimer = 0;

  constructor(
    private readonly system: PlatformerSystem,
    private readonly loadLevel: (id: string) => PlatformerLevel,
    state?: PlatformerState,
  ) {
    if (state) {
      this.currentLevelId = state.level;
      this.lives = state.lives;
      this.coins = state.coins;
      this.score = state.score;
      this.collectedByLevel = { ...state.collected };
      this.completedLevels = [...state.completed];
      this._world = new PlatformerWorld(this.loadLevel(this.currentLevelId), system, {
        collected: this.collectedByLevel[this.currentLevelId] ?? [],
        checkpoint: state.checkpoint,
      });
    } else {
      this.currentLevelId = system.startLevel ?? system.levels[0];
      this.lives = system.lives;
      this.coins = 0;
      this.score = 0;
      this.collectedByLevel = {};
      this.completedLevels = [];
      this._world = new PlatformerWorld(this.loadLevel(this.currentLevelId), system);
    }
  }

  get phase(): SessionPhase {
    return this._phase;
  }

  get world(): PlatformerWorld {
    return this._world;
  }

  /** Avance la partie d'un pas. Pendant `dying`/`level-complete`, le monde est gelé (compte à rebours). */
  step(dt: number, input: PlatformerInput): WorldEvent[] {
    switch (this._phase) {
      case 'dying':
        this.stepDying(dt);
        return [];
      case 'level-complete':
        this.stepLevelComplete(dt);
        return [];
      case 'game-over':
      case 'game-won':
        return [];
      case 'playing': {
        const events = this._world.step(dt, input);
        for (const event of events) this.applyEvent(event);
        return events;
      }
    }
  }

  private applyEvent(event: WorldEvent): void {
    switch (event.type) {
      case 'coin':
        this.collectCoin();
        this.score += COIN_SCORE;
        break;
      case 'stomp':
        this.score += STOMP_SCORE;
        break;
      case 'goal':
        this.score += goalScore(this._world.timeLeft());
        if (!this.completedLevels.includes(this.currentLevelId)) this.completedLevels.push(this.currentLevelId);
        this._phase = 'level-complete';
        this.phaseTimer = LEVEL_COMPLETE_DURATION;
        break;
      case 'death':
        this._phase = 'dying';
        this.phaseTimer = DYING_DURATION;
        break;
      default:
        break;
    }
  }

  private collectCoin(): void {
    const before = this.coins;
    this.coins += 1;
    const per = this.system.coinsPerLife;
    if (per <= 0) return;
    const gained = Math.floor(this.coins / per) - Math.floor(before / per);
    if (gained > 0) this.lives += gained;
  }

  private stepDying(dt: number): void {
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    if (this.phaseTimer > 0) return;
    this.lives -= 1;
    if (this.lives > 0) {
      this._world.respawn();
      this._phase = 'playing';
    } else {
      this._phase = 'game-over';
    }
  }

  private stepLevelComplete(dt: number): void {
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    if (this.phaseTimer > 0) return;
    const nextId = this.nextLevelId();
    if (nextId) {
      this.goToLevel(nextId, undefined);
      this._phase = 'playing';
    } else {
      this._phase = 'game-won';
    }
  }

  /** Niveau suivant : `level.next` sinon le suivant dans `system.levels` (absent = fin du jeu). */
  private nextLevelId(): string | undefined {
    if (this._world.level.next) return this._world.level.next;
    const levels = this.system.levels;
    const idx = levels.indexOf(this.currentLevelId);
    if (idx === -1 || idx + 1 >= levels.length) return undefined;
    return levels[idx + 1];
  }

  /** Démarre (ou redémarre depuis son entrée) un niveau précis ; conserve vies, pièces et score. */
  startLevel(id: string): void {
    this.goToLevel(id, undefined);
    this._phase = 'playing';
  }

  private goToLevel(id: string, checkpoint: string | undefined): void {
    this.saveCurrentCollected();
    this.currentLevelId = id;
    this._world = new PlatformerWorld(this.loadLevel(id), this.system, {
      collected: this.collectedByLevel[id] ?? [],
      checkpoint,
    });
  }

  private saveCurrentCollected(): void {
    this.collectedByLevel[this.currentLevelId] = this._world.collectedIds();
  }

  hud(): HudView {
    const level = this._world.level;
    return {
      level: this.currentLevelId,
      levelName: level.name,
      lives: this.lives,
      coins: this.coins,
      score: this.score,
      timeLeft: this._world.timeLeft(),
      sign: this._world.currentSign()?.text,
    };
  }

  /** État sérialisable (sauvegarde), validé par {@link PlatformerStateSchema}. */
  state(): PlatformerState {
    this.saveCurrentCollected();
    return PlatformerStateSchema.parse({
      level: this.currentLevelId,
      lives: this.lives,
      coins: this.coins,
      score: this.score,
      collected: this.collectedByLevel,
      checkpoint: this._world.activeCheckpoint(),
      completed: this.completedLevels,
    });
  }
}

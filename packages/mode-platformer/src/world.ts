import { TILE_SIZE } from '@forge/core';
import type { z } from 'zod';
import { LevelGrid } from './grid';
import { moveBody, type Body } from './physics';
import type {
  CheckpointEntitySchema,
  EnemyEntity,
  Facing,
  GoalEntitySchema,
  PlatformerLevel,
  PlatformerSystem,
  SignEntity,
  SpringEntity,
} from './schema';
import type { EntityView, PlatformerInput, PlayerAnim, PlayerView, Rect, WorldEvent } from './types';

type CheckpointEntity = z.infer<typeof CheckpointEntitySchema>;
type GoalEntity = z.infer<typeof GoalEntitySchema>;

/** Boîte du joueur (px). */
export const PLAYER_WIDTH = 10;
export const PLAYER_HEIGHT = 20;
/** Boîte d'un ennemi (px). */
export const ENEMY_WIDTH = 14;
export const ENEMY_HEIGHT = 14;
const COIN_SIZE = 10;
const SPRING_WIDTH = 16;
const SPRING_HEIGHT = 8;
const CHECKPOINT_WIDTH = 8;
const CHECKPOINT_HEIGHT = 24;
const GOAL_WIDTH = 16;
const GOAL_HEIGHT = 32;
const SIGN_SIZE = 16;

/** Petit saut périodique des ennemis `hopper`. */
const ENEMY_HOP_SPEED = 160;
const ENEMY_HOP_INTERVAL = 1.2;
/** Durée (s) pendant laquelle bas + saut ignore les plateformes `oneway`. */
const DROP_THROUGH_DURATION = 0.25;
/** Rebond du joueur après un stomp (fraction de la vitesse de saut). */
const STOMP_BOUNCE_FACTOR = 0.6;

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(current + delta, target);
  if (current > target) return Math.max(current - delta, target);
  return current;
}

interface PlayerState extends Body {
  facing: Facing;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpCutApplied: boolean;
  dropTimer: number;
  invincibleTimer: number;
}

interface CoinState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  collected: boolean;
}

interface EnemyState extends Body {
  readonly id: string;
  readonly source: EnemyEntity;
  readonly baseX: number;
  facing: Facing;
  alive: boolean;
  hopTimer: number;
}

interface SpringState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly source: SpringEntity;
  triggered: boolean;
}

interface CheckpointState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  activated: boolean;
}

interface SignState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly source: SignEntity;
  overlapping: boolean;
}

export interface PlatformerWorldOptions {
  /** Identifiants des pièces déjà ramassées dans ce niveau (reprise de partie). */
  collected?: readonly string[];
  /** Point de contrôle actif au départ (le joueur y apparaît). */
  checkpoint?: string;
}

/**
 * Simulation d'un niveau de plateformer (aucun rendu). Un pas ({@link step}) avance la physique
 * du joueur et des ennemis, résout les contacts avec les entités et renvoie les événements
 * produits. `dead`/`finished` gèlent la simulation ; c'est à l'appelant (session) de réagir.
 */
export class PlatformerWorld {
  readonly grid: LevelGrid;

  private readonly playerState: PlayerState;
  private readonly coins: CoinState[];
  private readonly enemies: EnemyState[];
  private readonly springs: SpringState[];
  private readonly checkpoints: CheckpointState[];
  private readonly signs: SignState[];
  private readonly goal: GoalEntity | undefined;

  private checkpointId: string | undefined;
  private remainingTime: number | undefined;
  private _dead = false;
  private _finished = false;

  constructor(
    readonly level: PlatformerLevel,
    private readonly system: PlatformerSystem,
    options: PlatformerWorldOptions = {},
  ) {
    this.grid = new LevelGrid(level);
    const collectedSet = new Set(options.collected ?? []);
    this.coins = level.entities
      .filter((e) => e.type === 'coin')
      .map((e) => ({
        id: e.id,
        x: e.x * TILE_SIZE + (TILE_SIZE - COIN_SIZE) / 2,
        y: e.y * TILE_SIZE + (TILE_SIZE - COIN_SIZE) / 2,
        collected: collectedSet.has(e.id),
      }));
    this.enemies = level.entities.filter((e) => e.type === 'enemy').map((e) => this.spawnEnemy(e));
    this.springs = level.entities
      .filter((e) => e.type === 'spring')
      .map((e) => ({
        id: e.id,
        x: e.x * TILE_SIZE,
        y: e.y * TILE_SIZE + TILE_SIZE - SPRING_HEIGHT,
        source: e,
        triggered: false,
      }));
    this.checkpoints = level.entities
      .filter((e): e is CheckpointEntity => e.type === 'checkpoint')
      .map((e) => ({
        id: e.id,
        x: e.x * TILE_SIZE + (TILE_SIZE - CHECKPOINT_WIDTH) / 2,
        y: e.y * TILE_SIZE + TILE_SIZE - CHECKPOINT_HEIGHT,
        activated: options.checkpoint === e.id,
      }));
    this.signs = level.entities
      .filter((e) => e.type === 'sign')
      .map((e) => ({ id: e.id, x: e.x * TILE_SIZE, y: e.y * TILE_SIZE, source: e, overlapping: false }));
    this.goal = level.entities.find((e): e is GoalEntity => e.type === 'goal');

    this.checkpointId = options.checkpoint;
    this.remainingTime = level.timeLimit;
    this.playerState = this.spawnPlayer();
  }

  get dead(): boolean {
    return this._dead;
  }

  get finished(): boolean {
    return this._finished;
  }

  // -------------------------------------------------------------------------
  // Initialisation / réapparition
  // -------------------------------------------------------------------------

  private spawnTile(): { x: number; y: number } {
    const checkpoint = this.checkpointId ? this.checkpoints.find((c) => c.id === this.checkpointId) : undefined;
    if (checkpoint) {
      // Position au sol sous le point de contrôle (dont la boîte peut dépasser vers le haut).
      return {
        x: checkpoint.x + CHECKPOINT_WIDTH / 2 - PLAYER_WIDTH / 2,
        y: checkpoint.y + CHECKPOINT_HEIGHT - PLAYER_HEIGHT,
      };
    }
    const start = this.level.playerStart;
    return {
      x: start.x * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) / 2,
      y: start.y * TILE_SIZE + TILE_SIZE - PLAYER_HEIGHT,
    };
  }

  private spawnPlayer(): PlayerState {
    const { x, y } = this.spawnTile();
    return {
      x,
      y,
      w: PLAYER_WIDTH,
      h: PLAYER_HEIGHT,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 'right',
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      jumpCutApplied: false,
      dropTimer: 0,
      invincibleTimer: this.checkpointId !== undefined ? this.system.physics.invincibleTime : 0,
    };
  }

  private spawnEnemy(e: EnemyEntity): EnemyState {
    const x = e.x * TILE_SIZE + (TILE_SIZE - ENEMY_WIDTH) / 2;
    const y = e.y * TILE_SIZE + TILE_SIZE - ENEMY_HEIGHT;
    return {
      id: e.id,
      source: e,
      x,
      y,
      w: ENEMY_WIDTH,
      h: ENEMY_HEIGHT,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: e.facing,
      baseX: x,
      alive: true,
      hopTimer: ENEMY_HOP_INTERVAL,
    };
  }

  /** Replace le joueur au point de contrôle actif (sinon au départ), invincible un moment. */
  respawn(): void {
    const { x, y } = this.spawnTile();
    this.playerState.x = x;
    this.playerState.y = y;
    this.playerState.vx = 0;
    this.playerState.vy = 0;
    this.playerState.onGround = false;
    this.playerState.coyoteTimer = 0;
    this.playerState.jumpBufferTimer = 0;
    this.playerState.jumpCutApplied = false;
    this.playerState.dropTimer = 0;
    this.playerState.invincibleTimer = this.system.physics.invincibleTime;
    this._dead = false;
    for (const e of this.enemies) {
      e.x = e.source.x * TILE_SIZE + (TILE_SIZE - ENEMY_WIDTH) / 2;
      e.y = e.source.y * TILE_SIZE + TILE_SIZE - ENEMY_HEIGHT;
      e.vx = 0;
      e.vy = 0;
      e.onGround = false;
      e.facing = e.source.facing;
      e.alive = true;
      e.hopTimer = ENEMY_HOP_INTERVAL;
    }
    // Les pièces ramassées et le point de contrôle actif sont conservés.
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  step(dt: number, input: PlatformerInput): WorldEvent[] {
    const events: WorldEvent[] = [];
    if (this._dead || this._finished) return events;

    if (this.remainingTime !== undefined) {
      this.remainingTime = Math.max(0, this.remainingTime - dt);
      if (this.remainingTime <= 0) {
        this.die('time', events);
        return events;
      }
    }

    const prevPlayerBottom = this.playerState.y + this.playerState.h;
    this.stepPlayer(dt, input, events);

    if (this._dead) return events;

    if (this.playerState.y > this.level.height * TILE_SIZE) {
      this.die('fall', events);
      return events;
    }

    if (this.playerState.invincibleTimer > 0) {
      this.playerState.invincibleTimer = Math.max(0, this.playerState.invincibleTimer - dt);
    }

    for (const enemy of this.enemies) this.stepEnemy(enemy, dt);

    if (this.resolveEnemyContacts(prevPlayerBottom, events)) return events;

    this.resolveCoins(events);
    this.resolveSprings(events);
    this.resolveCheckpoints(events);
    if (this.resolveGoal(events)) return events;
    this.resolveSigns(events);

    return events;
  }

  private die(cause: 'enemy' | 'hazard' | 'fall' | 'time', events: WorldEvent[]): void {
    this._dead = true;
    this.playerState.vx = 0;
    this.playerState.vy = 0;
    events.push({ type: 'death', cause });
  }

  private stepPlayer(dt: number, input: PlatformerInput, events: WorldEvent[]): void {
    const physics = this.system.physics;
    const player = this.playerState;

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) player.facing = dir > 0 ? 'right' : 'left';
    const targetVx = dir * physics.runSpeed;
    const accel = physics.acceleration * (player.onGround ? 1 : physics.airControl);
    player.vx = approach(player.vx, targetVx, accel * dt);

    if (player.onGround) player.coyoteTimer = physics.coyoteTime;
    else player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);
    if (input.jumpPressed) player.jumpBufferTimer = physics.jumpBuffer;
    else player.jumpBufferTimer = Math.max(0, player.jumpBufferTimer - dt);

    let dropThrough = false;
    if (input.down && input.jumpPressed) {
      dropThrough = true;
      player.dropTimer = DROP_THROUGH_DURATION;
      player.jumpBufferTimer = 0;
    } else if (player.dropTimer > 0) {
      dropThrough = true;
    }
    player.dropTimer = Math.max(0, player.dropTimer - dt);

    if (!dropThrough && player.jumpBufferTimer > 0 && player.coyoteTimer > 0) {
      player.vy = -physics.jumpSpeed;
      player.onGround = false;
      player.coyoteTimer = 0;
      player.jumpBufferTimer = 0;
      player.jumpCutApplied = false;
      events.push({ type: 'jump' });
    }

    if (!input.jumpHeld && player.vy < 0 && !player.jumpCutApplied) {
      player.vy *= physics.jumpCutFactor;
      player.jumpCutApplied = true;
    }

    player.vy = Math.min(player.vy + physics.gravity * dt, physics.maxFallSpeed);

    const result = moveBody(player, dt, this.grid, { dropThrough });
    if (result.hazard) this.die('hazard', events);
  }

  private stepEnemy(enemy: EnemyState, dt: number): void {
    if (!enemy.alive) return;
    const physics = this.system.physics;

    const aheadX = enemy.facing === 'right' ? enemy.x + enemy.w + 1 : enemy.x - 1;
    const footY = enemy.y + enemy.h + 1;
    const groundAhead = this.grid.collisionAt(Math.floor(aheadX / TILE_SIZE), Math.floor(footY / TILE_SIZE));
    const hasGroundAhead = groundAhead === 'solid' || groundAhead === 'oneway';
    const wallCol = Math.floor(aheadX / TILE_SIZE);
    const wallRow = Math.floor((enemy.y + enemy.h / 2) / TILE_SIZE);
    const wallAhead = this.grid.collisionAt(wallCol, wallRow) === 'solid';
    const nextX = enemy.x + (enemy.facing === 'right' ? enemy.source.speed : -enemy.source.speed) * dt;
    const atRangeLimit =
      enemy.source.range !== undefined && Math.abs(nextX - enemy.baseX) > enemy.source.range * TILE_SIZE;

    if (wallAhead || !hasGroundAhead || atRangeLimit) enemy.facing = enemy.facing === 'right' ? 'left' : 'right';

    enemy.vx = enemy.facing === 'right' ? enemy.source.speed : -enemy.source.speed;
    enemy.vy = Math.min(enemy.vy + physics.gravity * dt, physics.maxFallSpeed);

    if (enemy.source.kind === 'hopper') {
      enemy.hopTimer -= dt;
      if (enemy.hopTimer <= 0 && enemy.onGround) {
        enemy.vy = -ENEMY_HOP_SPEED;
        enemy.hopTimer = ENEMY_HOP_INTERVAL;
      }
    }

    moveBody(enemy, dt, this.grid);
  }

  /** Boîte englobante courante du joueur (utilisée par les tests de chevauchement ci-dessous). */
  private playerBox(): Rect {
    return { x: this.playerState.x, y: this.playerState.y, w: this.playerState.w, h: this.playerState.h };
  }

  /** Renvoie `true` si le joueur vient de mourir au contact d'un ennemi (arrête le pas). */
  private resolveEnemyContacts(prevPlayerBottom: number, events: WorldEvent[]): boolean {
    const playerRect = this.playerBox();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (!rectsOverlap(playerRect, enemy)) continue;
      const enemyMidY = enemy.y + enemy.h / 2;
      if (this.playerState.vy > 0 && prevPlayerBottom <= enemyMidY) {
        enemy.alive = false;
        this.playerState.vy = -STOMP_BOUNCE_FACTOR * this.system.physics.jumpSpeed;
        events.push({ type: 'stomp', id: enemy.id });
      } else if (this.playerState.invincibleTimer <= 0) {
        this.die('enemy', events);
        return true;
      }
    }
    return false;
  }

  private resolveCoins(events: WorldEvent[]): void {
    const playerRect = this.playerBox();
    for (const coin of this.coins) {
      if (coin.collected) continue;
      if (!rectsOverlap(playerRect, { x: coin.x, y: coin.y, w: COIN_SIZE, h: COIN_SIZE })) continue;
      coin.collected = true;
      events.push({ type: 'coin', id: coin.id });
    }
  }

  private resolveSprings(events: WorldEvent[]): void {
    const playerRect = this.playerBox();
    for (const spring of this.springs) {
      spring.triggered = false;
      if (this.playerState.vy < 0) continue;
      if (!rectsOverlap(playerRect, { x: spring.x, y: spring.y, w: SPRING_WIDTH, h: SPRING_HEIGHT })) continue;
      this.playerState.vy = -spring.source.power;
      spring.triggered = true;
      events.push({ type: 'spring', id: spring.id });
    }
  }

  private resolveCheckpoints(events: WorldEvent[]): void {
    const playerRect = this.playerBox();
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.activated) continue;
      const box = { x: checkpoint.x, y: checkpoint.y, w: CHECKPOINT_WIDTH, h: CHECKPOINT_HEIGHT };
      if (!rectsOverlap(playerRect, box)) continue;
      checkpoint.activated = true;
      this.checkpointId = checkpoint.id;
      events.push({ type: 'checkpoint', id: checkpoint.id });
    }
  }

  /** Renvoie `true` si l'arrivée vient d'être atteinte (arrête le pas). */
  private resolveGoal(events: WorldEvent[]): boolean {
    if (!this.goal || this._finished) return false;
    const playerRect = this.playerBox();
    const goalRect: Rect = {
      x: this.goal.x * TILE_SIZE,
      y: this.goal.y * TILE_SIZE + TILE_SIZE - GOAL_HEIGHT,
      w: GOAL_WIDTH,
      h: GOAL_HEIGHT,
    };
    if (!rectsOverlap(playerRect, goalRect)) return false;
    this._finished = true;
    events.push({ type: 'goal' });
    return true;
  }

  private resolveSigns(events: WorldEvent[]): void {
    const playerRect = this.playerBox();
    for (const sign of this.signs) {
      const overlapping = rectsOverlap(playerRect, { x: sign.x, y: sign.y, w: SIGN_SIZE, h: SIGN_SIZE });
      if (overlapping && !sign.overlapping) events.push({ type: 'sign', id: sign.id, text: sign.source.text });
      sign.overlapping = overlapping;
    }
  }

  // -------------------------------------------------------------------------
  // Lecture (vues pour le rendu / HUD)
  // -------------------------------------------------------------------------

  player(): PlayerView {
    const p = this.playerState;
    return {
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      vx: p.vx,
      vy: p.vy,
      facing: p.facing,
      onGround: p.onGround,
      anim: this.playerAnim(),
      invincible: p.invincibleTimer > 0,
    };
  }

  private playerAnim(): PlayerAnim {
    if (this._dead) return 'dead';
    const p = this.playerState;
    if (!p.onGround) return p.vy < 0 ? 'jump' : 'fall';
    return Math.abs(p.vx) > 1 ? 'run' : 'idle';
  }

  entities(): EntityView[] {
    const views: EntityView[] = [];
    for (const c of this.coins) {
      views.push({ id: c.id, type: 'coin', x: c.x, y: c.y, w: COIN_SIZE, h: COIN_SIZE, active: !c.collected });
    }
    for (const e of this.enemies) {
      views.push({ id: e.id, type: 'enemy', x: e.x, y: e.y, w: e.w, h: e.h, active: e.alive, facing: e.facing });
    }
    for (const s of this.springs) {
      views.push({ id: s.id, type: 'spring', x: s.x, y: s.y, w: SPRING_WIDTH, h: SPRING_HEIGHT, active: true });
    }
    for (const c of this.checkpoints) {
      views.push({
        id: c.id,
        type: 'checkpoint',
        x: c.x,
        y: c.y,
        w: CHECKPOINT_WIDTH,
        h: CHECKPOINT_HEIGHT,
        active: true,
        triggered: c.activated,
      });
    }
    if (this.goal) {
      views.push({
        id: this.goal.id,
        type: 'goal',
        x: this.goal.x * TILE_SIZE,
        y: this.goal.y * TILE_SIZE + TILE_SIZE - GOAL_HEIGHT,
        w: GOAL_WIDTH,
        h: GOAL_HEIGHT,
        active: true,
        triggered: this._finished,
      });
    }
    for (const s of this.signs) {
      views.push({
        id: s.id,
        type: 'sign',
        x: s.x,
        y: s.y,
        w: SIGN_SIZE,
        h: SIGN_SIZE,
        active: true,
        triggered: s.overlapping,
      });
    }
    return views;
  }

  timeLeft(): number | undefined {
    return this.remainingTime;
  }

  currentSign(): SignEntity | undefined {
    return this.signs.find((s) => s.overlapping)?.source;
  }

  collectedIds(): string[] {
    return this.coins.filter((c) => c.collected).map((c) => c.id);
  }

  activeCheckpoint(): string | undefined {
    return this.checkpointId;
  }
}

import { TILE_SIZE } from '@forge/core';
import { Container, Graphics, Sprite, Texture, type DestroyOptions } from 'pixi.js';
import { ENEMY_HEIGHT, ENEMY_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH } from '../world';
import type { PlatformerEntity } from '../schema';
import type { EntityView, PlayerView } from '../types';
import type { PlatformViewContext } from './context';
import { loadCharsetFrames, type CharsetFrames } from './textures';

/** Ligne du charset utilisée (disposition Forge : ligne 2 = marche vers la droite). */
const CHARSET_ROW = 1;
/** Séquence de colonnes de la course, jouée à 8 images/s. */
const RUN_SEQUENCE = [0, 1, 2, 1];
const RUN_FPS = 8;
/** Clignotement du joueur invincible (allers-retours par seconde). */
const BLINK_RATE = 10;

function baseScale(frameWidth: number): number {
  return frameWidth > TILE_SIZE * 1.5 ? TILE_SIZE / frameWidth : 1;
}

/**
 * Personnage du joueur : charset animé (course/saut/chute/repos, miroir horizontal vers la
 * gauche) ou silhouette de remplacement si `system.playerCharset` est introuvable. Les pieds sont
 * ancrés sur le bas de la boîte de collision (`anchor` à `(0.5, 1)`).
 */
export class PlayerSprite extends Container {
  private readonly sprite = new Sprite(Texture.EMPTY);
  private readonly placeholder = new Graphics();
  private frames: CharsetFrames | null = null;
  private scaleFactor = 1;
  private runTimer = 0;
  private runIndex = 0;

  constructor() {
    super();
    this.sprite.anchor.set(0.5, 1);
    this.drawPlaceholder();
    this.addChild(this.sprite, this.placeholder);
  }

  private drawPlaceholder(): void {
    this.placeholder.clear();
    this.placeholder.roundRect(-PLAYER_WIDTH / 2, -PLAYER_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT, 2).fill(0x4b9cf5);
    this.placeholder.circle(0, -PLAYER_HEIGHT - 2, 3.5).fill(0xf1c7a3);
  }

  setCharset(frames: CharsetFrames | null): void {
    this.frames = frames;
    this.scaleFactor = frames ? baseScale(frames.frameWidth) : 1;
    this.sprite.visible = frames !== null;
    this.placeholder.visible = frames === null;
  }

  /** Met à jour la position, l'animation et le clignotement pour le pas de simulation courant. */
  sync(player: PlayerView, dt: number, time: number): void {
    this.position.set(Math.round(player.x + player.w / 2), Math.round(player.y + player.h));

    const running = player.onGround && player.anim === 'run';
    if (running) {
      this.runTimer += dt;
      const frameDuration = 1 / RUN_FPS;
      while (this.runTimer >= frameDuration) {
        this.runTimer -= frameDuration;
        this.runIndex = (this.runIndex + 1) % RUN_SEQUENCE.length;
      }
    } else {
      this.runTimer = 0;
      this.runIndex = 0;
    }
    const column = !player.onGround ? 0 : player.anim === 'run' ? RUN_SEQUENCE[this.runIndex] : 1;

    const mirror = player.facing === 'left';
    this.sprite.scale.set(mirror ? -this.scaleFactor : this.scaleFactor, this.scaleFactor);
    if (this.frames) this.sprite.texture = this.frames.rows[CHARSET_ROW]?.[column ?? 1] ?? Texture.EMPTY;

    const visible = !player.invincible || Math.floor(time * BLINK_RATE) % 2 === 0;
    this.sprite.alpha = visible ? 1 : 0;
    this.placeholder.alpha = visible ? 1 : 0;
    this.placeholder.scale.x = mirror ? -1 : 1;
  }
}

// ---------------------------------------------------------------------------
// Autres entités (pièces, ennemis, ressort, points de contrôle, arrivée, panneaux)
// ---------------------------------------------------------------------------

const COIN_SIZE = 10;
const SPRING_WIDTH = 16;
const SPRING_HEIGHT = 8;
const CHECKPOINT_WIDTH = 8;
const CHECKPOINT_HEIGHT = 24;
const GOAL_WIDTH = 16;
const GOAL_HEIGHT = 32;
const SIGN_SIZE = 16;

const COIN_SPIN_HZ = 2.2;

class CoinVisual extends Graphics {
  sync(view: EntityView, time: number): void {
    this.visible = view.active;
    if (!view.active) return;
    const squeeze = Math.abs(Math.cos(time * COIN_SPIN_HZ * Math.PI));
    this.clear();
    const cx = view.w / 2;
    const cy = view.h / 2;
    this.ellipse(cx, cy, Math.max(1.5, (COIN_SIZE / 2) * squeeze), COIN_SIZE / 2).fill(0xffd23f);
    this.ellipse(cx, cy, Math.max(1.5, (COIN_SIZE / 2) * squeeze) * 0.5, COIN_SIZE / 2 * 0.55).fill(0xffb000);
    this.position.set(view.x, view.y);
  }
}

class SpringVisual extends Graphics {
  sync(view: EntityView): void {
    this.visible = view.active;
    this.clear();
    // Comprimé (rebond visuel) la frame où le ressort est déclenché, détendu sinon.
    const h = view.triggered ? SPRING_HEIGHT * 0.55 : SPRING_HEIGHT;
    this.rect(0, SPRING_HEIGHT - h, SPRING_WIDTH, h).fill(0xc0c0c8);
    this.rect(0, SPRING_HEIGHT - h, SPRING_WIDTH, 2).fill(0xe6403a);
    this.position.set(view.x, view.y);
  }
}

class CheckpointVisual extends Graphics {
  sync(view: EntityView): void {
    this.visible = view.active;
    this.clear();
    const color = view.triggered ? 0x4ad66d : 0x8a8a9a;
    this.rect(0, 0, 2, CHECKPOINT_HEIGHT).fill(0x5d5d6d);
    this.poly([2, 2, 2 + CHECKPOINT_WIDTH - 2, 6, 2, 10]).fill(color);
    this.position.set(view.x, view.y);
  }
}

class GoalVisual extends Graphics {
  sync(view: EntityView): void {
    this.visible = view.active;
    this.clear();
    this.rect(0, 0, 2, GOAL_HEIGHT).fill(0x8a8a9a);
    this.poly([2, 2, 2 + GOAL_WIDTH - 4, 8, 2, 14]).fill(view.triggered ? 0xffd35a : 0xe6403a);
    this.position.set(view.x, view.y);
  }
}

class SignVisual extends Graphics {
  sync(view: EntityView): void {
    this.visible = view.active;
    this.clear();
    this.rect(SIGN_SIZE / 2 - 1, SIGN_SIZE / 2, 2, SIGN_SIZE / 2).fill(0x6b4423);
    this.roundRect(1, 0, SIGN_SIZE - 2, SIGN_SIZE / 2 + 2, 1).fill(0xb08850).stroke({ width: 1, color: 0x4a2f16 });
    this.position.set(view.x, view.y);
  }
}

/** Ennemi : charset animé si `sprite` est défini, sinon une forme simple (couleur selon le type). */
class EnemyVisual extends Container {
  private readonly sprite = new Sprite(Texture.EMPTY);
  private readonly placeholder = new Graphics();
  private frames: CharsetFrames | null = null;
  private scaleFactor = 1;
  private walkTimer = 0;
  private walkIndex = 0;

  constructor() {
    super();
    this.sprite.anchor.set(0.5, 1);
    this.addChild(this.sprite, this.placeholder);
  }

  setCharset(frames: CharsetFrames | null): void {
    this.frames = frames;
    this.scaleFactor = frames ? baseScale(frames.frameWidth) : 1;
    this.sprite.visible = frames !== null;
    this.placeholder.visible = frames === null;
    if (!frames) {
      this.placeholder.clear();
      this.placeholder.roundRect(-ENEMY_WIDTH / 2, -ENEMY_HEIGHT, ENEMY_WIDTH, ENEMY_HEIGHT, 3).fill(0xa03a3a);
      this.placeholder.circle(-ENEMY_WIDTH / 4, -ENEMY_HEIGHT * 0.7, 1.5).fill(0xffffff);
      this.placeholder.circle(ENEMY_WIDTH / 4, -ENEMY_HEIGHT * 0.7, 1.5).fill(0xffffff);
    }
  }

  sync(view: EntityView, dt: number): void {
    this.visible = view.active;
    if (!view.active) return;
    this.position.set(Math.round(view.x + view.w / 2), Math.round(view.y + view.h));
    const mirror = view.facing === 'left';
    this.sprite.scale.set(mirror ? -this.scaleFactor : this.scaleFactor, this.scaleFactor);
    this.placeholder.scale.x = mirror ? -1 : 1;
    if (!this.frames) return;
    this.walkTimer += dt;
    const frameDuration = 1 / RUN_FPS;
    while (this.walkTimer >= frameDuration) {
      this.walkTimer -= frameDuration;
      this.walkIndex = (this.walkIndex + 1) % RUN_SEQUENCE.length;
    }
    this.sprite.texture = this.frames.rows[CHARSET_ROW]?.[RUN_SEQUENCE[this.walkIndex] ?? 1] ?? Texture.EMPTY;
  }
}

type EntityVisual = CoinVisual | SpringVisual | CheckpointVisual | GoalVisual | SignVisual | EnemyVisual;

/**
 * Toutes les entités d'un niveau autres que le joueur. Une instance par entité du niveau (créée à
 * `build`, jamais recréée ensuite) ; `sync` ne fait que mettre à jour position/apparence/visibilité
 * depuis l'instantané `entities()` de la simulation.
 */
export class EntityLayer extends Container {
  private readonly visuals = new Map<string, EntityVisual>();
  private readonly charsets = new Map<string, Promise<CharsetFrames | null>>();

  constructor(private readonly ctx: PlatformViewContext) {
    super();
  }

  /** (Re)construit les entités pour ce niveau (charge les charsets des ennemis qui en ont un). */
  async build(entities: readonly PlatformerEntity[]): Promise<void> {
    this.clear();
    const enemyCharsetLoads: Promise<void>[] = [];
    for (const entity of entities) {
      const visual = this.createVisual(entity);
      if (!visual) continue;
      this.visuals.set(entity.id, visual);
      this.addChild(visual);
      if (entity.type === 'enemy' && entity.sprite) {
        const ref = entity.sprite;
        enemyCharsetLoads.push(
          this.charset(ref).then((frames) => {
            (visual as EnemyVisual).setCharset(frames);
          }),
        );
      } else if (visual instanceof EnemyVisual) {
        visual.setCharset(null);
      }
    }
    await Promise.all(enemyCharsetLoads);
  }

  private createVisual(entity: PlatformerEntity): EntityVisual | null {
    switch (entity.type) {
      case 'coin':
        return new CoinVisual();
      case 'enemy':
        return new EnemyVisual();
      case 'spring':
        return new SpringVisual();
      case 'checkpoint':
        return new CheckpointVisual();
      case 'goal':
        return new GoalVisual();
      case 'sign':
        return new SignVisual();
      default:
        return null;
    }
  }

  private charset(ref: string): Promise<CharsetFrames | null> {
    let promise = this.charsets.get(ref);
    if (!promise) {
      promise = loadCharsetFrames(this.ctx, ref);
      this.charsets.set(ref, promise);
    }
    return promise;
  }

  /** Applique l'instantané courant (`world.entities()`) aux vues déjà construites. */
  sync(views: readonly EntityView[], dt: number, time: number): void {
    for (const view of views) {
      const visual = this.visuals.get(view.id);
      if (!visual) continue;
      if (visual instanceof EnemyVisual) visual.sync(view, dt);
      else if (visual instanceof CoinVisual) visual.sync(view, time);
      else visual.sync(view);
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) visual.destroy({ children: true });
    this.visuals.clear();
    this.charsets.clear();
    this.removeChildren();
  }

  override destroy(options?: DestroyOptions): void {
    this.clear();
    super.destroy(options);
  }
}

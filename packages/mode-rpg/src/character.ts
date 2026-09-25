import type { Direction, EventPage, MoveStep, RpgEvent } from './schema';

/** Vitesse de marche du joueur (cases par seconde). */
export const PLAYER_SPEED = 4;
/** Vitesse par défaut des événements. */
export const NPC_SPEED = 3;
export const DASH_MULTIPLIER = 2;
/** Durée d'un pas `wait` d'un trajet. */
export const ROUTE_WAIT_SECONDS = 0.5;
/** Colonnes du charset pour le cycle de marche : pas A, repos, pas B, repos. */
export const WALK_CYCLE = [0, 1, 2, 1] as const;
/** Ligne du charset pour chaque direction. */
export const DIRECTION_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

export const DIRECTION_DELTA: Record<Direction, { x: number; y: number }> = {
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
};

export function opposite(dir: Direction): Direction {
  return dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left';
}

/** Direction dominante pour aller de (fx, fy) vers (tx, ty). */
export function directionTowards(fx: number, fy: number, tx: number, ty: number): Direction {
  const dx = tx - fx;
  const dy = ty - fy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : dx < 0 ? 'left' : 'down';
}

export interface MoveRoute {
  steps: MoveStep[];
  index: number;
  wait: number;
}

/**
 * Personnage sur la grille : position logique (`x`, `y`, destination du pas en cours) et position
 * affichée interpolée (`realX`, `realY`) qui avance vers la destination à `speed` cases/s.
 */
export class Character {
  realX: number;
  realY: number;
  /** Temps cumulé de marche (animation). */
  animTime = 0;
  route: MoveRoute | null = null;

  constructor(
    public x: number,
    public y: number,
    public direction: Direction = 'down',
    public speed = NPC_SPEED,
  ) {
    this.realX = x;
    this.realY = y;
  }

  get moving(): boolean {
    return this.realX !== this.x || this.realY !== this.y;
  }

  /** Colonne du charset à afficher (0 = pas A, 1 = repos, 2 = pas B). */
  get frameColumn(): number {
    if (!this.moving) return 1;
    return WALK_CYCLE[Math.floor(this.animTime * this.speed * 2) % 4] as number;
  }

  placeAt(x: number, y: number, direction?: Direction): void {
    this.x = this.realX = x;
    this.y = this.realY = y;
    if (direction) this.direction = direction;
  }

  /** Commence un pas d'une case (la validité doit avoir été vérifiée). */
  startMove(dir: Direction): void {
    this.direction = dir;
    this.x += DIRECTION_DELTA[dir].x;
    this.y += DIRECTION_DELTA[dir].y;
  }

  /** Avance l'interpolation ; renvoie vrai si un pas s'est terminé pendant cette frame. */
  update(dt: number, multiplier = 1): boolean {
    if (!this.moving) return false;
    const step = this.speed * multiplier * dt;
    this.animTime += dt * multiplier;
    this.realX = approach(this.realX, this.x, step);
    this.realY = approach(this.realY, this.y, step);
    return !this.moving;
  }

  setRoute(steps: MoveStep[]): void {
    this.route = steps.length ? { steps: [...steps], index: 0, wait: 0 } : null;
  }
}

function approach(value: number, target: number, step: number): number {
  if (Math.abs(target - value) <= step + 1e-9) return target;
  return value + Math.sign(target - value) * step;
}

/** Événement de carte : page active, verrouillage pendant une interaction, déplacement autonome. */
export class EventCharacter extends Character {
  pageIndex = -1;
  page: EventPage | null = null;
  erased = false;
  /** Verrouillé pendant son exécution (ne se déplace plus seul). */
  locked = false;
  prelockDirection: Direction | null = null;
  moveTimer = 0;

  constructor(readonly event: RpgEvent) {
    super(event.x, event.y, 'down', NPC_SPEED);
  }

  get id(): string {
    return this.event.id;
  }

  /** Page active et non effacé. */
  get active(): boolean {
    return this.page !== null && !this.erased;
  }

  /** Bloque le passage (priorité « same »). */
  get blocks(): boolean {
    return this.active && this.page?.priority === 'same';
  }

  get visible(): boolean {
    return this.active && this.page?.graphic != null;
  }

  /** Change de page (apparence, direction initiale, vitesse). */
  setPage(index: number): void {
    this.pageIndex = index;
    this.page = index >= 0 ? (this.event.pages[index] ?? null) : null;
    const graphic = this.page?.graphic;
    if (graphic && 'charset' in graphic && graphic.direction) this.direction = graphic.direction;
    this.speed = this.page?.speed ?? NPC_SPEED;
    this.moveTimer = 0;
  }
}

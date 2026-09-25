import { EMPTY_TILE, PLATFORM_TILE } from '@forge/core';
import { type EnemyKind, type Facing, type PlatformerEntityInput, type PlatformerLevelInput } from './schema';

/** Identifiant (ou index) d'un rôle de tuile `PLATFORM_TILE_ROLES` (ex. `'brick'`, `'spikes'`). */
export type PlatformTileName = keyof typeof PLATFORM_TILE;

export interface EnemyOptions {
  kind?: EnemyKind;
  /** Charset facultatif (sinon forme dessinée par défaut). */
  sprite?: string;
  speed?: number;
  facing?: Facing;
  /** Distance maximale de patrouille (cases) de part et d'autre du départ ; absent = illimitée. */
  range?: number;
}

/**
 * Construction de niveaux plateformer par code (modèles de projet, outils de l'éditeur et de
 * l'IA). Toutes les méthodes de tuiles ignorent les cases hors carte et sont chaînables.
 *
 * Repère : `x` colonnes de gauche à droite, `y` lignes de haut en bas (case 0 en haut). La couche
 * `terrain` porte les collisions (`PLATFORM_TILE_ROLES`), `decor` est purement visuelle.
 *
 * ```ts
 * const level = new LevelBuilder('niveau1', 40, 15, 'tileset prairie')
 *   .name('Prairie')
 *   .ground(0, 39, 12)
 *   .coins(6, 10, 10)
 *   .start(2, 11)
 *   .goal(36, 11)
 *   .build();
 * ```
 */
export class LevelBuilder {
  readonly width: number;
  readonly height: number;
  private readonly terrain: number[];
  private readonly decorLayer: number[];
  private readonly entities: PlatformerEntityInput[] = [];
  private readonly counters = new Map<string, number>();
  private levelName = '';
  private tilesetRef: string;
  private musicRef: string | undefined;
  private backgroundRef: string | undefined;
  private backgroundColorValue: string | undefined;
  private playerStartPos: { x: number; y: number } | undefined;
  private nextRef: string | undefined;
  private timeLimitValue: number | undefined;

  constructor(
    private readonly id: string,
    width: number,
    height: number,
    tileset: string,
  ) {
    if (width <= 0 || height <= 0) throw new Error('Dimensions de niveau invalides');
    this.width = Math.trunc(width);
    this.height = Math.trunc(height);
    const size = this.width * this.height;
    this.terrain = new Array<number>(size).fill(EMPTY_TILE);
    this.decorLayer = new Array<number>(size).fill(EMPTY_TILE);
    this.tilesetRef = tileset;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private roleIndex(role: PlatformTileName): number {
    const index = PLATFORM_TILE[role];
    if (index === undefined) throw new Error(`Rôle de tuile inconnu : « ${role} ».`);
    return index;
  }

  private setTerrain(x: number, y: number, tile: number): void {
    if (this.inBounds(x, y)) this.terrain[y * this.width + x] = tile;
  }

  private setDecor(x: number, y: number, tile: number): void {
    if (this.inBounds(x, y)) this.decorLayer[y * this.width + x] = tile;
  }

  private nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  private addEntity(entity: PlatformerEntityInput): this {
    this.entities.push(entity);
    return this;
  }

  // -- Réglages du niveau ----------------------------------------------------------------------

  name(name: string): this {
    this.levelName = name;
    return this;
  }

  music(ref: string | undefined): this {
    this.musicRef = ref;
    return this;
  }

  background(ref: string | undefined): this {
    this.backgroundRef = ref;
    return this;
  }

  backgroundColor(hex: string): this {
    this.backgroundColorValue = hex;
    return this;
  }

  next(id: string | undefined): this {
    this.nextRef = id;
    return this;
  }

  timeLimit(seconds: number | undefined): this {
    this.timeLimitValue = seconds;
    return this;
  }

  // -- Terrain -----------------------------------------------------------------------------------

  /**
   * Colonne de sol « en surface » : tuile `top` (bords `top_left` / `top_right`) sur la rangée
   * `y`, puis `fill` en dessous jusqu'au bas de la carte.
   */
  ground(x0: number, x1: number, y: number): this {
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) {
      const surface = x === lo && lo !== hi ? 'top_left' : x === hi && lo !== hi ? 'top_right' : 'top';
      this.setTerrain(x, y, this.roleIndex(surface));
      for (let yy = y + 1; yy < this.height; yy++) this.setTerrain(x, yy, this.roleIndex('fill'));
    }
    return this;
  }

  /** Rectangle plein (bornes incluses) sur la couche `terrain`, rôle donné par son nom. */
  fill(x0: number, y0: number, x1: number, y1: number, role: PlatformTileName): this {
    const index = this.roleIndex(role);
    const [xlo, xhi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ylo, yhi] = y0 <= y1 ? [y0, y1] : [y1, y0];
    for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) this.setTerrain(x, y, index);
    return this;
  }

  /** Rangée de plateforme fine (traversable par-dessous et vers le haut). */
  platform(x0: number, x1: number, y: number): this {
    const index = this.roleIndex('platform');
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) this.setTerrain(x, y, index);
    return this;
  }

  /** Rangée de blocs (brique par défaut). */
  blocks(x0: number, x1: number, y: number, role: PlatformTileName = 'brick'): this {
    const index = this.roleIndex(role);
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) this.setTerrain(x, y, index);
    return this;
  }

  /** Trou : vide (`-1`) sur toute la hauteur de la carte, pour les colonnes données. */
  pit(x0: number, x1: number): this {
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) for (let y = 0; y < this.height; y++) this.setTerrain(x, y, EMPTY_TILE);
    return this;
  }

  /** Rangée de pics (danger). */
  spikes(x0: number, x1: number, y: number): this {
    const index = this.roleIndex('spikes');
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) this.setTerrain(x, y, index);
    return this;
  }

  /** Rangée d'eau (danger). */
  water(x0: number, x1: number, y: number): this {
    const index = this.roleIndex('water');
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) this.setTerrain(x, y, index);
    return this;
  }

  /** Tuile de décor (couche `decor`, purement visuelle) à une case. */
  decor(x: number, y: number, role: PlatformTileName): this {
    this.setDecor(x, y, this.roleIndex(role));
    return this;
  }

  // -- Entités -----------------------------------------------------------------------------------

  /** Rangée de pièces. */
  coins(x0: number, x1: number, y: number): this {
    const [lo, hi] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) this.addEntity({ id: this.nextId('coin'), type: 'coin', x, y });
    return this;
  }

  enemy(x: number, y: number, options: EnemyOptions = {}): this {
    return this.addEntity({
      id: this.nextId('enemy'),
      type: 'enemy',
      x,
      y,
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.sprite ? { sprite: options.sprite } : {}),
      ...(options.speed !== undefined ? { speed: options.speed } : {}),
      ...(options.facing ? { facing: options.facing } : {}),
      ...(options.range !== undefined ? { range: options.range } : {}),
    });
  }

  spring(x: number, y: number, power?: number): this {
    return this.addEntity({
      id: this.nextId('spring'),
      type: 'spring',
      x,
      y,
      ...(power !== undefined ? { power } : {}),
    });
  }

  checkpoint(x: number, y: number): this {
    return this.addEntity({ id: this.nextId('checkpoint'), type: 'checkpoint', x, y });
  }

  goal(x: number, y: number): this {
    return this.addEntity({ id: this.nextId('goal'), type: 'goal', x, y });
  }

  sign(x: number, y: number, text: string): this {
    return this.addEntity({ id: this.nextId('sign'), type: 'sign', x, y, text });
  }

  /** Case de départ du joueur (pieds posés sur le bas de la case). */
  start(x: number, y: number): this {
    this.playerStartPos = { x, y };
    return this;
  }

  build(): PlatformerLevelInput {
    if (!this.playerStartPos) {
      throw new Error(`Niveau « ${this.id} » : point de départ manquant — appelez start(x, y).`);
    }
    const level: PlatformerLevelInput = {
      id: this.id,
      name: this.levelName,
      width: this.width,
      height: this.height,
      tileset: this.tilesetRef,
      layers: { terrain: [...this.terrain], decor: [...this.decorLayer] },
      playerStart: { ...this.playerStartPos },
      entities: this.entities.map((e) => ({ ...e })),
      ...(this.musicRef ? { music: this.musicRef } : {}),
      ...(this.backgroundRef ? { background: this.backgroundRef } : {}),
      ...(this.backgroundColorValue ? { backgroundColor: this.backgroundColorValue } : {}),
      ...(this.nextRef ? { next: this.nextRef } : {}),
      ...(this.timeLimitValue !== undefined ? { timeLimit: this.timeLimitValue } : {}),
    };
    return level;
  }
}

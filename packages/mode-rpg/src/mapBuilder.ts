import { EMPTY_TILE, Rng, TILE } from '@forge/core';
import {
  COLLISION_PASS,
  RpgEventSchema,
  RpgMapSchema,
  type Command,
  type Direction,
  type EncountersInput,
  type EventPageInput,
  type LayerName,
  type RpgEventInput,
  type RpgMap,
} from './schema';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapBuilderOptions {
  name?: string;
  width: number;
  height: number;
  /** Référence d'asset du tileset. */
  tileset: string;
  music?: string;
  /** Tuile de sol initiale (herbe par défaut, `-1` pour une carte vide). */
  fill?: number;
}

export interface NpcOptions {
  direction?: Direction;
  movement?: 'fixed' | 'random' | 'approach';
  speed?: number;
  /** Pages supplémentaires (conditions) après la page principale. */
  pages?: EventPageInput[];
}

export interface TeleportTarget {
  map: string;
  x: number;
  y: number;
  direction?: Direction;
}

/**
 * Construction de cartes par code (modèles de projet, outils de l'éditeur et de l'IA).
 * Toutes les méthodes ignorent les cases hors carte et sont chaînables.
 *
 * ```ts
 * const map = new MapBuilder('village', { width: 32, height: 24, tileset: 'tiles village' })
 *   .border('decor', TILE.bush)
 *   .house(4, 2, 7, 6)
 *   .tree(12, 5)
 *   .sign('panneau', 14, 13, 'Bienvenue !')
 *   .build();
 * ```
 */
export class MapBuilder {
  readonly width: number;
  readonly height: number;
  private readonly layers: Record<LayerName, number[]>;
  private collisionData: number[] | null = null;
  private readonly events: RpgMap['events'] = [];
  private readonly meta: Pick<RpgMap, 'id' | 'name' | 'tileset' | 'music' | 'encounters'>;

  constructor(id: string, options: MapBuilderOptions) {
    if (options.width <= 0 || options.height <= 0) throw new Error('Dimensions de carte invalides');
    this.width = Math.trunc(options.width);
    this.height = Math.trunc(options.height);
    const size = this.width * this.height;
    this.layers = {
      ground: new Array<number>(size).fill(options.fill ?? TILE.ground),
      decor: new Array<number>(size).fill(EMPTY_TILE),
      overhead: new Array<number>(size).fill(EMPTY_TILE),
    };
    this.meta = { id, name: options.name ?? id, tileset: options.tileset, music: options.music };
  }

  /** Reprend une carte existante pour la modifier. */
  static from(map: RpgMap): MapBuilder {
    const b = new MapBuilder(map.id, { name: map.name, width: map.width, height: map.height, tileset: map.tileset });
    b.meta.music = map.music;
    b.meta.encounters = map.encounters ? { ...map.encounters, troops: [...map.encounters.troops] } : undefined;
    for (const layer of ['ground', 'decor', 'overhead'] as const) {
      const src = map.layers[layer];
      if (src.length === b.width * b.height) b.layers[layer] = [...src];
    }
    if (map.collision?.length === b.width * b.height) b.collisionData = [...map.collision];
    for (const e of map.events) b.events.push(structuredClone(e));
    return b;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(layer: LayerName, x: number, y: number): number {
    return this.inBounds(x, y) ? (this.layers[layer][y * this.width + x] ?? EMPTY_TILE) : EMPTY_TILE;
  }

  set(layer: LayerName, x: number, y: number, tile: number): this {
    if (this.inBounds(x, y)) this.layers[layer][y * this.width + x] = tile;
    return this;
  }

  fill(layer: LayerName, tile: number): this {
    this.layers[layer].fill(tile);
    return this;
  }

  /** Rectangle plein. */
  rect(layer: LayerName, x: number, y: number, w: number, h: number, tile: number): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(layer, i, j, tile);
    return this;
  }

  /** Contour d'un rectangle. */
  frame(layer: LayerName, x: number, y: number, w: number, h: number, tile: number): this {
    for (let i = x; i < x + w; i++) this.set(layer, i, y, tile).set(layer, i, y + h - 1, tile);
    for (let j = y; j < y + h; j++) this.set(layer, x, j, tile).set(layer, x + w - 1, j, tile);
    return this;
  }

  /** Bordure de la carte (épaisseur en cases). */
  border(layer: LayerName, tile: number, thickness = 1): this {
    for (let t = 0; t < thickness; t++) this.frame(layer, t, t, this.width - t * 2, this.height - t * 2, tile);
    return this;
  }

  /** Ligne (Bresenham) entre deux cases. */
  line(layer: LayerName, x1: number, y1: number, x2: number, y2: number, tile: number): this {
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(layer, x, y, tile);
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  clear(layer: LayerName, x: number, y: number, w = 1, h = 1): this {
    return this.rect(layer, x, y, w, h, EMPTY_TILE);
  }

  /**
   * Parsème des tuiles au hasard (graine fixe → résultat reproductible), uniquement sur les cases
   * dont le sol fait partie de `onGround` et sans décor ni tuile haute.
   */
  scatter(
    layer: LayerName,
    tile: number,
    count: number,
    seed: number,
    options: { area?: Rect; onGround?: number[] } = {},
  ): this {
    const rng = new Rng(seed);
    const area = options.area ?? { x: 0, y: 0, w: this.width, h: this.height };
    const onGround = options.onGround ?? [TILE.ground, TILE.ground_alt];
    let placed = 0;
    for (let attempt = 0; attempt < count * 20 && placed < count; attempt++) {
      const x = rng.int(area.x, area.x + area.w - 1);
      const y = rng.int(area.y, area.y + area.h - 1);
      if (!this.inBounds(x, y) || !onGround.includes(this.get('ground', x, y))) continue;
      if (this.get('decor', x, y) !== EMPTY_TILE || this.get('overhead', x, y) !== EMPTY_TILE) continue;
      if (this.get(layer, x, y) === tile) continue;
      this.set(layer, x, y, tile);
      placed++;
    }
    return this;
  }

  /** Chemin au sol reliant les points par segments horizontaux puis verticaux. */
  path(points: [number, number][], width = 1): this {
    const put = (x: number, y: number) => {
      for (let oy = 0; oy < width; oy++) {
        for (let ox = 0; ox < width; ox++) {
          const px = x + ox;
          const py = y + oy;
          this.set('ground', px, py, (px * 7 + py * 13) % 11 === 0 ? TILE.path_alt : TILE.path);
        }
      }
    };
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i] as [number, number];
      const [bx, by] = points[i + 1] as [number, number];
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) put(x, ay);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) put(bx, y);
    }
    if (points.length === 1) put(points[0]![0], points[0]![1]);
    return this;
  }

  /**
   * Maison vue de face : toit (dernière rangée en bord de toit), mur avec fenêtres, puis mur avec
   * porte (au centre du bas par défaut, voir `MapBuilder.houseDoor`).
   */
  house(x: number, y: number, w: number, h: number, options: { doorOffset?: number; windows?: boolean } = {}): this {
    if (w < 3 || h < 3) throw new Error('Une maison mesure au moins 3×3 cases');
    const roofRows = h - 2;
    for (let j = 0; j < roofRows; j++) {
      this.rect('decor', x, y + j, w, 1, j === roofRows - 1 ? TILE.roof_edge : TILE.roof);
    }
    const wallY = y + h - 2;
    const doorY = y + h - 1;
    this.rect('decor', x, wallY, w, 2, TILE.wall);
    if (options.windows !== false) {
      for (let i = 1; i < w - 1; i += 2) this.set('decor', x + i, wallY, TILE.wall_window);
    }
    const doorX = x + (options.doorOffset ?? Math.floor(w / 2));
    this.set('decor', doorX, doorY, TILE.door);
    return this;
  }

  /** Position de la porte d'une maison construite avec les mêmes paramètres. */
  static houseDoor(x: number, y: number, w: number, h: number, doorOffset?: number): { x: number; y: number } {
    return { x: x + (doorOffset ?? Math.floor(w / 2)), y: y + h - 1 };
  }

  /**
   * Pièce intérieure : sol, mur du fond (avec fenêtres aux décalages donnés) et contour en haut
   * de mur. Le reste de la carte n'est pas modifié.
   */
  room(x: number, y: number, w: number, h: number, options: { floor?: number; windows?: number[] } = {}): this {
    this.rect('ground', x, y, w, h, options.floor ?? TILE.ground);
    this.frame('decor', x, y, w, h, TILE.wall_top);
    this.rect('decor', x + 1, y + 1, w - 2, 1, TILE.wall);
    for (const offset of options.windows ?? []) this.set('decor', x + 1 + offset, y + 1, TILE.wall_window);
    return this;
  }

  /** Arbre : tronc (décor, bloquant) et feuillage au-dessus (couche haute, passe devant le joueur). */
  tree(x: number, y: number): this {
    this.set('decor', x, y, TILE.tree_trunk);
    return this.set('overhead', x, y - 1, TILE.tree_top);
  }

  trees(positions: [number, number][]): this {
    for (const [x, y] of positions) this.tree(x, y);
    return this;
  }

  /** Étang : eau, eau profonde au centre s'il est assez grand. */
  pond(x: number, y: number, w: number, h: number): this {
    this.rect('ground', x, y, w, h, TILE.water);
    this.clear('decor', x, y, w, h);
    if (w >= 3 && h >= 3) this.rect('ground', x + 1, y + 1, w - 2, h - 2, TILE.deep_water);
    return this;
  }

  /** Pont (décor) rendu franchissable par surcharge de collision. */
  bridge(x: number, y: number, w: number, h: number): this {
    this.rect('decor', x, y, w, h, TILE.bridge);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.collision(i, j, COLLISION_PASS);
    return this;
  }

  /** Barrière en ligne droite. */
  fence(x1: number, y1: number, x2: number, y2: number): this {
    return this.line('decor', x1, y1, x2, y2, TILE.fence);
  }

  /** Hautes herbes (rôle `ground_detail`, utilisable pour les rencontres). */
  tallGrass(x: number, y: number, w: number, h: number): this {
    return this.rect('ground', x, y, w, h, TILE.ground_detail);
  }

  /** Surcharge de collision (0 = auto, 1 = bloqué, 2 = passage forcé). */
  collision(x: number, y: number, value: number): this {
    if (!this.inBounds(x, y)) return this;
    this.collisionData ??= new Array<number>(this.width * this.height).fill(0);
    this.collisionData[y * this.width + x] = value;
    return this;
  }

  music(ref: string | undefined): this {
    this.meta.music = ref;
    return this;
  }

  encounters(encounters: EncountersInput): this {
    this.meta.encounters = {
      troops: [...(encounters.troops ?? [])],
      rate: encounters.rate ?? 20,
      ...(encounters.onlyOnRole ? { onlyOnRole: encounters.onlyOnRole } : {}),
    };
    return this;
  }

  /** Ajoute un événement (validé et complété par le schéma). */
  event(event: RpgEventInput): this {
    if (this.events.some((e) => e.id === event.id)) throw new Error(`Événement en double : « ${event.id} »`);
    this.events.push(RpgEventSchema.parse(event));
    return this;
  }

  /** Personnage à qui parler (bouton d'action). */
  npc(
    id: string,
    name: string,
    x: number,
    y: number,
    charset: string,
    commands: Command[],
    options: NpcOptions = {},
  ): this {
    return this.event({
      id,
      name,
      x,
      y,
      pages: [
        {
          graphic: { charset, direction: options.direction ?? 'down' },
          trigger: 'action',
          movement: options.movement ?? 'fixed',
          ...(options.speed ? { speed: options.speed } : {}),
          commands,
        },
        ...(options.pages ?? []),
      ],
    });
  }

  /** Panneau : tuile `sign` + événement de lecture. */
  sign(id: string, x: number, y: number, text: string): this {
    this.set('decor', x, y, TILE.sign);
    return this.event({ id, name: 'Panneau', x, y, pages: [{ graphic: null, commands: [{ type: 'text', text }] }] });
  }

  /** Passage vers une autre carte, déclenché en marchant dessus (sous le joueur). */
  door(id: string, x: number, y: number, target: TeleportTarget, options: { sfx?: string; name?: string } = {}): this {
    const commands: Command[] = [];
    if (options.sfx) commands.push({ type: 'playSfx', ref: options.sfx });
    commands.push({ type: 'teleport', ...target });
    return this.event({
      id,
      name: options.name ?? 'Porte',
      x,
      y,
      pages: [{ graphic: null, trigger: 'touch', priority: 'below', commands }],
    });
  }

  /**
   * Coffre (tuile `crate`) : à l'ouverture, exécute `contents`, active l'interrupteur local A et
   * passe à la page « ouvert ».
   */
  chest(
    id: string,
    x: number,
    y: number,
    contents: Command[],
    options: { openedText?: string; sfx?: string; name?: string } = {},
  ): this {
    return this.event({
      id,
      name: options.name ?? 'Coffre',
      x,
      y,
      pages: [
        {
          graphic: { tile: TILE.crate },
          commands: [
            ...(options.sfx ? [{ type: 'playSfx', ref: options.sfx } satisfies Command] : []),
            ...contents,
            { type: 'setSelfSwitch', letter: 'A' },
          ],
        },
        {
          conditions: { selfSwitch: 'A' },
          graphic: { tile: TILE.crate },
          commands: [{ type: 'text', text: options.openedText ?? 'Le coffre est vide.' }],
        },
      ],
    });
  }

  build(): RpgMap {
    return RpgMapSchema.parse({
      ...this.meta,
      width: this.width,
      height: this.height,
      layers: { ground: [...this.layers.ground], decor: [...this.layers.decor], overhead: [...this.layers.overhead] },
      ...(this.collisionData ? { collision: [...this.collisionData] } : {}),
      events: this.events.map((e) => structuredClone(e)),
    });
  }
}

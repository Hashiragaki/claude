import { Emitter, type Rng, type TileRole, type TilesetInfo } from '@forge/core';
import {
  Character,
  DASH_MULTIPLIER,
  DIRECTION_DELTA,
  EventCharacter,
  PLAYER_SPEED,
  ROUTE_WAIT_SECONDS,
  directionTowards,
} from './character';
import { activePageIndex } from './conditions';
import { EventInterpreter, type InterpreterEffect, type WaitKind, type WaitState } from './interpreter';
import {
  DEFAULT_TILESET_INFO,
  cellHasRole,
  inBounds,
  isCellPassable,
  roleTable,
  tileAt,
} from './passability';
import {
  DIRECTIONS,
  type Command,
  type Direction,
  type LayerName,
  type RpgDatabase,
  type RpgMap,
  type RpgSystem,
} from './schema';
import { cloneState, createGameState, type GameState } from './state';

/** Entrées du joueur pour une frame (lues par l'hôte depuis l'InputManager). */
export interface WorldInput {
  /** Direction maintenue. */
  direction: Direction | null;
  /** Bouton d'action pressé à cette frame. */
  action: boolean;
  /** Course maintenue. */
  dash: boolean;
}

export const NO_INPUT: WorldInput = Object.freeze({ direction: null, action: false, dash: false });

/** Demandes que l'hôte (vue) doit traiter puis acquitter avec `world.resume(result)`. */
export type WorldRequest = Extract<
  WaitState,
  { kind: 'message' | 'choice' | 'battle' | 'teleport' | 'gameOver' | 'returnToTitle' }
>;

const HOST_KINDS: ReadonlySet<WaitKind> = new Set<WaitKind>([
  'message', 'choice', 'battle', 'teleport', 'gameOver', 'returnToTitle',
]);

export type WorldEvents = {
  'map-loaded': { mapId: string };
  changed: { reason: string };
  audio: { kind: 'sfx' | 'music' | 'stopMusic'; ref?: string };
  error: { message: string };
  encounter: { troop: string };
};

/** Données du projet nécessaires au monde. */
export interface WorldData {
  system: RpgSystem;
  database: RpgDatabase;
  maps: ReadonlyMap<string, RpgMap>;
  /** Métadonnées des tilesets par référence (disposition standard par défaut). */
  tilesets?: ReadonlyMap<string, TilesetInfo>;
}

export interface WorldOptions extends WorldData {
  rng: Rng;
  /** État de départ (nouvelle partie si absent). */
  state?: GameState;
}

interface MainRun {
  interp: EventInterpreter;
  event: EventCharacter | null;
}

/**
 * Logique de la carte : déplacements sur la grille, collisions, pages et déclencheurs
 * d'événements, interpréteurs (principal + parallèles), trajets, rencontres et téléportations.
 * Aucune dépendance au rendu : la vue lit `player`, `characters`, `map` et traite `request`.
 */
export class RpgWorld {
  readonly events = new Emitter<WorldEvents>();
  readonly system: RpgSystem;
  readonly database: RpgDatabase;
  readonly rng: Rng;
  readonly player = new Character(0, 0, 'down', PLAYER_SPEED);
  state: GameState;
  map!: RpgMap;
  tileset: TilesetInfo = DEFAULT_TILESET_INFO;
  characters: EventCharacter[] = [];
  /** Incrémenté à chaque chargement de carte (la vue se reconstruit). */
  mapVersion = 0;
  private roles: Map<number, TileRole> = roleTable(DEFAULT_TILESET_INFO);
  private main: MainRun | null = null;
  private readonly parallels = new Map<string, EventInterpreter>();
  private readonly routeWaiters = new Map<EventInterpreter, Character>();

  constructor(private readonly options: WorldOptions) {
    this.system = options.system;
    this.database = options.database;
    this.rng = options.rng;
    this.state = options.state ?? createGameState(options.system, options.database);
    this.loadMap(this.state.map, this.state.encounterCount <= 0);
  }

  // -------------------------------------------------------------------------
  // Accès
  // -------------------------------------------------------------------------

  /** Demande en attente de l'hôte (message, choix, combat, téléportation, fin…). */
  get request(): WorldRequest | null {
    return (this.requestOwner()?.waiting as WorldRequest | undefined) ?? null;
  }

  /** Un événement s'exécute (le joueur ne peut pas bouger). */
  get running(): boolean {
    return this.main !== null;
  }

  /** Le joueur ne peut pas agir (événement, demande en attente ou trajet imposé). */
  get busy(): boolean {
    return this.main !== null || this.requestOwner() !== null || this.player.route !== null;
  }

  /** Événement verrouillé par l'exécution principale. */
  get activeEvent(): EventCharacter | null {
    return this.main?.event ?? null;
  }

  get tileRoles(): ReadonlyMap<number, TileRole> {
    return this.roles;
  }

  mapById(id: string): RpgMap | undefined {
    return this.options.maps.get(id);
  }

  event(id: string): EventCharacter | undefined {
    return this.characters.find((c) => c.id === id);
  }

  /** Événements actifs à une position logique. */
  eventsAt(x: number, y: number): EventCharacter[] {
    return this.characters.filter((c) => c.active && c.x === x && c.y === y);
  }

  tileAt(layer: LayerName, x: number, y: number): number {
    return tileAt(this.map, layer, x, y);
  }

  /** Case en face d'un personnage. */
  front(char: Character = this.player): { x: number; y: number } {
    const d = DIRECTION_DELTA[char.direction];
    return { x: char.x + d.x, y: char.y + d.y };
  }

  /** Passabilité des tuiles seules (bords, rôles, surcharges). */
  isTilePassable(x: number, y: number): boolean {
    return isCellPassable(this.map, this.roles, x, y);
  }

  /** Passabilité pour le joueur (tuiles + événements bloquants). */
  isPassable(x: number, y: number): boolean {
    return this.isTilePassable(x, y) && !this.isOccupied(x, y, this.player);
  }

  canMove(char: Character, dir: Direction): boolean {
    const nx = char.x + DIRECTION_DELTA[dir].x;
    const ny = char.y + DIRECTION_DELTA[dir].y;
    return this.isTilePassable(nx, ny) && !this.isOccupied(nx, ny, char);
  }

  private isOccupied(x: number, y: number, mover: Character): boolean {
    for (const ev of this.characters) if (ev !== mover && ev.blocks && ev.x === x && ev.y === y) return true;
    if (mover !== this.player && this.player.x === x && this.player.y === y) {
      return !(mover instanceof EventCharacter) || mover.blocks;
    }
    return false;
  }

  /** Copie de l'état (sauvegarde). */
  snapshot(): GameState {
    return cloneState(this.state);
  }

  // -------------------------------------------------------------------------
  // Cartes, état, téléportation
  // -------------------------------------------------------------------------

  private loadMap(id: string, resetEncounters: boolean): void {
    const map = this.options.maps.get(id);
    if (!map) throw new Error(`Carte introuvable : « ${id} »`);
    for (const interp of this.parallels.values()) interp.stop();
    this.parallels.clear();
    this.routeWaiters.clear();
    if (this.main) this.main.event = null;
    this.map = map;
    this.tileset = this.options.tilesets?.get(map.tileset) ?? DEFAULT_TILESET_INFO;
    this.roles = roleTable(this.tileset);
    this.state.map = id;
    const { x, y, direction } = this.state.player;
    this.player.placeAt(x, y, direction);
    this.player.route = null;
    this.characters = map.events.map((e) => {
      const c = new EventCharacter(e);
      c.moveTimer = this.rng.float(0, 1);
      return c;
    });
    if (resetEncounters) this.resetEncounterCount();
    this.refresh();
    this.mapVersion++;
    this.events.emit('map-loaded', { mapId: id });
  }

  /** Remplace l'état courant (chargement de sauvegarde) et recharge la carte. */
  loadState(state: GameState): void {
    this.main?.interp.stop();
    this.main = null;
    this.state = state;
    this.loadMap(state.map, state.encounterCount <= 0);
  }

  /** Transfère le joueur (efface les événements « erase » de la carte). */
  teleport(mapId: string, x: number, y: number, direction?: Direction): boolean {
    if (!this.options.maps.has(mapId)) {
      this.report(`Téléportation : carte introuvable « ${mapId} »`);
      return false;
    }
    this.state.player = { x, y, direction: direction ?? this.player.direction };
    this.state.erased = [];
    this.loadMap(mapId, true);
    return true;
  }

  /** Réévalue la page active de chaque événement (la dernière dont les conditions sont vraies). */
  refresh(): void {
    const ctx = { state: this.state, mapId: this.map.id, rng: this.rng };
    for (const ev of this.characters) {
      ev.erased = this.state.erased.includes(ev.id);
      const index = ev.erased ? -1 : activePageIndex(ev.event, ctx);
      if (index === ev.pageIndex) continue;
      ev.setPage(index);
      const parallel = this.parallels.get(ev.id);
      if (parallel) {
        parallel.stop();
        this.parallels.delete(ev.id);
        this.routeWaiters.delete(parallel);
      }
    }
  }

  private resetEncounterCount(): void {
    const rate = Math.max(1, Math.round(this.map?.encounters?.rate ?? 20));
    this.state.encounterCount = this.rng.int(0, rate - 1) + this.rng.int(0, rate - 1) + 1;
  }

  // -------------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------------

  update(dt: number, input: WorldInput = NO_INPUT): void {
    this.state.playTime += dt;
    this.refresh();
    this.updateInterpreters(dt);
    this.refresh();
    if (!this.main && !this.requestOwner()) this.checkAutorun();
    this.updatePlayer(dt, input);
    this.updateEvents(dt);
    this.checkRoutes();
  }

  /** Acquitte la demande en cours (résultat selon le type : index de choix, issue du combat…). */
  resume(result?: unknown): void {
    const owner = this.requestOwner();
    if (!owner) return;
    const wait = owner.waiting as WorldRequest;
    if (wait.kind === 'teleport') this.teleport(wait.map, wait.x, wait.y, wait.direction);
    owner.resume(result);
    this.pump(owner);
    this.refresh();
  }

  /** Démarre un événement dans l'interpréteur principal (s'il est libre). */
  startEvent(ev: EventCharacter, byPlayer = false): boolean {
    if (this.main || !ev.active || !ev.page) return false;
    const graphic = ev.page.graphic;
    if (byPlayer && graphic && 'charset' in graphic) {
      ev.prelockDirection = ev.direction;
      ev.direction = directionTowards(ev.x, ev.y, this.player.x, this.player.y);
    }
    ev.locked = true;
    const interp = this.createInterpreter(ev.page.commands, ev.id);
    this.main = { interp, event: ev };
    interp.run();
    this.pump(interp);
    this.refresh();
    return true;
  }

  /** Exécute des commandes hors événement (rencontres, événements communs, outils). */
  runCommands(commands: readonly Command[]): boolean {
    if (this.main) return false;
    const interp = this.createInterpreter(commands, null);
    this.main = { interp, event: null };
    interp.run();
    this.pump(interp);
    this.refresh();
    return true;
  }

  /** Déclenche une rencontre (combat contre un groupe, fuite possible, défaite = game over). */
  startEncounter(troop: string): boolean {
    this.events.emit('encounter', { troop });
    return this.runCommands([{ type: 'battle', troop, canEscape: true, canLose: false }]);
  }

  private createInterpreter(commands: readonly Command[], eventId: string | null): EventInterpreter {
    return new EventInterpreter(
      commands,
      { state: this.state, rng: this.rng, onEffect: (e) => this.onEffect(e) },
      { mapId: this.map.id, eventId },
    );
  }

  private onEffect(effect: InterpreterEffect): void {
    switch (effect.type) {
      case 'sfx':
        this.events.emit('audio', { kind: 'sfx', ref: effect.ref });
        break;
      case 'music':
        this.events.emit('audio', { kind: 'music', ref: effect.ref });
        break;
      case 'stopMusic':
        this.events.emit('audio', { kind: 'stopMusic' });
        break;
      case 'changed':
        this.events.emit('changed', { reason: effect.reason });
        break;
      case 'error':
        this.report(effect.message);
        break;
    }
  }

  private report(message: string): void {
    this.events.emit('error', { message });
  }

  private requestOwner(): EventInterpreter | null {
    const main = this.main?.interp;
    if (main?.waiting && HOST_KINDS.has(main.waiting.kind)) return main;
    for (const p of this.parallels.values()) if (p.waiting && HOST_KINDS.has(p.waiting.kind)) return p;
    return null;
  }

  /** Traite les attentes gérées par le monde (trajets) et termine l'exécution principale. */
  private pump(interp: EventInterpreter): void {
    for (let guard = 0; guard < 1000; guard++) {
      const wait = interp.waiting;
      if (wait?.kind !== 'moveRoute' || this.routeWaiters.has(interp)) break;
      const target = this.resolveTarget(wait.target, interp);
      if (!target) {
        this.report(`Trajet : cible introuvable « ${wait.target} »`);
        interp.resume();
        continue;
      }
      target.setRoute(wait.steps);
      if (wait.wait && target.route) {
        this.routeWaiters.set(interp, target);
        break;
      }
      interp.resume();
    }
    if (this.main?.interp === interp && interp.finished) this.endMain();
  }

  private endMain(): void {
    const ev = this.main?.event;
    this.main = null;
    if (!ev) return;
    ev.locked = false;
    if (ev.prelockDirection) ev.direction = ev.prelockDirection;
    ev.prelockDirection = null;
  }

  private resolveTarget(target: string, interp: EventInterpreter): Character | null {
    if (target === 'player') return this.player;
    const id = target === 'this' ? interp.eventId : target;
    if (id === null || interp.mapId !== this.map.id) return null;
    return this.event(id) ?? null;
  }

  private updateInterpreters(dt: number): void {
    if (this.main) {
      const interp = this.main.interp;
      interp.update(dt);
      this.pump(interp);
    }
    for (const ev of this.characters) {
      if (!ev.active || ev.page?.trigger !== 'parallel') continue;
      let interp = this.parallels.get(ev.id);
      if (interp?.finished) {
        this.parallels.delete(ev.id);
        interp = undefined;
      }
      if (!interp) {
        interp = this.createInterpreter(ev.page.commands, ev.id);
        this.parallels.set(ev.id, interp);
        interp.run();
      } else {
        interp.update(dt);
      }
      this.pump(interp);
    }
  }

  private checkAutorun(): void {
    for (const ev of this.characters) {
      if (ev.active && ev.page?.trigger === 'autorun' && this.startEvent(ev, false)) return;
    }
  }

  private checkRoutes(): void {
    for (const [interp, target] of [...this.routeWaiters]) {
      if (target.route || target.moving) continue;
      this.routeWaiters.delete(interp);
      interp.resume();
      this.pump(interp);
    }
  }

  // -------------------------------------------------------------------------
  // Joueur
  // -------------------------------------------------------------------------

  private syncPlayer(): void {
    const p = this.player;
    const s = this.state.player;
    s.x = p.x;
    s.y = p.y;
    s.direction = p.direction;
  }

  private updatePlayer(dt: number, input: WorldInput): void {
    const p = this.player;
    if (p.route) {
      this.advanceRoute(p, dt);
      if (p.update(dt)) this.state.steps++;
      this.syncPlayer();
      return;
    }
    if (!p.moving && !this.busy) this.handlePlayerInput(input);
    if (!p.moving) return;
    const multiplier = input.dash && this.state.flags.dash ? DASH_MULTIPLIER : 1;
    if (p.update(dt, multiplier)) {
      this.onPlayerArrive();
      if (!p.moving && !this.busy && input.direction) this.handleMove(input.direction);
    }
  }

  private handlePlayerInput(input: WorldInput): void {
    if (input.action && this.checkAction()) return;
    if (input.direction) this.handleMove(input.direction);
  }

  private handleMove(dir: Direction): void {
    const p = this.player;
    p.direction = dir;
    if (this.canMove(p, dir)) p.startMove(dir);
    else this.checkBump();
    this.syncPlayer();
  }

  /** Déclencheur « touch » d'un événement bloquant en face. */
  private checkBump(): void {
    const f = this.front();
    for (const ev of this.eventsAt(f.x, f.y)) {
      if (ev.blocks && ev.page?.trigger === 'touch' && this.startEvent(ev, true)) return;
    }
  }

  /** Bouton d'action : événement sous le joueur (priorité below/above) puis en face (priorité same). */
  private checkAction(): boolean {
    const p = this.player;
    for (const ev of this.eventsAt(p.x, p.y)) {
      if (ev.page?.priority !== 'same' && ev.page?.trigger === 'action' && this.startEvent(ev, true)) return true;
    }
    const f = this.front();
    for (const ev of this.eventsAt(f.x, f.y)) {
      const trigger = ev.page?.trigger;
      if (ev.page?.priority === 'same' && (trigger === 'action' || trigger === 'touch') && this.startEvent(ev, true)) {
        return true;
      }
    }
    return false;
  }

  private onPlayerArrive(): void {
    const p = this.player;
    this.state.steps++;
    this.syncPlayer();
    for (const ev of this.eventsAt(p.x, p.y)) {
      if (ev.page?.priority !== 'same' && ev.page?.trigger === 'touch' && this.startEvent(ev, true)) return;
    }
    this.checkEncounter();
  }

  private checkEncounter(): void {
    const enc = this.map.encounters;
    if (!enc || enc.troops.length === 0 || !this.state.flags.encounters || this.busy) return;
    if (enc.onlyOnRole && !cellHasRole(this.map, this.roles, this.player.x, this.player.y, enc.onlyOnRole)) return;
    this.state.encounterCount -= 1;
    if (this.state.encounterCount > 0) return;
    this.resetEncounterCount();
    this.startEncounter(this.rng.pick(enc.troops));
  }

  // -------------------------------------------------------------------------
  // Événements : trajets et déplacements autonomes
  // -------------------------------------------------------------------------

  private updateEvents(dt: number): void {
    for (const ev of this.characters) {
      if (!ev.active) continue;
      if (ev.route) this.advanceRoute(ev, dt);
      else if (!ev.locked && !ev.moving) this.autonomousMove(ev, dt);
      ev.update(dt);
    }
  }

  /** Exécute le pas suivant d'un trajet (un pas bloqué est ignoré, le personnage se tourne). */
  private advanceRoute(char: Character, dt: number): void {
    const route = char.route;
    if (!route || char.moving) return;
    if (route.wait > 0) {
      route.wait -= dt;
      return;
    }
    const step = route.steps[route.index++];
    switch (step) {
      case undefined:
        char.route = null;
        return;
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        if (this.canMove(char, step)) char.startMove(step);
        else char.direction = step;
        return;
      case 'turnUp':
        char.direction = 'up';
        return;
      case 'turnDown':
        char.direction = 'down';
        return;
      case 'turnLeft':
        char.direction = 'left';
        return;
      case 'turnRight':
        char.direction = 'right';
        return;
      case 'wait':
        route.wait = ROUTE_WAIT_SECONDS;
        return;
    }
  }

  private autonomousMove(ev: EventCharacter, dt: number): void {
    const movement = ev.page?.movement ?? 'fixed';
    if (movement === 'fixed') return;
    ev.moveTimer -= dt;
    if (ev.moveTimer > 0) return;
    if (movement === 'random') {
      ev.moveTimer = this.rng.float(1, 3);
      this.tryEventMove(ev, this.rng.pick(DIRECTIONS));
      return;
    }
    ev.moveTimer = this.rng.float(0.2, 0.6);
    const p = this.player;
    const dx = p.x - ev.x;
    const dy = p.y - ev.y;
    const primary = directionTowards(ev.x, ev.y, p.x, p.y);
    if (this.tryEventMove(ev, primary) || Math.abs(dx) + Math.abs(dy) <= 1) return;
    const vertical: Direction | null = dy > 0 ? 'down' : dy < 0 ? 'up' : null;
    const horizontal: Direction | null = dx > 0 ? 'right' : dx < 0 ? 'left' : null;
    const secondary = Math.abs(dx) > Math.abs(dy) ? vertical : horizontal;
    if (secondary) this.tryEventMove(ev, secondary);
  }

  private tryEventMove(ev: EventCharacter, dir: Direction): boolean {
    ev.direction = dir;
    if (this.canMove(ev, dir)) {
      ev.startMove(dir);
      return true;
    }
    const f = this.front(ev);
    const touchesPlayer = this.player.x === f.x && this.player.y === f.y;
    if (touchesPlayer && ev.blocks && ev.page?.trigger === 'touch' && !this.busy) this.startEvent(ev, false);
    return false;
  }

  // -------------------------------------------------------------------------
  // Chemins
  // -------------------------------------------------------------------------

  /**
   * Plus court chemin (BFS) du joueur vers (tx, ty), en évitant tuiles et événements bloquants.
   * Avec `adjacent`, s'arrête sur une case voisine de la cible (pour parler à un PNJ).
   */
  findPath(tx: number, ty: number, options: { adjacent?: boolean } = {}): Direction[] | null {
    const w = this.map.width;
    const start = { x: this.player.x, y: this.player.y };
    const isGoal = (x: number, y: number) =>
      options.adjacent ? Math.abs(x - tx) + Math.abs(y - ty) === 1 : x === tx && y === ty;
    if (isGoal(start.x, start.y)) return [];
    const prev = new Map<number, { from: number; dir: Direction }>();
    const startKey = start.y * w + start.x;
    const seen = new Set<number>([startKey]);
    const queue = [startKey];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head] as number;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const dir of DIRECTIONS) {
        const nx = cx + DIRECTION_DELTA[dir].x;
        const ny = cy + DIRECTION_DELTA[dir].y;
        const key = ny * w + nx;
        if (!inBounds(this.map, nx, ny) || seen.has(key) || !this.isPassable(nx, ny)) continue;
        seen.add(key);
        prev.set(key, { from: cur, dir });
        if (isGoal(nx, ny)) {
          const path: Direction[] = [];
          for (let k = key; k !== startKey; ) {
            const step = prev.get(k) as { from: number; dir: Direction };
            path.unshift(step.dir);
            k = step.from;
          }
          return path;
        }
        queue.push(key);
      }
    }
    return null;
  }
}

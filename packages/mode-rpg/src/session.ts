import type { AssetKind, RuntimeContext, Value } from '@forge/core';
import { BattleSystem, type BattleResult } from './battle';
import { loadRpgProject, type RpgProjectData } from './loader';
import type { SystemSfx } from './schema';
import {
  MAX_GOLD,
  addItem,
  createGameState,
  itemCount,
  parseGameState,
  reviveFallen,
  setSwitch,
  setVariable,
  type GameState,
} from './state';
import { extendI18n } from './strings';
import { RpgWorld, type WorldRequest } from './world';

export type BattleRequest = Extract<WorldRequest, { kind: 'battle' }>;

export interface StartOverrides {
  startMap?: string;
  startX?: number;
  startY?: number;
}

/**
 * Partie en cours, indépendante du rendu : données du projet, monde, audio, sauvegarde et
 * inspecteur. Partagée par le runtime PixiJS et le runtime sans affichage.
 */
export class RpgSession {
  data: RpgProjectData | null = null;
  world: RpgWorld | null = null;
  private detachWorld: (() => void)[] = [];
  private readonly warned = new Set<string>();

  constructor(readonly ctx: RuntimeContext) {}

  get project(): RpgProjectData {
    if (!this.data) throw new Error('Projet RPG non chargé');
    return this.data;
  }

  /** Charge système, base de données, cartes et tilesets ; journalise les problèmes. */
  async load(): Promise<RpgProjectData> {
    extendI18n(this.ctx.i18n);
    const { bundle, options, assets } = this.ctx;
    this.data = await loadRpgProject(bundle.files, {
      entry: bundle.manifest.entry,
      assets,
      extraMaps: options.startMap ? [options.startMap] : [],
    });
    for (const p of this.data.problems) {
      this.ctx.log(p.severity === 'error' ? 'error' : 'warn', `${p.file} : ${p.message}`);
    }
    return this.data;
  }

  /** Nouvelle partie (en tenant compte de « jouer depuis ici »). */
  newGame(overrides: StartOverrides = this.ctx.options): RpgWorld {
    const { system, database, maps } = this.project;
    const state = createGameState(system, database);
    if (overrides.startMap && maps.has(overrides.startMap)) {
      state.map = overrides.startMap;
      if (overrides.startMap !== system.startMap) {
        const map = maps.get(overrides.startMap);
        state.player.x = Math.floor((map?.width ?? 1) / 2);
        state.player.y = Math.floor((map?.height ?? 1) / 2);
      }
    } else if (overrides.startMap) {
      this.ctx.log('warn', `Carte de départ demandée introuvable : « ${overrides.startMap} ».`);
    }
    if (overrides.startX !== undefined) state.player.x = overrides.startX;
    if (overrides.startY !== undefined) state.player.y = overrides.startY;
    return this.setState(state);
  }

  /** Remplace la partie par un état (nouvelle partie ou sauvegarde). */
  setState(state: GameState): RpgWorld {
    if (!this.project.maps.has(state.map)) throw new Error(`Carte inconnue : « ${state.map} »`);
    this.disposeWorld();
    const world = new RpgWorld({ ...this.project, rng: this.ctx.rng, state });
    this.world = world;
    this.detachWorld = [
      world.events.on('changed', ({ reason }) => this.ctx.events.emit('state-changed', { reason })),
      world.events.on('audio', (e) => {
        if (e.kind === 'sfx') this.playSfx(e.ref);
        else if (e.kind === 'music') this.playMusic(e.ref);
        else this.stopMusic();
      }),
      world.events.on('error', ({ message }) => this.ctx.log('warn', message)),
      world.events.on('map-loaded', () => {
        this.playMapMusic();
        this.ctx.events.emit('state-changed', { reason: 'map' });
      }),
    ];
    this.playMapMusic();
    this.ctx.events.emit('state-changed', { reason: 'load' });
    return world;
  }

  serialize(): GameState | null {
    return this.world?.snapshot() ?? null;
  }

  deserialize(data: unknown): RpgWorld {
    return this.setState(parseGameState(data));
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  createBattle(request: Pick<BattleRequest, 'troop' | 'canEscape'>): BattleSystem {
    if (!this.world) throw new Error('Aucune partie en cours');
    return new BattleSystem({
      state: this.world.state,
      database: this.project.database,
      troop: request.troop,
      rng: this.ctx.rng,
      canEscape: request.canEscape,
      translate: (key, params) => this.ctx.i18n.t(key, params),
    });
  }

  /** Rend la main au monde après un combat (les K.O. reviennent à 1 PV après une défaite permise). */
  finishBattle(request: BattleRequest, result: BattleResult): void {
    const world = this.world;
    if (!world) return;
    if (result === 'lose' && request.canLose) reviveFallen(world.state);
    world.resume(result);
    this.ctx.events.emit('state-changed', { reason: 'battle' });
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.ctx.log('warn', message);
  }

  /** URL d'un asset référencé (alias, id ou chemin), ou `null` avec un avertissement. */
  assetUrl(ref: string | undefined, kind?: AssetKind): string | null {
    if (!ref) return null;
    const meta = this.ctx.assets.resolve(ref, kind);
    if (!meta) {
      this.warnOnce(`Asset introuvable : « ${ref} »${kind ? ` (${kind})` : ''}`);
      return null;
    }
    return this.ctx.assets.url(meta);
  }

  playMusic(ref: string | undefined, options: { loop?: boolean } = {}): void {
    const url = this.assetUrl(ref, 'music');
    if (!url) return;
    this.ctx.audio
      .playBgm(url, { loop: options.loop ?? true })
      .catch((e: unknown) => this.warnOnce(`Musique « ${ref} » illisible : ${e instanceof Error ? e.message : e}`));
  }

  stopMusic(): void {
    this.ctx.audio.stopBgm();
  }

  playSfx(ref: string | undefined): void {
    const url = this.assetUrl(ref, 'sfx');
    if (!url) return;
    this.ctx.audio
      .playSfx(url)
      .catch((e: unknown) => this.warnOnce(`Son « ${ref} » illisible : ${e instanceof Error ? e.message : e}`));
  }

  playSystemSfx(key: SystemSfx): void {
    const ref = this.data?.system.sfx[key];
    if (ref) this.playSfx(ref);
  }

  /** Musique de la carte (ou musique de carte par défaut) ; sinon la musique courante continue. */
  playMapMusic(): void {
    const ref = this.world?.map.music ?? this.data?.system.mapMusic;
    if (ref) this.playMusic(ref);
  }

  // -------------------------------------------------------------------------
  // Inspecteur de l'éditeur
  // -------------------------------------------------------------------------

  getDebugState(): Record<string, unknown> {
    const s = this.world?.state;
    if (!s) return {};
    return {
      map: s.map,
      player: { ...s.player },
      switches: { ...s.switches },
      variables: { ...s.variables },
      gold: s.gold,
      items: { ...s.items },
      party: s.party.map((a) => ({
        id: a.id,
        name: a.name,
        level: a.level,
        exp: a.exp,
        hp: a.hp,
        maxHp: a.maxHp,
        mp: a.mp,
        maxMp: a.maxMp,
      })),
    };
  }

  /** Modifie `switches.NOM`, `variables.NOM`, `items.ID` ou `gold` depuis l'inspecteur. */
  setDebugValue(path: string, value: unknown): void {
    const world = this.world;
    if (!world) return;
    const s = world.state;
    const dot = path.indexOf('.');
    const root = dot < 0 ? path : path.slice(0, dot);
    const name = dot < 0 ? '' : path.slice(dot + 1);
    switch (root) {
      case 'switches':
        if (name) setSwitch(s, name, toBoolean(value));
        break;
      case 'variables':
        if (name) setVariable(s, name, toValue(value));
        break;
      case 'items':
        if (name) addItem(s, name, Math.trunc(toNumber(value)) - itemCount(s, name));
        break;
      case 'gold':
        s.gold = Math.max(0, Math.min(MAX_GOLD, Math.trunc(toNumber(value))));
        break;
      default:
        this.ctx.log('warn', `Valeur de débogage inconnue : « ${path} »`);
        return;
    }
    world.refresh();
    this.ctx.events.emit('state-changed', { reason: 'debug' });
  }

  dispose(): void {
    this.disposeWorld();
    this.world = null;
  }

  private disposeWorld(): void {
    for (const off of this.detachWorld) off();
    this.detachWorld = [];
    this.world?.events.clear();
  }
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'string') return ['true', 'on', 'oui', '1'].includes(value.trim().toLowerCase());
  return value === true || value === 1;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function toValue(value: unknown): Value {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) ? n : value;
  }
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Value;
  } catch {
    return null;
  }
}

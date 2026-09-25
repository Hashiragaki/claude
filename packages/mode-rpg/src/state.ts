import type { Value } from '@forge/core';
import { z } from 'zod';
import {
  DirectionSchema,
  PLAY_FLAGS,
  type ActorDef,
  type Direction,
  type PlayFlag,
  type RpgDatabase,
  type RpgSystem,
  type SelfSwitchLetter,
  type VariableOp,
} from './schema';

export const MAX_LEVEL = 99;
export const MAX_ITEMS = 99;
export const MAX_GOLD = 9_999_999;
export const STATE_VERSION = 1;

/** Caractéristiques de combat. */
export interface BattlerStats {
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  mag: number;
  agi: number;
}

/** Membre de l'équipe : points courants, niveau, expérience et caractéristiques dérivées. */
export interface ActorState extends BattlerStats {
  id: string;
  name: string;
  level: number;
  /** Expérience totale accumulée. */
  exp: number;
  hp: number;
  mp: number;
}

/** État complet d'une partie (JSON pur : sauvegardes, inspecteur de l'éditeur). */
export interface GameState {
  version: number;
  switches: Record<string, boolean>;
  variables: Record<string, Value>;
  /** Clés `${mapId}:${eventId}:${lettre}`. */
  selfSwitches: Record<string, boolean>;
  /** Identifiant d'objet → quantité. */
  items: Record<string, number>;
  gold: number;
  party: ActorState[];
  map: string;
  player: { x: number; y: number; direction: Direction };
  /** Événements effacés sur la carte courante (jusqu'au prochain chargement de carte). */
  erased: string[];
  steps: number;
  /** Pas restants avant la prochaine rencontre aléatoire. */
  encounterCount: number;
  /** Temps de jeu en secondes. */
  playTime: number;
  flags: Record<PlayFlag, boolean>;
}

// ---------------------------------------------------------------------------
// Acteurs : courbe d'expérience et progression
// ---------------------------------------------------------------------------

/** Expérience totale nécessaire pour atteindre `level` (0 au niveau 1). */
export function expForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(20 * (level - 1) ** 1.6);
}

/** Croissance relative par niveau de chaque caractéristique. */
export const STAT_GROWTH: Record<keyof BattlerStats, number> = {
  maxHp: 0.12,
  maxMp: 0.1,
  atk: 0.08,
  def: 0.08,
  mag: 0.08,
  agi: 0.06,
};

/** Caractéristiques d'un acteur au niveau donné (valeurs de base au niveau initial de la base). */
export function actorStatsAt(def: ActorDef, level: number): BattlerStats {
  const n = Math.max(1, Math.min(MAX_LEVEL, level)) - def.level;
  const grow = (key: keyof BattlerStats, min: number) =>
    Math.max(min, Math.round(def[key] * (1 + STAT_GROWTH[key] * n)));
  return {
    maxHp: grow('maxHp', 1),
    maxMp: grow('maxMp', 0),
    atk: grow('atk', 0),
    def: grow('def', 0),
    mag: grow('mag', 0),
    agi: grow('agi', 0),
  };
}

export function createActorState(def: ActorDef, level = def.level): ActorState {
  const stats = actorStatsAt(def, level);
  return { id: def.id, name: def.name, level, exp: expForLevel(level), hp: stats.maxHp, mp: stats.maxMp, ...stats };
}

/** Recalcule les caractéristiques après un changement de niveau (PV/PM bornés). */
export function refreshActorStats(actor: ActorState, def: ActorDef): void {
  Object.assign(actor, actorStatsAt(def, actor.level));
  actor.hp = Math.min(actor.hp, actor.maxHp);
  actor.mp = Math.min(actor.mp, actor.maxMp);
}

/**
 * Ajoute de l'expérience et applique les montées de niveau (les PV/PM courants augmentent du
 * même montant que les maximums). Renvoie la liste des niveaux atteints.
 */
export function gainExp(actor: ActorState, def: ActorDef, amount: number): number[] {
  const reached: number[] = [];
  actor.exp += Math.max(0, Math.round(amount));
  while (actor.level < MAX_LEVEL && actor.exp >= expForLevel(actor.level + 1)) {
    const before = { maxHp: actor.maxHp, maxMp: actor.maxMp };
    actor.level += 1;
    refreshActorStats(actor, def);
    if (actor.hp > 0) {
      actor.hp = Math.min(actor.maxHp, actor.hp + actor.maxHp - before.maxHp);
      actor.mp = Math.min(actor.maxMp, actor.mp + actor.maxMp - before.maxMp);
    }
    reached.push(actor.level);
  }
  return reached;
}

export function isAlive(actor: { hp: number }): boolean {
  return actor.hp > 0;
}

// ---------------------------------------------------------------------------
// Création / clonage / validation
// ---------------------------------------------------------------------------

function defaultFlags(): Record<PlayFlag, boolean> {
  return Object.fromEntries(PLAY_FLAGS.map((f) => [f, true])) as Record<PlayFlag, boolean>;
}

/** Nouvelle partie à partir des réglages système et de la base de données. */
export function createGameState(system: RpgSystem, database: RpgDatabase): GameState {
  const party: ActorState[] = [];
  for (const id of system.party) {
    const def = database.actors.find((a) => a.id === id);
    if (def) party.push(createActorState(def));
  }
  return {
    version: STATE_VERSION,
    switches: {},
    variables: {},
    selfSwitches: {},
    items: {},
    gold: Math.min(MAX_GOLD, system.startGold),
    party,
    map: system.startMap,
    player: { x: system.startX, y: system.startY, direction: system.startDirection },
    erased: [],
    steps: 0,
    encounterCount: 0,
    playTime: 0,
    flags: defaultFlags(),
  };
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

const ActorStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number(),
  exp: z.number(),
  hp: z.number(),
  mp: z.number(),
  maxHp: z.number(),
  maxMp: z.number(),
  atk: z.number(),
  def: z.number(),
  mag: z.number(),
  agi: z.number(),
});

const GameStateSchema = z.object({
  version: z.number().default(STATE_VERSION),
  switches: z.record(z.string(), z.boolean()).default({}),
  variables: z.record(z.string(), z.json()).default({}),
  selfSwitches: z.record(z.string(), z.boolean()).default({}),
  items: z.record(z.string(), z.number()).default({}),
  gold: z.number().default(0),
  party: z.array(ActorStateSchema).default([]),
  map: z.string(),
  player: z.object({ x: z.number(), y: z.number(), direction: DirectionSchema.default('down') }),
  erased: z.array(z.string()).default([]),
  steps: z.number().default(0),
  encounterCount: z.number().default(0),
  playTime: z.number().default(0),
  flags: z
    .object({
      encounters: z.boolean().default(true),
      menu: z.boolean().default(true),
      save: z.boolean().default(true),
      dash: z.boolean().default(true),
    })
    .default(defaultFlags()),
});

/** Valide un état chargé (sauvegarde) ; lève une erreur lisible s'il est invalide. */
export function parseGameState(data: unknown): GameState {
  const result = GameStateSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Sauvegarde RPG invalide (${issue?.path.join('.') || 'racine'}) : ${issue?.message ?? ''}`);
  }
  return result.data as GameState;
}

// ---------------------------------------------------------------------------
// Interrupteurs et variables
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Refuse les noms dangereux pour des objets JSON (`__proto__`…). */
export function assertSafeName(name: string): string {
  if (FORBIDDEN_KEYS.has(name)) throw new Error(`Nom interdit : « ${name} »`);
  return name;
}

export function getSwitch(state: GameState, name: string): boolean {
  return Object.hasOwn(state.switches, name) ? state.switches[name] === true : false;
}

export function setSwitch(state: GameState, name: string, value = true): void {
  state.switches[assertSafeName(name)] = value;
}

/** Convertit une valeur de script en nombre (0 par défaut). */
export function toNumber(value: Value | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Valeur numérique d'une variable (0 si absente). */
export function getVariable(state: GameState, name: string): number {
  return Object.hasOwn(state.variables, name) ? toNumber(state.variables[name]) : 0;
}

export function setVariable(state: GameState, name: string, value: Value): void {
  state.variables[assertSafeName(name)] = value;
}

/**
 * Applique une opération à une variable (division entière, modulo et division par zéro sans effet).
 * `random` tire un entier dans [`value`, `max`].
 */
export function applyVariableOp(
  state: GameState,
  name: string,
  op: VariableOp,
  value: number,
  max: number | undefined,
  random: () => number,
): number {
  const current = getVariable(state, name);
  let next: number;
  switch (op) {
    case 'set':
      next = value;
      break;
    case 'add':
      next = current + value;
      break;
    case 'sub':
      next = current - value;
      break;
    case 'mul':
      next = current * value;
      break;
    case 'div':
      next = value === 0 ? current : Math.trunc(current / value);
      break;
    case 'mod':
      next = value === 0 ? current : current % value;
      break;
    case 'random': {
      const lo = Math.min(value, max ?? value);
      const hi = Math.max(value, max ?? value);
      next = lo + Math.floor(random() * (Math.floor(hi) - Math.ceil(lo) + 1));
      break;
    }
  }
  setVariable(state, name, next);
  return next;
}

export function selfSwitchKey(mapId: string, eventId: string, letter: SelfSwitchLetter): string {
  return `${mapId}:${eventId}:${letter}`;
}

export function getSelfSwitch(state: GameState, mapId: string, eventId: string, letter: SelfSwitchLetter): boolean {
  return state.selfSwitches[selfSwitchKey(mapId, eventId, letter)] === true;
}

export function setSelfSwitch(
  state: GameState,
  mapId: string,
  eventId: string,
  letter: SelfSwitchLetter,
  value = true,
): void {
  const key = selfSwitchKey(mapId, eventId, letter);
  if (value) state.selfSwitches[key] = true;
  else delete state.selfSwitches[key];
}

// ---------------------------------------------------------------------------
// Objets, or, équipe
// ---------------------------------------------------------------------------

export function itemCount(state: GameState, id: string): number {
  return Object.hasOwn(state.items, id) ? (state.items[id] ?? 0) : 0;
}

/** Ajoute (ou retire) des objets, borné à [0, 99]. Renvoie la nouvelle quantité. */
export function addItem(state: GameState, id: string, count = 1): number {
  const next = Math.max(0, Math.min(MAX_ITEMS, itemCount(state, id) + Math.trunc(count)));
  if (next === 0) delete state.items[id];
  else state.items[assertSafeName(id)] = next;
  return next;
}

/** Ajoute (ou retire) de l'or, borné à [0, MAX_GOLD]. Renvoie le nouveau total. */
export function addGold(state: GameState, amount: number): number {
  state.gold = Math.max(0, Math.min(MAX_GOLD, state.gold + Math.trunc(amount)));
  return state.gold;
}

/** Soin complet (PV, PM) et résurrection de toute l'équipe. */
export function healParty(state: GameState): void {
  for (const actor of state.party) {
    actor.hp = actor.maxHp;
    actor.mp = actor.maxMp;
  }
}

/** Remet à 1 PV les membres K.O. (après une défaite autorisée). */
export function reviveFallen(state: GameState): void {
  for (const actor of state.party) if (actor.hp <= 0) actor.hp = 1;
}

export function isPartyDefeated(state: GameState): boolean {
  return state.party.length > 0 && state.party.every((a) => a.hp <= 0);
}

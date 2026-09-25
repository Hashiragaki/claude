import type { Rng } from '@forge/core';
import { applyItemToVitals, isUsableInBattle, targetsEnemy } from './items';
import type { ItemDef, RpgDatabase, SkillDef } from './schema';
import { addGold, addItem, gainExp, itemCount, type BattlerStats, type GameState } from './state';
import { defaultTranslate, type Translate } from './strings';

export type Side = 'party' | 'enemy';

export interface BattlerRef {
  side: Side;
  index: number;
}

/** Combattant : pour l'équipe, `stats` est l'`ActorState` de la partie (modifié en direct). */
export interface Combatant {
  side: Side;
  index: number;
  /** Identifiant de l'acteur ou de l'ennemi dans la base. */
  id: string;
  name: string;
  stats: BattlerStats & { hp: number; mp: number };
  skills: string[];
  guarding: boolean;
}

/** Ordre donné à un membre de l'équipe (`target` = index dans le camp visé). */
export type BattleAction =
  | { kind: 'attack'; target: number }
  | { kind: 'skill'; skill: string; target?: number }
  | { kind: 'item'; item: string; target?: number }
  | { kind: 'guard' };

export type BattleResult = 'win' | 'lose' | 'escape';
export type BattlePhase = 'input' | BattleResult;

/** Journal structuré d'un tour, que la vue anime dans l'ordre. */
export type BattleLogEntry =
  | { type: 'message'; key: string; params: Record<string, string | number>; text: string }
  | { type: 'action'; actor: BattlerRef; action: BattleAction['kind']; skill?: string; item?: string; sfx?: string }
  | { type: 'damage'; target: BattlerRef; value: number; hp: number }
  | { type: 'heal'; target: BattlerRef; value: number; hp: number }
  | { type: 'mp'; target: BattlerRef; value: number; mp: number }
  | { type: 'revive'; target: BattlerRef; hp: number }
  | { type: 'defeated'; target: BattlerRef }
  | { type: 'levelUp'; target: BattlerRef; level: number }
  | { type: 'end'; result: BattleResult };

export interface BattleRewards {
  exp: number;
  gold: number;
  items: { item: string; count: number }[];
  levelUps: { actor: string; name: string; level: number }[];
}

export interface BattleOptions {
  state: GameState;
  database: RpgDatabase;
  troop: string;
  rng: Rng;
  canEscape?: boolean;
  translate?: Translate;
  /** Variation aléatoire des dégâts et soins (0.1 = ±10 %). */
  variance?: number;
}

function pickStats(s: BattlerStats): BattlerStats {
  return { maxHp: s.maxHp, maxMp: s.maxMp, atk: s.atk, def: s.def, mag: s.mag, agi: s.agi };
}

export function isAliveCombatant(c: Combatant): boolean {
  return c.stats.hp > 0;
}

/** Dégâts physiques : `max(1, round((atk × 2 − def) × variation))`, divisés par 2 en garde. */
export function physicalDamage(atk: number, def: number, variance: number, guarding = false): number {
  const dmg = Math.max(1, Math.round((atk * 2 - def) * variance));
  return guarding ? Math.max(1, Math.round(dmg / 2)) : dmg;
}

/** Dégâts magiques : `max(1, round((puissance + mag × 2 − def / 2) × variation))`, divisés par 2 en garde. */
export function magicDamage(power: number, mag: number, def: number, variance: number, guarding = false): number {
  const dmg = Math.max(1, Math.round((power + mag * 2 - def / 2) * variance));
  return guarding ? Math.max(1, Math.round(dmg / 2)) : dmg;
}

/** Soin magique : `max(1, round((puissance + mag × 2) × variation))`. */
export function healAmount(power: number, mag: number, variance: number): number {
  return Math.max(1, Math.round((power + mag * 2) * variance));
}

/**
 * Combat au tour par tour en vue de face (style Dragon Quest / RPG Maker 2000) : l'équipe reçoit
 * ses ordres (`setCommand`), puis `executeTurn()` résout le tour dans l'ordre d'agilité et
 * renvoie le journal à animer. La victoire applique directement les récompenses à l'état.
 */
export class BattleSystem {
  readonly party: Combatant[];
  readonly enemies: Combatant[];
  readonly canEscape: boolean;
  phase: BattlePhase = 'input';
  turn = 1;
  rewards: BattleRewards | null = null;
  private readonly state: GameState;
  private readonly database: RpgDatabase;
  private readonly rng: Rng;
  private readonly t: Translate;
  private readonly varianceRange: number;
  private readonly commands = new Map<number, BattleAction>();
  private escapeAttempts = 0;

  constructor(options: BattleOptions) {
    this.state = options.state;
    this.database = options.database;
    this.rng = options.rng;
    this.t = options.translate ?? defaultTranslate();
    this.varianceRange = options.variance ?? 0.1;
    this.canEscape = options.canEscape ?? true;
    const troop = options.database.troops.find((t) => t.id === options.troop);
    if (!troop) throw new Error(`Groupe d'ennemis introuvable : « ${options.troop} »`);

    this.party = options.state.party.map((actor, index) => ({
      side: 'party',
      index,
      id: actor.id,
      name: actor.name,
      stats: actor,
      skills: [...(options.database.actors.find((a) => a.id === actor.id)?.skills ?? [])],
      guarding: false,
    }));

    const defs = troop.members
      .map((id) => options.database.enemies.find((e) => e.id === id))
      .filter((e) => e !== undefined);
    const totals = new Map<string, number>();
    for (const d of defs) totals.set(d.id, (totals.get(d.id) ?? 0) + 1);
    const seen = new Map<string, number>();
    this.enemies = defs.map((d, index) => {
      const n = seen.get(d.id) ?? 0;
      seen.set(d.id, n + 1);
      const suffix = (totals.get(d.id) ?? 1) > 1 ? ` ${String.fromCharCode(65 + n)}` : '';
      return {
        side: 'enemy',
        index,
        id: d.id,
        name: d.name + suffix,
        stats: { ...pickStats(d), hp: d.maxHp, mp: d.maxMp },
        skills: [...d.skills],
        guarding: false,
      };
    });
  }

  get result(): BattleResult | null {
    return this.phase === 'input' ? null : this.phase;
  }

  combatant(ref: BattlerRef): Combatant | undefined {
    return (ref.side === 'party' ? this.party : this.enemies)[ref.index];
  }

  /** Messages d'ouverture (« Slime apparaît ! »). Termine le combat si un camp est vide. */
  start(): BattleLogEntry[] {
    const log: BattleLogEntry[] = [];
    for (const e of this.enemies) this.say(log, 'battle.appears', { name: e.name });
    this.checkEnd(log);
    return log;
  }

  // -------------------------------------------------------------------------
  // Saisie des ordres
  // -------------------------------------------------------------------------

  /** Prochain membre vivant de l'équipe après `after` (-1 = le premier), ou `null`. */
  nextInputIndex(after = -1): number | null {
    for (let i = after + 1; i < this.party.length; i++) if (isAliveCombatant(this.party[i] as Combatant)) return i;
    return null;
  }

  /** Membre vivant précédent `before`, ou `null`. */
  previousInputIndex(before: number): number | null {
    for (let i = before - 1; i >= 0; i--) if (isAliveCombatant(this.party[i] as Combatant)) return i;
    return null;
  }

  setCommand(partyIndex: number, action: BattleAction): void {
    this.commands.set(partyIndex, action);
  }

  clearCommand(partyIndex: number): void {
    this.commands.delete(partyIndex);
  }

  getCommand(partyIndex: number): BattleAction | undefined {
    return this.commands.get(partyIndex);
  }

  /** Tous les membres vivants ont reçu un ordre. */
  get ready(): boolean {
    return this.party.every((c, i) => !isAliveCombatant(c) || this.commands.has(i));
  }

  skillDef(id: string): SkillDef | undefined {
    return this.database.skills.find((s) => s.id === id);
  }

  itemDef(id: string): ItemDef | undefined {
    return this.database.items.find((i) => i.id === id);
  }

  /** Compétences d'un membre et possibilité de les lancer (PM suffisants). */
  skillsOf(partyIndex: number): { skill: SkillDef; usable: boolean }[] {
    const member = this.party[partyIndex];
    if (!member) return [];
    return member.skills
      .map((id) => this.skillDef(id))
      .filter((s) => s !== undefined)
      .map((skill) => ({ skill, usable: member.stats.mp >= skill.mpCost }));
  }

  /** Objets de l'inventaire utilisables en combat. */
  battleItems(): { item: ItemDef; count: number }[] {
    return this.database.items
      .filter((item) => isUsableInBattle(item) && itemCount(this.state, item.id) > 0)
      .map((item) => ({ item, count: itemCount(this.state, item.id) }));
  }

  // -------------------------------------------------------------------------
  // Résolution
  // -------------------------------------------------------------------------

  /** Résout un tour complet (ordres de l'équipe + IA des ennemis). */
  executeTurn(): BattleLogEntry[] {
    const log: BattleLogEntry[] = [];
    if (this.phase !== 'input') return log;
    const queue: { actor: Combatant; action: BattleAction }[] = [];
    for (const member of this.party) {
      if (!isAliveCombatant(member)) continue;
      const action = this.commands.get(member.index) ?? attackFirstEnemy(this);
      queue.push({ actor: member, action });
    }
    for (const enemy of this.enemies.filter(isAliveCombatant)) {
      queue.push({ actor: enemy, action: this.enemyAction(enemy) });
    }
    this.runQueue(queue, log);
    return log;
  }

  /** Tentative de fuite de l'équipe ; en cas d'échec, les ennemis agissent seuls. */
  escape(): BattleLogEntry[] {
    const log: BattleLogEntry[] = [];
    if (this.phase !== 'input') return log;
    if (!this.canEscape) {
      this.say(log, 'battle.cannotEscape');
      return log;
    }
    const chance = this.escapeChance();
    this.escapeAttempts++;
    if (this.rng.next() < chance) {
      this.phase = 'escape';
      this.say(log, 'battle.escaped');
      log.push({ type: 'end', result: 'escape' });
      return log;
    }
    this.say(log, 'battle.escapeFailed');
    const queue = this.enemies
      .filter(isAliveCombatant)
      .map((enemy) => ({ actor: enemy, action: this.enemyAction(enemy) }));
    this.runQueue(queue, log);
    return log;
  }

  /** Chance de fuite : 50 % × agilité de l'équipe / agilité des ennemis, +10 % par échec. */
  escapeChance(): number {
    const avg = (list: Combatant[]) => {
      const alive = list.filter(isAliveCombatant);
      return alive.reduce((sum, c) => sum + c.stats.agi, 0) / Math.max(1, alive.length);
    };
    const chance = (0.5 * avg(this.party)) / Math.max(1, avg(this.enemies)) + 0.1 * this.escapeAttempts;
    return Math.max(0.05, Math.min(1, chance));
  }

  private runQueue(queue: { actor: Combatant; action: BattleAction }[], log: BattleLogEntry[]): void {
    const ordered = queue
      .map((entry) => ({ ...entry, speed: this.speedOf(entry.actor) }))
      .sort((a, b) => b.speed - a.speed);
    for (const entry of ordered) if (entry.action.kind === 'guard') entry.actor.guarding = true;
    for (const entry of ordered) {
      if (this.checkEnd(log)) break;
      if (isAliveCombatant(entry.actor)) this.perform(entry.actor, entry.action, log);
    }
    this.checkEnd(log);
    for (const c of [...this.party, ...this.enemies]) c.guarding = false;
    this.commands.clear();
    this.turn++;
  }

  /** Vitesse d'action : agilité + petit aléa. */
  private speedOf(c: Combatant): number {
    return c.stats.agi + this.rng.float(0, c.stats.agi * 0.25 + 2);
  }

  private variance(): number {
    return this.rng.float(1 - this.varianceRange, 1 + this.varianceRange);
  }

  private firstAlive(group: Combatant[]): Combatant | undefined {
    return group.find(isAliveCombatant);
  }

  /** Cible choisie si elle est vivante, sinon la première cible vivante du camp. */
  private pickTarget(group: Combatant[], index: number | undefined): Combatant | undefined {
    const chosen = index !== undefined ? group[index] : undefined;
    return chosen && isAliveCombatant(chosen) ? chosen : this.firstAlive(group);
  }

  private say(log: BattleLogEntry[], key: string, params: Record<string, string | number> = {}): void {
    log.push({ type: 'message', key, params, text: this.t(key, params) });
  }

  private ref(c: Combatant): BattlerRef {
    return { side: c.side, index: c.index };
  }

  private enemyAction(enemy: Combatant): BattleAction {
    const randomTarget = () => {
      const alive = this.party.filter(isAliveCombatant);
      return alive.length ? this.rng.pick(alive).index : 0;
    };
    const skills = enemy.skills
      .map((id) => this.skillDef(id))
      .filter((s) => s !== undefined && enemy.stats.mp >= s.mpCost) as SkillDef[];
    if (skills.length > 0 && this.rng.bool(0.4)) {
      const skill = this.rng.pick(skills);
      if (skill.type === 'damage') return { kind: 'skill', skill: skill.id, target: randomTarget() };
      const hurt = this.enemies.find((e) => isAliveCombatant(e) && e.stats.hp < e.stats.maxHp * 0.5);
      if (hurt) return { kind: 'skill', skill: skill.id, target: hurt.index };
    }
    return { kind: 'attack', target: randomTarget() };
  }

  private perform(actor: Combatant, action: BattleAction, log: BattleLogEntry[]): void {
    const foes = actor.side === 'party' ? this.enemies : this.party;
    switch (action.kind) {
      case 'guard':
        log.push({ type: 'action', actor: this.ref(actor), action: 'guard' });
        this.say(log, 'battle.guarding', { name: actor.name });
        return;
      case 'attack': {
        const target = this.pickTarget(foes, action.target);
        if (!target) return;
        log.push({ type: 'action', actor: this.ref(actor), action: 'attack' });
        this.say(log, 'battle.attacks', { name: actor.name });
        this.damage(target, physicalDamage(actor.stats.atk, target.stats.def, this.variance(), target.guarding), log);
        return;
      }
      case 'skill':
        this.performSkill(actor, action.skill, action.target, log);
        return;
      case 'item':
        this.performItem(actor, action.item, action.target, log);
        return;
    }
  }

  private performSkill(actor: Combatant, skillId: string, targetIndex: number | undefined, log: BattleLogEntry[]) {
    const skill = this.skillDef(skillId);
    if (!skill) return;
    if (actor.stats.mp < skill.mpCost) {
      this.say(log, 'battle.notEnoughMp');
      return;
    }
    if (skill.mpCost > 0) {
      actor.stats.mp -= skill.mpCost;
      log.push({ type: 'mp', target: this.ref(actor), value: -skill.mpCost, mp: actor.stats.mp });
    }
    const sfx = skill.sfx ? { sfx: skill.sfx } : {};
    log.push({ type: 'action', actor: this.ref(actor), action: 'skill', skill: skill.id, ...sfx });
    this.say(log, 'battle.useSkill', { name: actor.name, skill: skill.name });
    const allies = actor.side === 'party' ? this.party : this.enemies;
    const foes = actor.side === 'party' ? this.enemies : this.party;
    let targets: (Combatant | undefined)[];
    switch (skill.target) {
      case 'enemy':
        targets = [this.pickTarget(foes, targetIndex)];
        break;
      case 'allEnemies':
        targets = foes.filter(isAliveCombatant);
        break;
      case 'ally':
        targets = [this.pickTarget(allies, targetIndex)];
        break;
      case 'allAllies':
        targets = allies.filter(isAliveCombatant);
        break;
      case 'self':
        targets = [actor];
        break;
    }
    for (const target of targets) {
      if (!target || !isAliveCombatant(target)) continue;
      if (skill.type === 'damage') {
        const value = magicDamage(skill.power, actor.stats.mag, target.stats.def, this.variance(), target.guarding);
        this.damage(target, value, log);
      } else {
        const missing = target.stats.maxHp - target.stats.hp;
        const amount = Math.min(healAmount(skill.power, actor.stats.mag, this.variance()), missing);
        target.stats.hp += amount;
        log.push({ type: 'heal', target: this.ref(target), value: amount, hp: target.stats.hp });
        this.say(log, 'battle.heal', { target: target.name, value: amount });
      }
    }
  }

  private performItem(actor: Combatant, itemId: string, targetIndex: number | undefined, log: BattleLogEntry[]): void {
    const item = this.itemDef(itemId);
    if (!item || itemCount(this.state, item.id) <= 0 || !isUsableInBattle(item)) {
      this.say(log, 'battle.noEffect');
      return;
    }
    log.push({ type: 'action', actor: this.ref(actor), action: 'item', item: item.id });
    this.say(log, 'battle.useItem', { name: actor.name, item: item.name });
    if (targetsEnemy(item)) {
      const foes = actor.side === 'party' ? this.enemies : this.party;
      const target = this.pickTarget(foes, targetIndex);
      if (!target) return;
      if (item.consumable) addItem(this.state, item.id, -1);
      this.damage(target, Math.max(1, Math.round(item.effect.value)), log);
      return;
    }
    const allies = actor.side === 'party' ? this.party : this.enemies;
    const target = allies[targetIndex ?? actor.index];
    const effect = target ? applyItemToVitals(item, target.stats) : null;
    if (!target || !effect) {
      this.say(log, 'battle.noEffect');
      return;
    }
    if (item.consumable) addItem(this.state, item.id, -1);
    const ref = this.ref(target);
    if (effect.kind === 'heal') {
      log.push({ type: 'heal', target: ref, value: effect.value, hp: target.stats.hp });
      this.say(log, 'battle.heal', { target: target.name, value: effect.value });
    } else if (effect.kind === 'mp') {
      log.push({ type: 'mp', target: ref, value: effect.value, mp: target.stats.mp });
      this.say(log, 'battle.mpRecovered', { target: target.name, value: effect.value });
    } else {
      log.push({ type: 'revive', target: ref, hp: target.stats.hp });
      this.say(log, 'battle.revived', { target: target.name });
    }
  }

  private damage(target: Combatant, value: number, log: BattleLogEntry[]): void {
    target.stats.hp = Math.max(0, target.stats.hp - value);
    log.push({ type: 'damage', target: this.ref(target), value, hp: target.stats.hp });
    this.say(log, 'battle.damage', { target: target.name, value });
    if (target.stats.hp <= 0) {
      target.guarding = false;
      log.push({ type: 'defeated', target: this.ref(target) });
      this.say(log, 'battle.defeated', { name: target.name });
    }
  }

  /** Détecte la fin du combat (et applique la victoire). Renvoie vrai si le combat est fini. */
  private checkEnd(log: BattleLogEntry[]): boolean {
    if (this.phase !== 'input') return true;
    if (!this.enemies.some(isAliveCombatant)) {
      this.victory(log);
      return true;
    }
    if (!this.party.some(isAliveCombatant)) {
      this.phase = 'lose';
      this.say(log, 'battle.defeat');
      log.push({ type: 'end', result: 'lose' });
      return true;
    }
    return false;
  }

  private victory(log: BattleLogEntry[]): void {
    this.phase = 'win';
    const defs = this.enemies
      .map((e) => this.database.enemies.find((d) => d.id === e.id))
      .filter((d) => d !== undefined);
    const rewards: BattleRewards = {
      exp: defs.reduce((sum, d) => sum + d.exp, 0),
      gold: defs.reduce((sum, d) => sum + d.gold, 0),
      items: [],
      levelUps: [],
    };
    for (const d of defs) {
      for (const drop of d.drops) {
        if (this.rng.next() >= drop.chance) continue;
        const existing = rewards.items.find((i) => i.item === drop.item);
        if (existing) existing.count++;
        else rewards.items.push({ item: drop.item, count: 1 });
      }
    }
    this.say(log, 'battle.victory');
    if (rewards.exp > 0) this.say(log, 'battle.exp', { value: rewards.exp });
    if (rewards.gold > 0) {
      addGold(this.state, rewards.gold);
      this.say(log, 'battle.gold', { value: rewards.gold });
    }
    for (const member of this.party) {
      if (!isAliveCombatant(member) || rewards.exp <= 0) continue;
      const def = this.database.actors.find((a) => a.id === member.id);
      const actor = this.state.party[member.index];
      if (!def || !actor) continue;
      const levels = gainExp(actor, def, rewards.exp);
      const level = levels[levels.length - 1];
      if (level === undefined) continue;
      rewards.levelUps.push({ actor: member.id, name: member.name, level });
      log.push({ type: 'levelUp', target: this.ref(member), level });
      this.say(log, 'battle.levelUp', { name: member.name, level });
    }
    for (const drop of rewards.items) {
      addItem(this.state, drop.item, drop.count);
      const name = this.itemDef(drop.item)?.name ?? drop.item;
      this.say(log, 'rpg.obtained', { item: name });
    }
    this.rewards = rewards;
    log.push({ type: 'end', result: 'win' });
  }
}

/** Stratégie automatique : chaque membre attaque le premier ennemi vivant. */
export function attackFirstEnemy(battle: BattleSystem): BattleAction {
  return { kind: 'attack', target: battle.enemies.find(isAliveCombatant)?.index ?? 0 };
}

/**
 * Joue un combat automatiquement (tests, mode sans affichage). Au-delà de `maxTurns`, le combat
 * est considéré comme une fuite.
 */
export function autoBattle(
  battle: BattleSystem,
  options: { maxTurns?: number; strategy?: (battle: BattleSystem, partyIndex: number) => BattleAction } = {},
): { result: BattleResult; log: BattleLogEntry[] } {
  const log = [...battle.start()];
  const strategy = options.strategy ?? attackFirstEnemy;
  for (let turn = 0; turn < (options.maxTurns ?? 100) && battle.phase === 'input'; turn++) {
    for (let i = battle.nextInputIndex(); i !== null; i = battle.nextInputIndex(i)) {
      battle.setCommand(i, strategy(battle, i));
    }
    log.push(...battle.executeTurn());
  }
  return { result: battle.result ?? 'escape', log };
}

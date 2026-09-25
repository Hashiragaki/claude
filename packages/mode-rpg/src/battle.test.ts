import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { BattleSystem, autoBattle, healAmount, magicDamage, physicalDamage, type BattleLogEntry } from './battle';
import { RpgDatabaseSchema, RpgSystemSchema, type RpgDatabaseInput } from './schema';
import { createGameState, type GameState } from './state';
import { TEST_DATABASE } from './test-helpers';

const DB_INPUT: RpgDatabaseInput = {
  ...TEST_DATABASE,
  actors: [
    ...(TEST_DATABASE.actors ?? []),
    { id: 'mage', name: 'Mage', charset: 'c', maxHp: 30, maxMp: 30, atk: 5, def: 5, mag: 12, agi: 3, skills: ['soin'] },
  ],
  skills: [
    ...(TEST_DATABASE.skills ?? []),
    { id: 'crachat', name: 'Crachat', mpCost: 2, power: 5, type: 'damage', target: 'enemy' },
  ],
  enemies: [
    ...(TEST_DATABASE.enemies ?? []),
    {
      id: 'gardien',
      name: 'Gardien',
      battler: 'b',
      maxHp: 500,
      maxMp: 99,
      atk: 10,
      def: 10,
      agi: 40,
      exp: 50,
      gold: 30,
      drops: [{ item: 'potion', chance: 1 }],
      skills: ['crachat'],
    },
    { id: 'colosse', name: 'Colosse', battler: 'b', maxHp: 999, atk: 99, def: 99, agi: 1 },
  ],
  troops: [
    ...(TEST_DATABASE.troops ?? []),
    { id: 'gardien', members: ['gardien'] },
    { id: 'colosse', members: ['colosse'] },
  ],
};
const db = RpgDatabaseSchema.parse(DB_INPUT);

interface SetupOptions {
  party?: string[];
  seed?: number;
  canEscape?: boolean;
  variance?: number;
}

function setup(troop: string, options: SetupOptions = {}) {
  const system = RpgSystemSchema.parse({ startMap: 'carte', party: options.party ?? ['hero'] });
  const state: GameState = createGameState(system, db);
  const battle = new BattleSystem({
    state,
    database: db,
    troop,
    rng: new Rng(options.seed ?? 3),
    canEscape: options.canEscape,
    variance: options.variance ?? 0,
  });
  return { state, battle };
}

const messages = (log: BattleLogEntry[]) => log.flatMap((e) => (e.type === 'message' ? [e.text] : []));

describe('formules de combat', () => {
  it('calcule dégâts physiques, magiques et soins', () => {
    expect(physicalDamage(12, 4, 1)).toBe(20);
    expect(physicalDamage(12, 4, 1, true)).toBe(10);
    expect(physicalDamage(1, 50, 1)).toBe(1);
    expect(physicalDamage(10, 0, 1.1)).toBe(22);
    expect(magicDamage(10, 10, 4, 1)).toBe(28);
    expect(magicDamage(10, 10, 4, 1, true)).toBe(14);
    expect(healAmount(10, 10, 1)).toBe(30);
  });
});

describe('BattleSystem', () => {
  it('nomme les ennemis et annonce leur apparition', () => {
    const { battle } = setup('slimes');
    expect(battle.enemies.map((e) => e.name)).toEqual(['Slime A', 'Slime B']);
    expect(messages(battle.start())).toEqual(['Slime A apparaît !', 'Slime B apparaît !']);
    expect(battle.phase).toBe('input');
    expect(battle.nextInputIndex()).toBe(0);
    expect(battle.nextInputIndex(0)).toBeNull();
  });

  it("résout un tour dans l'ordre d'agilité puis la victoire avec récompenses et montée de niveau", () => {
    const { state, battle } = setup('slimes');
    battle.start();
    battle.setCommand(0, { kind: 'attack', target: 0 });
    expect(battle.ready).toBe(true);
    const turn1 = battle.executeTurn();
    expect(turn1[0]).toEqual({ type: 'action', actor: { side: 'party', index: 0 }, action: 'attack' });
    expect(turn1).toContainEqual({ type: 'damage', target: { side: 'enemy', index: 0 }, value: 20, hp: 0 });
    expect(turn1).toContainEqual({ type: 'defeated', target: { side: 'enemy', index: 0 } });
    expect(turn1).toContainEqual({ type: 'damage', target: { side: 'party', index: 0 }, value: 8, hp: 42 });
    expect(state.party[0]!.hp).toBe(42);

    battle.setCommand(0, { kind: 'attack', target: 0 });
    const turn2 = battle.executeTurn();
    expect(turn2).toContainEqual({ type: 'damage', target: { side: 'enemy', index: 1 }, value: 20, hp: 0 });
    expect(battle.phase).toBe('win');
    expect(battle.result).toBe('win');
    const levelUps = [{ actor: 'hero', name: 'Héros', level: 2 }];
    expect(battle.rewards).toEqual({ exp: 20, gold: 14, items: [], levelUps });
    expect(state.gold).toBe(14);
    expect(state.party[0]!.level).toBe(2);
    expect(messages(turn2)).toEqual(
      expect.arrayContaining(['Victoire !', "20 points d'expérience gagnés.", 'Héros passe au niveau 2 !']),
    );
    expect(turn2[turn2.length - 1]).toEqual({ type: 'end', result: 'win' });
    expect(battle.executeTurn()).toEqual([]);
  });

  it('réduit les dégâts en garde et gère les compétences et les PM', () => {
    const { state, battle } = setup('slimes');
    battle.setCommand(0, { kind: 'guard' });
    const log = battle.executeTurn();
    expect(messages(log)).toContain('Héros se met en garde.');
    const hits = log.filter((e) => e.type === 'damage' && e.target.side === 'party');
    expect(hits.every((e) => e.type === 'damage' && e.value === 4)).toBe(true);
    expect(battle.party[0]!.guarding).toBe(false);

    const before = state.party[0]!.hp;
    battle.setCommand(0, { kind: 'skill', skill: 'feu', target: 1 });
    const fire = battle.executeTurn();
    expect(fire).toContainEqual({ type: 'mp', target: { side: 'party', index: 0 }, value: -4, mp: 16 });
    expect(fire).toContainEqual({ type: 'damage', target: { side: 'enemy', index: 1 }, value: 28, hp: 0 });
    expect(messages(fire)).toContain('Héros lance Feu !');

    battle.setCommand(0, { kind: 'skill', skill: 'soin', target: 0 });
    const heal = battle.executeTurn();
    const healed = heal.find((e) => e.type === 'heal');
    expect(healed).toBeDefined();
    expect(state.party[0]!.hp).toBeGreaterThan(before - 20);

    state.party[0]!.mp = 0;
    battle.setCommand(0, { kind: 'skill', skill: 'feu', target: 0 });
    expect(messages(battle.executeTurn())).toContain('Pas assez de PM !');
    expect(battle.skillsOf(0).map((s) => [s.skill.id, s.usable])).toEqual([
      ['feu', false],
      ['soin', false],
    ]);
  });

  it('utilise des objets : soin, dégâts et résurrection', () => {
    const { state, battle } = setup('gardien', { party: ['hero', 'mage'] });
    state.items = { potion: 1, bombe: 1, plume: 1 };
    state.party[0]!.hp = 10;
    state.party[0]!.def = 999;
    state.party[1]!.def = 999;
    state.party[1]!.hp = 0;
    expect(battle.nextInputIndex()).toBe(0);
    expect(battle.nextInputIndex(0)).toBeNull();
    expect(battle.battleItems().map((i) => i.item.id)).toEqual(['potion', 'plume', 'bombe']);

    battle.setCommand(0, { kind: 'item', item: 'plume', target: 1 });
    const revive = battle.executeTurn();
    expect(revive).toContainEqual({ type: 'revive', target: { side: 'party', index: 1 }, hp: 10 });
    expect(state.items.plume).toBeUndefined();

    battle.setCommand(0, { kind: 'item', item: 'potion', target: 0 });
    battle.setCommand(1, { kind: 'item', item: 'bombe', target: 0 });
    const log = battle.executeTurn();
    const heal = { type: 'heal', target: { side: 'party', index: 0 }, value: 30 };
    expect(log).toContainEqual(expect.objectContaining(heal));
    const bomb = { type: 'damage', target: { side: 'enemy', index: 0 }, value: 25 };
    expect(log).toContainEqual(expect.objectContaining(bomb));
    expect(state.items).toEqual({});
  });

  it('gère la fuite (impossible, réussie, ratée)', () => {
    const locked = setup('slimes', { canEscape: false });
    expect(messages(locked.battle.escape())).toEqual(['Impossible de fuir ce combat !']);
    expect(locked.battle.phase).toBe('input');

    const fast = setup('slimes');
    expect(fast.battle.escapeChance()).toBe(1);
    const log = fast.battle.escape();
    expect(fast.battle.phase).toBe('escape');
    expect(log[log.length - 1]).toEqual({ type: 'end', result: 'escape' });

    const slow = setup('gardien', { seed: 11 });
    expect(slow.battle.escapeChance()).toBeCloseTo(0.125);
    const failed = slow.battle.escape();
    expect(slow.battle.phase).toBe('input');
    expect(messages(failed)[0]).toBe('Impossible de fuir !');
    expect(failed.some((e) => e.type === 'action' && e.actor.side === 'enemy')).toBe(true);
    expect(slow.battle.escapeChance()).toBeCloseTo(0.225);
  });

  it("fait agir l'IA ennemie avec ses compétences et donne le butin", () => {
    const { state, battle } = setup('gardien', { seed: 5 });
    state.party[0]!.maxHp = state.party[0]!.hp = 9999;
    const log: BattleLogEntry[] = [];
    for (let i = 0; i < 10; i++) {
      battle.setCommand(0, { kind: 'guard' });
      log.push(...battle.executeTurn());
    }
    expect(log.some((e) => e.type === 'action' && e.actor.side === 'enemy' && e.action === 'skill')).toBe(true);
    expect(log.some((e) => e.type === 'action' && e.actor.side === 'enemy' && e.action === 'attack')).toBe(true);
    state.party[0]!.atk = 999;
    const { result } = autoBattle(battle);
    expect(result).toBe('win');
    expect(state.items.potion).toBe(1);
    expect(messages(battle.executeTurn())).toEqual([]);
  });

  it("se termine par une défaite si l'équipe tombe", () => {
    const { state, battle } = setup('colosse');
    const { result, log } = autoBattle(battle);
    expect(result).toBe('lose');
    expect(state.party[0]!.hp).toBe(0);
    expect(messages(log)).toContain('Défaite…');
  });
});

import { evalExpression, execute, interpolate, ObjectScope } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { applyItemToVitals, inventory, useItemOnActor } from './items';
import { RpgDatabaseSchema, RpgSystemSchema } from './schema';
import { RpgScope } from './scope';
import {
  actorStatsAt,
  addGold,
  addItem,
  applyVariableOp,
  cloneState,
  createGameState,
  expForLevel,
  gainExp,
  getSelfSwitch,
  getSwitch,
  getVariable,
  healParty,
  itemCount,
  parseGameState,
  selfSwitchKey,
  setSelfSwitch,
  setSwitch,
} from './state';
import { TEST_DATABASE } from './test-helpers';

const db = RpgDatabaseSchema.parse(TEST_DATABASE);
const system = RpgSystemSchema.parse({
  startMap: 'carte',
  startX: 3,
  startY: 4,
  party: ['hero', 'inconnu'],
  startGold: 25,
});
const hero = db.actors[0]!;

describe('GameState', () => {
  it('crée une nouvelle partie à partir du système et de la base', () => {
    const state = createGameState(system, db);
    expect(state.map).toBe('carte');
    expect(state.player).toEqual({ x: 3, y: 4, direction: 'down' });
    expect(state.gold).toBe(25);
    expect(state.party.map((a) => a.id)).toEqual(['hero']);
    expect(state.party[0]).toMatchObject({ hp: 50, maxHp: 50, mp: 20, level: 1, exp: 0 });
    expect(state.flags).toEqual({ encounters: true, menu: true, save: true, dash: true });
  });

  it('gère interrupteurs, interrupteurs locaux et variables', () => {
    const state = createGameState(system, db);
    expect(getSwitch(state, 'porte')).toBe(false);
    setSwitch(state, 'porte');
    expect(getSwitch(state, 'porte')).toBe(true);
    setSelfSwitch(state, 'village', 'coffre', 'A');
    expect(state.selfSwitches[selfSwitchKey('village', 'coffre', 'A')]).toBe(true);
    expect(getSelfSwitch(state, 'village', 'coffre', 'A')).toBe(true);
    expect(getSelfSwitch(state, 'autre', 'coffre', 'A')).toBe(false);
    setSelfSwitch(state, 'village', 'coffre', 'A', false);
    expect(state.selfSwitches).toEqual({});
    expect(() => setSwitch(state, '__proto__')).toThrow(/interdit/);
  });

  it('applique les opérations sur les variables', () => {
    const state = createGameState(system, db);
    const rnd = () => 0.999;
    expect(applyVariableOp(state, 'v', 'set', 7, undefined, rnd)).toBe(7);
    expect(applyVariableOp(state, 'v', 'add', 5, undefined, rnd)).toBe(12);
    expect(applyVariableOp(state, 'v', 'sub', 2, undefined, rnd)).toBe(10);
    expect(applyVariableOp(state, 'v', 'mul', 3, undefined, rnd)).toBe(30);
    expect(applyVariableOp(state, 'v', 'div', 4, undefined, rnd)).toBe(7);
    expect(applyVariableOp(state, 'v', 'div', 0, undefined, rnd)).toBe(7);
    expect(applyVariableOp(state, 'v', 'mod', 4, undefined, rnd)).toBe(3);
    expect(applyVariableOp(state, 'r', 'random', 1, 6, rnd)).toBe(6);
    expect(applyVariableOp(state, 'r', 'random', 1, 6, () => 0)).toBe(1);
    expect(getVariable(state, 'absente')).toBe(0);
  });

  it('borne objets et or', () => {
    const state = createGameState(system, db);
    expect(addItem(state, 'potion', 3)).toBe(3);
    expect(addItem(state, 'potion', -1)).toBe(2);
    expect(addItem(state, 'potion', -5)).toBe(0);
    expect(state.items).toEqual({});
    expect(addItem(state, 'potion', 500)).toBe(99);
    expect(addGold(state, -100)).toBe(0);
    expect(addGold(state, 40)).toBe(40);
  });

  it('suit la courbe d\'expérience et fait monter de niveau', () => {
    expect(expForLevel(1)).toBe(0);
    expect(expForLevel(2)).toBe(20);
    expect(expForLevel(3)).toBe(61);
    const state = createGameState(system, db);
    const actor = state.party[0]!;
    actor.hp = 10;
    const reached = gainExp(actor, hero, 70);
    expect(reached).toEqual([2, 3]);
    expect(actor.level).toBe(3);
    const stats = actorStatsAt(hero, 3);
    expect(actor.maxHp).toBe(stats.maxHp);
    expect(stats.maxHp).toBeGreaterThan(hero.maxHp);
    expect(stats.atk).toBeGreaterThan(hero.atk);
    expect(actor.hp).toBe(10 + stats.maxHp - hero.maxHp);
    healParty(state);
    expect(actor.hp).toBe(actor.maxHp);
  });

  it('valide les sauvegardes et se clone en JSON', () => {
    const state = createGameState(system, db);
    state.variables.nom = 'Léa';
    const copy = parseGameState(JSON.parse(JSON.stringify(cloneState(state))));
    expect(copy).toEqual(state);
    expect(() => parseGameState({ map: 3 })).toThrow(/Sauvegarde RPG invalide/);
  });
});

describe('RpgScope', () => {
  it('résout variables, interrupteurs, or et noms inconnus (0)', () => {
    const state = createGameState(system, db);
    state.variables.quete = 2;
    state.switches.porte = true;
    const scope = new RpgScope(state);
    expect(evalExpression('quete * 10 + gold', scope)).toBe(45);
    expect(evalExpression('porte and not ferme', scope)).toBe(true);
    expect(evalExpression('inconnue', scope)).toBe(0);
    execute('quete += 1', scope);
    execute('gold -= 5', scope);
    execute('nouveau = True', scope);
    execute('compteur = 3', scope);
    execute('porte = 0', scope);
    expect(state.variables).toEqual({ quete: 3, compteur: 3 });
    expect(state.switches).toEqual({ porte: false, nouveau: true });
    expect(state.gold).toBe(20);
    expect(interpolate('Or : [gold], quête : [quete]', scope)).toBe('Or : 20, quête : 3');
    expect(() => execute('steps = 3', scope)).toThrow();
    expect(new ObjectScope().has('x')).toBe(false);
  });
});

describe('objets', () => {
  it('soigne, ranime et refuse les utilisations sans effet', () => {
    const state = createGameState(system, db);
    const actor = state.party[0]!;
    addItem(state, 'potion', 2);
    expect(useItemOnActor(state, db, 'potion', 0)).toEqual({ ok: false, reason: 'noEffect' });
    actor.hp = 5;
    expect(useItemOnActor(state, db, 'potion', 0)).toEqual({ ok: true, effect: { kind: 'heal', value: 30 } });
    expect(actor.hp).toBe(35);
    expect(itemCount(state, 'potion')).toBe(1);
    expect(useItemOnActor(state, db, 'cle', 0)).toEqual({ ok: false, reason: 'none' });
    addItem(state, 'cle');
    expect(useItemOnActor(state, db, 'cle', 0)).toEqual({ ok: false, reason: 'notUsable' });
    const plume = db.items.find((i) => i.id === 'plume')!;
    expect(applyItemToVitals(plume, { hp: 3, mp: 0, maxHp: 50, maxMp: 0 })).toBeNull();
    const ko = { hp: 0, mp: 0, maxHp: 50, maxMp: 0 };
    expect(applyItemToVitals(plume, ko)).toEqual({ kind: 'revive', value: 10 });
    expect(inventory(state, db).map((e) => [e.item.id, e.count])).toEqual([
      ['potion', 1],
      ['cle', 1],
    ]);
  });
});

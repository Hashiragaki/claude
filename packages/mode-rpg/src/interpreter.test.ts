import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { EventInterpreter, type InterpreterEffect } from './interpreter';
import { RpgDatabaseSchema, RpgSystemSchema, type Command } from './schema';
import { createGameState, getSelfSwitch, type GameState } from './state';
import { TEST_DATABASE } from './test-helpers';

function setup(): { state: GameState; effects: InterpreterEffect[]; run: (c: Command[], eventId?: string) => EventInterpreter } {
  const db = RpgDatabaseSchema.parse(TEST_DATABASE);
  const state = createGameState(RpgSystemSchema.parse({ startMap: 'carte', party: ['hero'], startGold: 30 }), db);
  const effects: InterpreterEffect[] = [];
  const rng = new Rng(7);
  const run = (commands: Command[], eventId = 'pnj') => {
    const interp = new EventInterpreter(commands, { state, rng, onEffect: (e) => effects.push(e) }, { eventId });
    interp.run();
    return interp;
  };
  return { state, effects, run };
}

describe('EventInterpreter', () => {
  it('affiche des messages interpolés et attend la reprise', () => {
    const { state, run } = setup();
    state.variables.quete = 2;
    state.switches.porte = true;
    const interp = run([
      { type: 'text', speaker: 'Mila', text: 'Or : [gold], quête [quete], porte [porte]' },
      { type: 'setSwitch', name: 'vu' },
    ]);
    expect(interp.waiting).toEqual({ kind: 'message', speaker: 'Mila', text: 'Or : 30, quête 2, porte True' });
    expect(state.switches.vu).toBeUndefined();
    expect(interp.resume()).toBeNull();
    expect(interp.finished).toBe(true);
    expect(state.switches.vu).toBe(true);
  });

  it('exécute la branche choisie ou celle d\'annulation', () => {
    const { state, run } = setup();
    const commands: Command[] = [
      {
        type: 'choice',
        options: [
          { label: 'Oui ([gold])', commands: [{ type: 'setVariable', name: 'r', value: 1 }] },
          { label: 'Non', commands: [{ type: 'setVariable', name: 'r', value: 2 }] },
        ],
        cancel: 1,
      },
      { type: 'setVariable', name: 'apres', value: 1 },
    ];
    const a = run(commands);
    expect(a.waiting).toEqual({ kind: 'choice', options: ['Oui (30)', 'Non'], cancelIndex: 1 });
    a.resume(0);
    expect(state.variables).toEqual({ r: 1, apres: 1 });
    run(commands).resume(-1);
    expect(state.variables.r).toBe(2);
  });

  it('évalue les conditions et les blocs imbriqués', () => {
    const { state, run } = setup();
    state.items.potion = 2;
    const interp = run([
      {
        type: 'if',
        condition: { item: 'potion', count: 2 },
        then: [
          {
            type: 'if',
            condition: { gold: 100 },
            then: [{ type: 'setVariable', name: 'riche', value: 1 }],
            else: [
              {
                type: 'choice',
                options: [
                  { label: 'A', commands: [{ type: 'if', condition: { script: 'gold >= 30' }, then: [{ type: 'text', text: 'imbriqué' }] }] },
                  { label: 'B', commands: [] },
                ],
              },
            ],
          },
        ],
        else: [{ type: 'setVariable', name: 'rate', value: 1 }],
      },
      { type: 'if', condition: { switch: 'absent' }, then: [], else: [{ type: 'setVariable', name: 'off', value: 1 }] },
      { type: 'if', condition: { variable: { name: 'off', op: '==', value: 1 } }, then: [{ type: 'setVariable', name: 'fin', value: 1 }] },
    ]);
    expect(interp.waiting?.kind).toBe('choice');
    expect(interp.resume(0)).toEqual({ kind: 'message', text: 'imbriqué' });
    interp.resume();
    expect(interp.finished).toBe(true);
    expect(state.variables).toEqual({ off: 1, fin: 1 });
  });

  it('modifie objets, or, interrupteurs locaux et efface l\'événement', () => {
    const { state, effects, run } = setup();
    const interp = run([
      { type: 'giveItem', item: 'potion', count: 3 },
      { type: 'giveItem', item: 'potion', count: -1 },
      { type: 'giveGold', amount: -50 },
      { type: 'setSelfSwitch', letter: 'A' },
      { type: 'setSelfSwitch', letter: 'B', event: 'autre' },
      { type: 'if', condition: { selfSwitch: 'A' }, then: [{ type: 'erase' }] },
      { type: 'playSfx', ref: 'son piece' },
      { type: 'setFlag', flag: 'encounters', value: false },
      { type: 'healParty' },
      { type: 'comment', text: 'rien' },
    ]);
    expect(interp.finished).toBe(true);
    expect(state.items.potion).toBe(2);
    expect(state.gold).toBe(0);
    expect(getSelfSwitch(state, 'carte', 'pnj', 'A')).toBe(true);
    expect(state.selfSwitches['carte:autre:B']).toBe(true);
    expect(state.erased).toEqual(['pnj']);
    expect(state.flags.encounters).toBe(false);
    expect(effects).toContainEqual({ type: 'sfx', ref: 'son piece' });
    expect(effects.filter((e) => e.type === 'changed').length).toBeGreaterThan(3);
  });

  it('attend les téléportations, trajets et délais', () => {
    const { state, run } = setup();
    const interp = run([
      { type: 'teleport', map: 'maison', x: 2, y: 3, direction: 'up' },
      { type: 'moveRoute', target: 'this', steps: ['left', 'turnUp'] },
      { type: 'wait', seconds: 0.5 },
      { type: 'setSwitch', name: 'fini' },
    ]);
    expect(interp.waiting).toEqual({ kind: 'teleport', map: 'maison', x: 2, y: 3, direction: 'up' });
    expect(interp.resume()).toEqual({ kind: 'moveRoute', target: 'this', steps: ['left', 'turnUp'], wait: true });
    expect(interp.resume()).toEqual({ kind: 'wait', seconds: 0.5 });
    interp.update(0.3);
    expect(state.switches.fini).toBeUndefined();
    interp.update(0.3);
    expect(state.switches.fini).toBe(true);
    expect(interp.finished).toBe(true);
  });

  it('suit l\'issue des combats et déclenche le game over', () => {
    const { state, run } = setup();
    const battle: Command = {
      type: 'battle',
      troop: 'slimes',
      canLose: true,
      onWin: [{ type: 'setSwitch', name: 'gagne' }],
      onLose: [{ type: 'setSwitch', name: 'perdu' }],
      onEscape: [{ type: 'setSwitch', name: 'fui' }],
    };
    const a = run([battle]);
    expect(a.waiting).toEqual({ kind: 'battle', troop: 'slimes', canEscape: true, canLose: true });
    a.resume('win');
    run([battle]).resume('lose');
    run([battle]).resume('escape');
    expect(state.switches).toEqual({ gagne: true, perdu: true, fui: true });
    const b = run([{ type: 'battle', troop: 'slimes' }, { type: 'setSwitch', name: 'jamais' }]);
    expect(b.resume('lose')).toEqual({ kind: 'gameOver' });
    expect(b.resume()).toBeNull();
    expect(b.finished).toBe(true);
    expect(state.switches.jamais).toBeUndefined();
  });

  it('exécute des scripts et signale les erreurs sans s\'arrêter', () => {
    const { state, effects, run } = setup();
    const interp = run([
      { type: 'script', code: 'score = gold * 2' },
      { type: 'script', code: 'score +=' },
      { type: 'setVariable', name: 'de', op: 'random', value: 1, max: 6 },
      { type: 'erase' },
    ]);
    expect(interp.finished).toBe(true);
    expect(state.variables.score).toBe(60);
    const de = state.variables.de as number;
    expect(de).toBeGreaterThanOrEqual(1);
    expect(de).toBeLessThanOrEqual(6);
    expect(effects.some((e) => e.type === 'error' && e.message.includes('script'))).toBe(true);
    const noEvent = new EventInterpreter([{ type: 'erase' }], { state, rng: new Rng(1), onEffect: (e) => effects.push(e) });
    noEvent.run();
    expect(effects.some((e) => e.type === 'error' && e.message.includes('erase'))).toBe(true);
  });
});

import type { Command, RpgMap } from '@forge/mode-rpg';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_TEMPLATES,
  childLists,
  describeCommand,
  editList,
  emptyMap,
  fillRect,
  floodFill,
  getList,
  layerArray,
  resizeMap,
  setLayer,
} from './mapOps';

describe('opérations de carte', () => {
  it('crée une carte vide et normalise les couches', () => {
    const map = emptyMap('m1', 'Test', 4, 3, 'tiles', 0);
    expect(map.layers.ground).toHaveLength(12);
    const sparse: RpgMap = { ...map, layers: { ...map.layers, decor: [] } };
    expect(layerArray(sparse, 'decor')).toEqual(Array(12).fill(-1));
    expect(layerArray(sparse, 'collision')).toEqual(Array(12).fill(0));
    expect(setLayer(sparse, 'collision', Array(12).fill(1)).collision).toHaveLength(12);
  });

  it('remplit par diffusion et par rectangle', () => {
    const values = [0, 0, 1, 0, 1, 1, 0, 0, 0];
    expect(floodFill(values, 3, 3, 0, 0, 5)).toEqual([5, 5, 1, 5, 1, 1, 5, 5, 5]);
    expect(fillRect(Array(9).fill(-1), 3, 2, 2, 1, 1, 7)).toEqual([-1, -1, -1, -1, 7, 7, -1, 7, 7]);
  });

  it('redimensionne en conservant le contenu et les événements visibles', () => {
    const map = emptyMap('m1', 'Test', 3, 2, 'tiles', 0);
    map.layers.ground = [1, 2, 3, 4, 5, 6];
    map.events = [
      { id: 'a', name: '', x: 2, y: 1, pages: [] as never },
      { id: 'b', name: '', x: 0, y: 0, pages: [] as never },
    ];
    const resized = resizeMap(map, 2, 3, 9);
    expect(resized.layers.ground).toEqual([1, 2, 4, 5, 9, 9]);
    expect(resized.events.map((e) => e.id)).toEqual(['b']);
  });
});

describe('listes de commandes', () => {
  const commands: Command[] = [
    { type: 'text', text: 'Bonjour' },
    { type: 'choice', options: [{ label: 'Oui', commands: [{ type: 'giveGold', amount: 5 }] }, { label: 'Non', commands: [] }] },
    { type: 'if', condition: { switch: 'porte' }, then: [] },
  ];

  it('lit et modifie des sous-listes sans muter l\'original', () => {
    expect(getList(commands, [1, 'options', 0, 'commands'])).toEqual([{ type: 'giveGold', amount: 5 }]);
    const next = editList(commands, [2, 'else'], (list) => list.push({ type: 'healParty' }));
    expect((next[2] as Extract<Command, { type: 'if' }>).else).toEqual([{ type: 'healParty' }]);
    expect((commands[2] as Extract<Command, { type: 'if' }>).else).toBeUndefined();
  });

  it('décrit les commandes et expose les sous-listes', () => {
    expect(describeCommand(commands[0] as Command)).toBe('Texte : « Bonjour »');
    expect(describeCommand({ type: 'setVariable', name: 'quete', op: 'add', value: 2 })).toBe('Variable quete += 2');
    expect(childLists(commands[1] as Command).map((c) => c.label)).toEqual(['Si « Oui »', 'Si « Non »']);
    for (const template of Object.values(COMMAND_TEMPLATES)) expect(describeCommand(template.command)).toBeTruthy();
  });
});

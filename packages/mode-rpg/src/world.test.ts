import { TILE } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { parseGameState, setSelfSwitch } from './state';
import { DT, frames, grassMap, interact, makeWorld, stepPlayer, walkTo } from './test-helpers';

const HOLD_RIGHT = { direction: 'right', action: false, dash: false } as const;

describe('RpgWorld — collisions et déplacements', () => {
  it('calcule la passabilité selon les rôles, la couche haute et les surcharges', () => {
    const map = grassMap('test', 8, 6)
      .set('decor', 3, 2, TILE.rock)
      .set('ground', 5, 1, TILE.water)
      .tree(2, 4)
      .set('ground', 5, 3, TILE.water)
      .bridge(5, 3, 1, 1)
      .collision(6, 4, 1)
      .build();
    const world = makeWorld([map]);
    expect(world.isTilePassable(1, 1)).toBe(true);
    expect(world.isTilePassable(3, 2)).toBe(false);
    expect(world.isTilePassable(5, 1)).toBe(false);
    expect(world.isTilePassable(2, 4)).toBe(false);
    expect(world.isTilePassable(2, 3)).toBe(true);
    expect(world.isTilePassable(5, 3)).toBe(true);
    expect(world.isTilePassable(6, 4)).toBe(false);
    expect(world.isTilePassable(-1, 0)).toBe(false);
    expect(world.isTilePassable(8, 0)).toBe(false);
  });

  it('déplace le joueur case par case avec interpolation, en continu et en courant', () => {
    const world = makeWorld([grassMap().build()]);
    world.update(DT, HOLD_RIGHT);
    expect(world.player.x).toBe(2);
    expect(world.player.realX).toBeCloseTo(1 + 4 * DT);
    expect(world.player.moving).toBe(true);
    frames(world, 13);
    expect(world.player.moving).toBe(true);
    frames(world, 1);
    expect(world.player.moving).toBe(false);
    expect(world.player.realX).toBe(2);
    expect(world.state.player).toEqual({ x: 2, y: 1, direction: 'right' });
    expect(world.state.steps).toBe(1);

    frames(world, 30, HOLD_RIGHT);
    expect(world.player.realX).toBeCloseTo(4);
    expect(world.player.x).toBe(5);
    expect(world.player.frameColumn).not.toBe(undefined);
    frames(world, 15);

    world.update(DT, { direction: 'down', action: false, dash: true });
    frames(world, 7, { direction: null, action: false, dash: true });
    expect(world.player.moving).toBe(false);
    expect(world.player.y).toBe(2);
  });

  it('bloque sur les bords, les tuiles et les événements de priorité « same »', () => {
    const map = grassMap('test', 6, 5)
      .set('decor', 2, 1, TILE.rock)
      .event({ id: 'pnj', x: 1, y: 2, pages: [{ graphic: { charset: 'c' } }] })
      .event({ id: 'dessous', x: 0, y: 1, pages: [{ priority: 'below' }] })
      .event({ id: 'cache', x: 1, y: 0, pages: [{ conditions: { switch: 'jamais' } }] })
      .build();
    const world = makeWorld([map]);
    stepPlayer(world, 'right');
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([1, 1, 'right']);
    stepPlayer(world, 'down');
    expect([world.player.x, world.player.y]).toEqual([1, 1]);
    stepPlayer(world, 'up');
    expect([world.player.x, world.player.y]).toEqual([1, 0]);
    stepPlayer(world, 'up');
    expect([world.player.x, world.player.y]).toEqual([1, 0]);
    stepPlayer(world, 'down');
    stepPlayer(world, 'left');
    expect([world.player.x, world.player.y]).toEqual([0, 1]);
  });

  it('trouve un chemin en contournant les obstacles', () => {
    const map = grassMap('test', 6, 5).line('decor', 3, 0, 3, 3, TILE.rock).build();
    const world = makeWorld([map]);
    const path = world.findPath(5, 0);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3 + 4 + 4);
    walkTo(world, 5, 0);
    expect([world.player.x, world.player.y]).toEqual([5, 0]);
    expect(world.findPath(3, 1)).toBeNull();
  });
});

describe('RpgWorld — pages et déclencheurs', () => {
  it('active la dernière page dont les conditions sont vraies', () => {
    const map = grassMap()
      .event({
        id: 'e',
        x: 3,
        y: 3,
        pages: [
          { commands: [] },
          { conditions: { switch: 's' }, graphic: { tile: 1 } },
          { conditions: { variable: { name: 'v', op: '>=', value: 3 } } },
          { conditions: { selfSwitch: 'A', item: 'potion' } },
        ],
      })
      .event({ id: 'jamais', x: 4, y: 4, pages: [{ conditions: { switch: 'x' } }] })
      .build();
    const world = makeWorld([map]);
    const e = world.event('e')!;
    expect(e.pageIndex).toBe(0);
    expect(e.visible).toBe(false);
    world.state.switches.s = true;
    world.refresh();
    expect(e.pageIndex).toBe(1);
    expect(e.visible).toBe(true);
    world.state.variables.v = 3;
    world.refresh();
    expect(e.pageIndex).toBe(2);
    setSelfSwitch(world.state, 'test', 'e', 'A');
    world.refresh();
    expect(e.pageIndex).toBe(2);
    world.state.items.potion = 1;
    world.refresh();
    expect(e.pageIndex).toBe(3);
    const hidden = world.event('jamais')!;
    expect(hidden.active).toBe(false);
    expect(world.isPassable(4, 4)).toBe(true);
  });

  it('déclenche par action, par contact et en marchant sur une porte', () => {
    const inside = grassMap('maison', 5, 5).build();
    const map = grassMap('test', 8, 6)
      .event({
        id: 'pnj',
        x: 3,
        y: 1,
        pages: [{ graphic: { charset: 'c', direction: 'down' }, commands: [{ type: 'text', text: 'Bonjour' }] }],
      })
      .event({ id: 'piege', x: 1, y: 3, pages: [{ trigger: 'touch', commands: [{ type: 'setSwitch', name: 'touche' }] }] })
      .event({ id: 'sol', x: 1, y: 1, pages: [{ priority: 'below', commands: [{ type: 'setSwitch', name: 'sol' }] }] })
      .door('porte', 5, 1, { map: 'maison', x: 2, y: 2, direction: 'up' })
      .build();
    const world = makeWorld([map, inside]);

    world.update(DT, { direction: null, action: true, dash: false });
    expect(world.state.switches.sol).toBe(true);

    stepPlayer(world, 'right');
    interact(world, 3, 1);
    expect(world.request).toEqual({ kind: 'message', text: 'Bonjour' });
    expect(world.event('pnj')!.direction).toBe('left');
    expect(world.busy).toBe(true);
    stepPlayer(world, 'down');
    expect([world.player.x, world.player.y]).toEqual([2, 1]);
    world.resume();
    frames(world, 1);
    expect(world.busy).toBe(false);
    expect(world.event('pnj')!.direction).toBe('down');

    stepPlayer(world, 'left');
    stepPlayer(world, 'down');
    expect(world.state.switches.touche).toBeUndefined();
    stepPlayer(world, 'down');
    expect(world.state.switches.touche).toBe(true);
    expect([world.player.x, world.player.y]).toEqual([1, 2]);

    walkTo(world, 5, 1);
    expect(world.request).toEqual({ kind: 'teleport', map: 'maison', x: 2, y: 2, direction: 'up' });
    world.resume();
    expect(world.map.id).toBe('maison');
    expect(world.state.player).toEqual({ x: 2, y: 2, direction: 'up' });
    expect(world.busy).toBe(false);
  });

  it('exécute les événements automatiques (bloquants) et parallèles', () => {
    const map = grassMap()
      .event({
        id: 'auto',
        x: 0,
        y: 0,
        pages: [
          {
            trigger: 'autorun',
            priority: 'below',
            commands: [{ type: 'text', text: 'Intro' }, { type: 'setSelfSwitch', letter: 'A' }],
          },
          { conditions: { selfSwitch: 'A' }, trigger: 'action', priority: 'below' },
        ],
      })
      .event({
        id: 'para',
        x: 7,
        y: 7,
        pages: [
          {
            trigger: 'parallel',
            priority: 'below',
            commands: [{ type: 'setVariable', name: 'tic', op: 'add', value: 1 }, { type: 'wait', seconds: 0.1 }],
          },
        ],
      })
      .build();
    const world = makeWorld([map]);
    world.update(DT, HOLD_RIGHT);
    expect(world.request).toEqual({ kind: 'message', text: 'Intro' });
    expect(world.player.x).toBe(1);
    frames(world, 30, HOLD_RIGHT);
    expect(world.player.x).toBe(1);
    expect(world.state.variables.tic).toBeGreaterThanOrEqual(4);
    world.resume();
    world.update(DT, HOLD_RIGHT);
    expect(world.player.x).toBe(2);
    expect(world.event('auto')!.pageIndex).toBe(1);
  });

  it('fait bouger les PNJ au hasard ou vers le joueur (contact)', () => {
    const map = grassMap('test', 10, 8)
      .event({ id: 'errant', x: 7, y: 6, pages: [{ graphic: { charset: 'c' }, movement: 'random' }] })
      .event({
        id: 'chasseur',
        x: 5,
        y: 4,
        pages: [
          {
            graphic: { charset: 'c' },
            movement: 'approach',
            speed: 4,
            trigger: 'touch',
            commands: [{ type: 'text', text: 'Attrapé !' }],
          },
        ],
      })
      .build();
    const world = makeWorld([map]);
    const errant = world.event('errant')!;
    const visited = new Set<string>();
    for (let i = 0; i < 900 && !world.request; i++) {
      world.update(DT);
      visited.add(`${errant.x},${errant.y}`);
      expect(world.isTilePassable(errant.x, errant.y)).toBe(true);
    }
    expect(visited.size).toBeGreaterThan(1);
    expect(world.request).toEqual({ kind: 'message', text: 'Attrapé !' });
    const c = world.event('chasseur')!;
    expect(Math.abs(c.x - 1) + Math.abs(c.y - 1)).toBe(1);
  });

  it('exécute des trajets et attend leur fin', () => {
    const map = grassMap()
      .event({
        id: 'guide',
        x: 4,
        y: 1,
        pages: [
          {
            graphic: { charset: 'c' },
            commands: [
              { type: 'moveRoute', target: 'player', steps: ['down', 'down', 'turnRight'] },
              { type: 'moveRoute', target: 'this', steps: ['right'], wait: false },
              { type: 'setSwitch', name: 'fini' },
            ],
          },
        ],
      })
      .build();
    const world = makeWorld([map]);
    stepPlayer(world, 'right');
    stepPlayer(world, 'right');
    interact(world, 4, 1);
    expect(world.busy).toBe(true);
    expect(world.state.switches.fini).toBeUndefined();
    frames(world, 90);
    expect(world.state.player).toEqual({ x: 3, y: 3, direction: 'right' });
    expect(world.state.switches.fini).toBe(true);
    expect(world.event('guide')!.x).toBe(5);
    expect(world.busy).toBe(false);
  });
});

describe('RpgWorld — rencontres, téléportations et sauvegarde', () => {
  it('déclenche des rencontres seulement sur le rôle demandé', () => {
    const map = grassMap('test', 14, 3)
      .tallGrass(6, 0, 8, 3)
      .encounters({ troops: ['slimes'], rate: 2, onlyOnRole: 'ground_detail' })
      .build();
    const world = makeWorld([map], { system: { startX: 0, startY: 1 } });
    for (let i = 0; i < 5; i++) {
      stepPlayer(world, 'right');
      expect(world.request).toBeNull();
    }
    let found = null;
    for (let i = 0; i < 6 && !found; i++) {
      stepPlayer(world, 'right');
      found = world.request;
    }
    expect(found).toEqual({ kind: 'battle', troop: 'slimes', canEscape: true, canLose: false });
    world.resume('win');
    expect(world.busy).toBe(false);

    world.state.flags.encounters = false;
    for (let i = 0; i < 8; i++) stepPlayer(world, i % 2 ? 'left' : 'right');
    expect(world.request).toBeNull();
  });

  it('téléporte et réinitialise les événements effacés', () => {
    const a = grassMap('a')
      .event({
        id: 'fantome',
        x: 3,
        y: 1,
        pages: [{ graphic: { charset: 'c' }, commands: [{ type: 'erase' }, { type: 'teleport', map: 'b', x: 2, y: 2 }] }],
      })
      .build();
    const b = grassMap('b').door('retour', 2, 3, { map: 'a', x: 1, y: 1 }).build();
    const world = makeWorld([a, b]);
    const loaded: string[] = [];
    world.events.on('map-loaded', (e) => loaded.push(e.mapId));
    stepPlayer(world, 'right');
    interact(world, 3, 1);
    expect(world.state.erased).toEqual(['fantome']);
    expect(world.request).toMatchObject({ kind: 'teleport', map: 'b' });
    world.resume();
    expect(loaded).toEqual(['b']);
    expect(world.state.erased).toEqual([]);
    stepPlayer(world, 'down');
    world.resume();
    expect(world.map.id).toBe('a');
    expect(world.event('fantome')!.active).toBe(true);
    expect(world.teleport('inconnue', 0, 0)).toBe(false);
  });

  it('recharge un état sauvegardé', () => {
    const world = makeWorld([grassMap().build()]);
    stepPlayer(world, 'down');
    world.state.switches.ok = true;
    const saved = JSON.parse(JSON.stringify(world.snapshot()));
    stepPlayer(world, 'down');
    world.loadState(parseGameState(saved));
    expect([world.player.x, world.player.y]).toEqual([1, 2]);
    expect(world.state.switches.ok).toBe(true);
  });
});

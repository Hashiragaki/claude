import { EMPTY_TILE, TILE, TILE_ROLES } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { MapBuilder } from './mapBuilder';
import { isCellPassable, roleTable } from './passability';
import { COLLISION_PASS, RpgMapSchema } from './schema';

const roles = roleTable({ tileSize: 16, columns: 8, theme: 't', tiles: [...TILE_ROLES] });

describe('MapBuilder', () => {
  it('remplit, trace des rectangles, lignes et bordures', () => {
    const b = new MapBuilder('m', { width: 6, height: 4, tileset: 't' });
    b.border('decor', TILE.bush).rect('ground', 1, 1, 2, 2, TILE.path).line('decor', 1, 1, 4, 1, TILE.fence);
    expect(b.get('decor', 0, 0)).toBe(TILE.bush);
    expect(b.get('decor', 5, 3)).toBe(TILE.bush);
    expect(b.get('decor', 2, 2)).toBe(EMPTY_TILE);
    expect(b.get('ground', 2, 2)).toBe(TILE.path);
    expect(b.get('ground', 3, 2)).toBe(TILE.ground);
    expect([1, 2, 3, 4].map((x) => b.get('decor', x, 1))).toEqual(Array(4).fill(TILE.fence));
    b.set('decor', 99, 99, TILE.rock);
    const map = b.build();
    expect(map.layers.ground).toHaveLength(24);
    expect(map.layers.overhead.every((t) => t === EMPTY_TILE)).toBe(true);
    expect(RpgMapSchema.safeParse(JSON.parse(JSON.stringify(map))).success).toBe(true);
  });

  it('construit maisons, arbres, étangs, ponts et chemins', () => {
    const b = new MapBuilder('m', { width: 12, height: 10, tileset: 't' })
      .house(1, 1, 5, 4)
      .tree(8, 3)
      .pond(6, 5, 5, 4)
      .bridge(6, 7, 5, 1)
      .path([[0, 9], [5, 9]])
      .fence(0, 0, 3, 0)
      .tallGrass(0, 6, 2, 2);
    const door = MapBuilder.houseDoor(1, 1, 5, 4);
    expect(door).toEqual({ x: 3, y: 4 });
    const map = b.build();
    expect(b.get('decor', 1, 1)).toBe(TILE.roof);
    expect(b.get('decor', 1, 2)).toBe(TILE.roof_edge);
    expect(b.get('decor', 2, 3)).toBe(TILE.wall_window);
    expect(b.get('decor', 3, 4)).toBe(TILE.door);
    expect(isCellPassable(map, roles, 3, 4)).toBe(true);
    expect(isCellPassable(map, roles, 2, 4)).toBe(false);
    expect(b.get('decor', 8, 3)).toBe(TILE.tree_trunk);
    expect(b.get('overhead', 8, 2)).toBe(TILE.tree_top);
    expect(isCellPassable(map, roles, 8, 2)).toBe(true);
    expect(b.get('ground', 6, 5)).toBe(TILE.water);
    expect(b.get('ground', 7, 6)).toBe(TILE.deep_water);
    expect(isCellPassable(map, roles, 7, 6)).toBe(false);
    expect(map.collision?.[7 * 12 + 7]).toBe(COLLISION_PASS);
    expect(isCellPassable(map, roles, 7, 7)).toBe(true);
    expect([0, 1, 2, 3, 4, 5].every((x) => [TILE.path, TILE.path_alt].includes(b.get('ground', x, 9)))).toBe(true);
    expect(b.get('ground', 1, 7)).toBe(TILE.ground_detail);
  });

  it('parsème de façon reproductible', () => {
    const make = (seed: number) =>
      new MapBuilder('m', { width: 10, height: 10, tileset: 't' }).scatter('decor', TILE.flowers, 12, seed).build();
    const a = make(4);
    expect(a.layers.decor.filter((t) => t === TILE.flowers)).toHaveLength(12);
    expect(make(4).layers.decor).toEqual(a.layers.decor);
    expect(make(5).layers.decor).not.toEqual(a.layers.decor);
  });

  it('ajoute des événements validés (PNJ, panneau, porte, coffre)', () => {
    const b = new MapBuilder('m', { width: 8, height: 8, tileset: 't', music: 'musique' })
      .npc('pnj', 'Paul', 2, 2, 'chara paul', [{ type: 'text', text: 'Salut' }], { movement: 'random' })
      .sign('panneau', 3, 3, 'Village')
      .door('porte', 4, 4, { map: 'maison', x: 1, y: 1, direction: 'up' }, { sfx: 'son porte' })
      .chest('coffre', 5, 5, [{ type: 'giveItem', item: 'potion' }])
      .encounters({ troops: ['slimes'] });
    expect(() => b.event({ id: 'pnj', x: 0, y: 0, pages: [{}] })).toThrow(/double/);
    expect(() => b.event({ id: 'vide', x: 0, y: 0, pages: [] })).toThrow();
    const map = b.build();
    expect(map.music).toBe('musique');
    expect(map.encounters).toEqual({ troops: ['slimes'], rate: 20 });
    const [npc, sign, door, chest] = map.events;
    expect(npc?.pages[0]).toMatchObject({ trigger: 'action', priority: 'same', movement: 'random' });
    expect(b.get('decor', 3, 3)).toBe(TILE.sign);
    expect(sign?.pages[0]?.graphic).toBeNull();
    expect(door?.pages[0]).toMatchObject({ trigger: 'touch', priority: 'below' });
    expect(door?.pages[0]?.commands).toEqual([
      { type: 'playSfx', ref: 'son porte' },
      { type: 'teleport', map: 'maison', x: 1, y: 1, direction: 'up' },
    ]);
    expect(chest?.pages).toHaveLength(2);
    expect(chest?.pages[0]?.commands.at(-1)).toEqual({ type: 'setSelfSwitch', letter: 'A' });
    expect(chest?.pages[1]?.conditions).toEqual({ selfSwitch: 'A' });

    const copy = MapBuilder.from(map).set('decor', 0, 0, TILE.rock).build();
    expect(copy.events).toHaveLength(4);
    expect(copy.layers.decor[0]).toBe(TILE.rock);
    expect(map.layers.decor[0]).toBe(EMPTY_TILE);
  });
});

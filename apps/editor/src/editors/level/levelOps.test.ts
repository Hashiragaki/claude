import { describe, expect, it } from 'vitest';
import {
  addEntity,
  defaultEntity,
  deleteEntity,
  emptyLevel,
  eraseCell,
  fillRectLayer,
  floodFillLayer,
  layerArray,
  moveEntity,
  nextEntityId,
  paintCell,
  resizeLevel,
  setLayer,
  setPlayerStart,
  updateEntity,
} from './levelOps';

describe('niveau vide et couches', () => {
  it('crée un niveau vide et normalise les couches', () => {
    const level = emptyLevel('l1', 'Test', 4, 3, 'tiles');
    expect(level.layers.terrain).toHaveLength(12);
    expect(level.layers.decor).toHaveLength(12);
    expect(level.entities).toEqual([]);
    const sparse = { ...level, layers: { ...level.layers, decor: [] } };
    expect(layerArray(sparse, 'decor')).toEqual(Array(12).fill(-1));
    expect(setLayer(sparse, 'terrain', Array(12).fill(2)).layers.terrain).toHaveLength(12);
  });
});

describe('édition de tuiles', () => {
  it("peint et efface une seule case sans muter l'original", () => {
    const level = emptyLevel('l1', 'Test', 3, 3, 'tiles');
    const painted = paintCell(level, 'terrain', { x: 1, y: 1 }, 5);
    expect(layerArray(painted, 'terrain')[4]).toBe(5);
    expect(layerArray(level, 'terrain')[4]).toBe(-1);
    const erased = eraseCell(painted, 'terrain', { x: 1, y: 1 });
    expect(layerArray(erased, 'terrain')[4]).toBe(-1);
  });

  it('remplit par rectangle et par diffusion en réutilisant mapOps', () => {
    const level = emptyLevel('l1', 'Test', 3, 3, 'tiles');
    const rect = fillRectLayer(level, 'terrain', 0, 1, 1, 2, 7);
    expect(layerArray(rect, 'terrain')).toEqual([-1, -1, -1, 7, 7, -1, 7, 7, -1]);
    const filled = floodFillLayer(level, 'decor', 0, 0, 3);
    expect(layerArray(filled, 'decor')).toEqual(Array(9).fill(3));
  });
});

describe('redimensionnement', () => {
  it('conserve le contenu en haut à gauche et recadre entités/départ', () => {
    let level = emptyLevel('l1', 'Test', 3, 2, 'tiles');
    level = setLayer(level, 'terrain', [1, 2, 3, 4, 5, 6]);
    level = { ...level, playerStart: { x: 2, y: 1 } };
    level = addEntity(level, 'coin', { x: 1, y: 0 });
    level = addEntity(level, 'enemy', { x: 5, y: 5 }); // hors des nouvelles bornes -> filtrée

    const resized = resizeLevel(level, 2, 3);
    expect(layerArray(resized, 'terrain')).toEqual([1, 2, 4, 5, -1, -1]);
    expect(resized.playerStart).toEqual({ x: 1, y: 1 });
    expect(resized.entities.map((e) => e.id)).toEqual(['coin1']);
    expect(resized.entities[0]).toMatchObject({ x: 1, y: 0 });
  });
});

describe('entités', () => {
  it('génère des identifiants uniques par type', () => {
    const entities = [
      { id: 'enemy1', x: 0, y: 0, type: 'enemy' as const, kind: 'walker' as const, speed: 30, facing: 'left' as const },
      { id: 'enemy3', x: 1, y: 0, type: 'enemy' as const, kind: 'walker' as const, speed: 30, facing: 'left' as const },
    ];
    // Les identifiants comptent toutes les entités du niveau (même logique que les events
    // RPG de MapEditor), pas seulement celles du même type.
    expect(nextEntityId(entities, 'enemy')).toBe('enemy4');
    expect(nextEntityId(entities, 'coin')).toBe('coin3');
  });

  it('crée les valeurs par défaut correctes pour chaque type', () => {
    expect(defaultEntity('coin', 'coin1', { x: 1, y: 2 })).toEqual({ id: 'coin1', x: 1, y: 2, type: 'coin' });
    expect(defaultEntity('enemy', 'enemy1', { x: 0, y: 0 })).toEqual({
      id: 'enemy1',
      x: 0,
      y: 0,
      type: 'enemy',
      kind: 'walker',
      speed: 30,
      facing: 'left',
    });
    expect(defaultEntity('spring', 'spring1', { x: 0, y: 0 })).toEqual({
      id: 'spring1',
      x: 0,
      y: 0,
      type: 'spring',
      power: 380,
    });
    expect(defaultEntity('checkpoint', 'checkpoint1', { x: 0, y: 0 })).toEqual({
      id: 'checkpoint1',
      x: 0,
      y: 0,
      type: 'checkpoint',
    });
    expect(defaultEntity('goal', 'goal1', { x: 0, y: 0 })).toEqual({ id: 'goal1', x: 0, y: 0, type: 'goal' });
    expect(defaultEntity('sign', 'sign1', { x: 0, y: 0 })).toEqual({
      id: 'sign1',
      x: 0,
      y: 0,
      type: 'sign',
      text: '…',
    });
  });

  it("ajoute, déplace, modifie et supprime une entité sans muter l'original", () => {
    const level = emptyLevel('l1', 'Test', 5, 5, 'tiles');
    const withCoin = addEntity(level, 'coin', { x: 1, y: 1 });
    expect(level.entities).toHaveLength(0);
    expect(withCoin.entities).toHaveLength(1);
    expect(withCoin.entities[0]).toMatchObject({ id: 'coin1', x: 1, y: 1, type: 'coin' });

    const moved = moveEntity(withCoin, 'coin1', { x: 3, y: 3 });
    expect(moved.entities[0]).toMatchObject({ x: 3, y: 3 });
    expect(withCoin.entities[0]).toMatchObject({ x: 1, y: 1 });

    const withSpring = addEntity(moved, 'spring', { x: 0, y: 0 });
    const updated = updateEntity(withSpring, { ...withSpring.entities[1]!, power: 500 } as never);
    expect((updated.entities[1] as { power: number }).power).toBe(500);

    const deleted = deleteEntity(updated, 'coin1');
    expect(deleted.entities.map((e) => e.id)).toEqual(['spring2']);
    expect(updated.entities).toHaveLength(2);
  });

  it("ne fait rien quand l'identifiant est absent", () => {
    const level = addEntity(emptyLevel('l1', 'Test', 3, 3, 'tiles'), 'coin', { x: 0, y: 0 });
    expect(moveEntity(level, 'inconnu', { x: 1, y: 1 })).toEqual(level);
    expect(deleteEntity(level, 'inconnu')).toEqual(level);
  });
});

describe('point de départ', () => {
  it('remplace playerStart', () => {
    const level = emptyLevel('l1', 'Test', 4, 4, 'tiles');
    expect(setPlayerStart(level, { x: 2, y: 3 }).playerStart).toEqual({ x: 2, y: 3 });
  });
});

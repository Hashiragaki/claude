import {
  Engine,
  MemoryProjectFiles,
  MemorySaveStorage,
  ModeRegistry,
  PROJECT_FORMAT,
  loadProjectBundle,
} from '@forge/core';
import { describe, expect, it } from 'vitest';
import { sandbox3dMode } from './mode';
import { demoTemplate } from './templates';

/** Moteur sans affichage (`mount = null`) : seule la logique du runtime tourne. */
async function startEngine(scene: unknown) {
  const files = new MemoryProjectFiles({
    'project.json': {
      format: PROJECT_FORMAT,
      id: 'test-3d',
      name: 'Test 3D',
      mode: 'sandbox3d',
      entry: 'scenes/main.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    'scenes/main.json': scene as object,
  });
  const bundle = await loadProjectBundle(files);
  const engine = new Engine({
    bundle,
    modes: new ModeRegistry([sandbox3dMode]),
    autoLoop: false,
    saveStorage: new MemorySaveStorage(),
  });
  await engine.start();
  return engine;
}

describe('runtime (sans affichage)', () => {
  it('déplace le joueur, interagit, sauvegarde et recharge', async () => {
    const engine = await startEngine({
      ground: { size: 20, color: '#55aa55' },
      spawn: { x: 0, z: 2, rotation: 180 },
      objects: [
        {
          id: 'coffre',
          model: 'coffre',
          position: [0, 0, -1],
          collider: { radius: 0.5 },
          interact: { text: 'Trésor !', animation: 'open', once: true },
        },
      ],
    });
    expect(engine.debugState()).toEqual({ player: { x: 0, z: 2 }, nearby: null, triggered: [] });

    engine.input.press('up');
    engine.step(1);
    engine.input.release('up');
    engine.step(0.5);
    const state = engine.debugState() as { player: { x: number; z: number }; nearby: string | null };
    expect(state.player.z).toBeLessThan(2);
    expect(state.nearby).toBe('coffre');

    engine.input.tap('confirm');
    engine.step(1 / 60);
    expect(engine.debugState()).toMatchObject({ triggered: ['coffre'], nearby: null });
    await engine.save('rapide');

    engine.input.tap('confirm');
    engine.step(1 / 60);
    engine.input.press('down');
    engine.step(1);
    engine.input.release('down');
    const moved = engine.debugState() as { player: { z: number } };
    expect(moved.player.z).toBeGreaterThan(state.player.z);

    await engine.load('rapide');
    expect(engine.debugState()).toMatchObject({ player: state.player, triggered: ['coffre'] });
    engine.destroy();
  });

  it('démarre la démo même sans modèles chargeables', async () => {
    const scene = demoTemplate.files[0]?.content;
    const engine = await startEngine(scene);
    expect(engine.debugState()).toMatchObject({ player: { x: 0, z: 7 }, triggered: [] });
    engine.step(0.5);
    engine.destroy();
  });

  it('refuse une scène invalide avec un message lisible', async () => {
    await expect(startEngine({ objects: [{ id: 'x' }] })).rejects.toThrow(/Scène invalide/);
  });
});

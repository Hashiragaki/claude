import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUND,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_SKY,
  formatIssuePath,
  parseScene,
  safeParseScene,
} from './schema';

describe('schéma de scène', () => {
  it('complète une scène vide avec les valeurs par défaut', () => {
    const scene = parseScene({});
    expect(scene).toEqual({
      name: 'Scène 3D',
      sky: DEFAULT_SKY,
      timeOfDay: 'day',
      ground: DEFAULT_GROUND,
      spawn: { x: 0, z: 0 },
      player: { speed: 3, radius: DEFAULT_PLAYER_RADIUS },
      objects: [],
    });
  });

  it('applique les valeurs par défaut des objets, du joueur et de la caméra', () => {
    const scene = parseScene({
      player: { model: 'héros', walk: 'walk' },
      camera: {},
      objects: [{ id: 'coffre', model: 'coffre', position: [1, 0, 2], interact: { text: 'Ouvert !' } }],
    });
    expect(scene.player).toEqual({ model: 'héros', walk: 'walk', speed: 3, radius: DEFAULT_PLAYER_RADIUS });
    expect(scene.camera).toEqual({ distance: 6, height: 2.5 });
    expect(scene.objects[0]?.interact).toEqual({ text: 'Ouvert !', once: false });
  });

  it('accepte échelle uniforme ou par axe et collider désactivé', () => {
    const scene = parseScene({
      objects: [
        { id: 'a', model: 'm', position: [0, 0, 0], scale: 2, collider: false },
        { id: 'b', model: 'm', position: [0, 0, 0], scale: [1, 2, 1], rotation: [0, 90, 0], collider: { radius: 1 } },
      ],
    });
    expect(scene.objects[0]?.collider).toBe(false);
    expect(scene.objects[1]?.scale).toEqual([1, 2, 1]);
  });

  it('rejette les données invalides avec des messages en français', () => {
    const result = safeParseScene({
      sky: { top: 'bleu', bottom: '#fff' },
      timeOfDay: 'midi',
      fog: { color: '#fff', near: 50, far: 10 },
      objects: [
        { id: 'a', model: 'm', position: [0, 0] },
        { id: 'a', model: 'm', position: [0, 0, 0] },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => `${formatIssuePath(i.path)} : ${i.message}`) ?? [];
    expect(messages.some((m) => m.startsWith('sky.top : Couleur hexadécimale'))).toBe(true);
    expect(messages.some((m) => m.startsWith('timeOfDay : Option invalide'))).toBe(true);
    expect(messages.some((m) => m.startsWith('fog.far'))).toBe(true);
    expect(messages.some((m) => m.startsWith('objects[0].position'))).toBe(true);
    expect(() => parseScene({ ground: { size: -1, color: '#000' } })).toThrow(/Scène invalide/);
  });

  it('signale les identifiants en double', () => {
    const result = safeParseScene({
      objects: [
        { id: 'a', model: 'm', position: [0, 0, 0] },
        { id: 'a', model: 'm', position: [1, 0, 0] },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('en double');
    expect(formatIssuePath(result.error?.issues[0]?.path ?? [])).toBe('objects[1].id');
  });
});

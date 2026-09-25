import { describe, expect, it } from 'vitest';
import {
  InteractionTracker,
  colliderRadius,
  findNearestInteractable,
  sceneColliders,
} from './interaction';
import {
  cameraRelativeDirection,
  resolveCollisions,
  slideVelocity,
  stepMovement,
  type PlayerState,
} from './movement';
import { parseScene, type SceneInput } from './schema';
import { SandboxWorld } from './world';

const still = (over: Partial<PlayerState> = {}): PlayerState => ({ x: 0, z: 0, rotation: 0, vx: 0, vz: 0, ...over });

describe('déplacement', () => {
  it('avance dans la direction regardée par la caméra', () => {
    // Caméra côté +Z (lacet 0) : « avant » va vers -Z, « droite » vers +X.
    const fwd = cameraRelativeDirection({ x: 0, y: 1 }, 0);
    expect(fwd.x).toBeCloseTo(0);
    expect(fwd.z).toBeCloseTo(-1);
    const right = cameraRelativeDirection({ x: 1, y: 0 }, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
    // Caméra tournée d'un quart de tour (côté +X) : « avant » va vers -X.
    const turned = cameraRelativeDirection({ x: 0, y: 1 }, Math.PI / 2);
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);
    // Diagonale normalisée.
    const diag = cameraRelativeDirection({ x: 1, y: 1 }, 0);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1);
  });

  it('accélère progressivement puis plafonne à la vitesse (course incluse)', () => {
    let s = still();
    s = stepMovement(s, { x: 0, y: 1 }, 0, false, { speed: 4 }, 1 / 60);
    const first = Math.hypot(s.vx, s.vz);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(4);
    for (let i = 0; i < 120; i++) s = stepMovement(s, { x: 0, y: 1 }, 0, false, { speed: 4 }, 1 / 60);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(4);
    expect(s.z).toBeLessThan(0);
    // Le personnage s'oriente vers -Z (rotation ±π).
    expect(Math.abs(s.rotation)).toBeCloseTo(Math.PI, 2);
    for (let i = 0; i < 120; i++) s = stepMovement(s, { x: 0, y: 1 }, 0, true, { speed: 4, runMultiplier: 2 }, 1 / 60);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(8);
    for (let i = 0; i < 120; i++) s = stepMovement(s, { x: 0, y: 0 }, 0, false, { speed: 4 }, 1 / 60);
    expect(Math.hypot(s.vx, s.vz)).toBe(0);
  });
});

describe('collisions', () => {
  it('repousse le joueur hors d’un obstacle circulaire', () => {
    const r = resolveCollisions({ x: 0.5, z: 0 }, 0.5, [{ x: 0, z: 0, radius: 1 }]);
    expect(r.x).toBeCloseTo(1.5);
    expect(r.z).toBeCloseTo(0);
    expect(r.normals).toHaveLength(1);
    const far = resolveCollisions({ x: 3, z: 0 }, 0.5, [{ x: 0, z: 0, radius: 1 }]);
    expect(far).toEqual({ x: 3, z: 0, normals: [] });
  });

  it('confine le joueur au sol et gère les obstacles qui se touchent', () => {
    const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    const out = resolveCollisions({ x: 7, z: -9 }, 0.4, [], bounds);
    expect(out.x).toBeCloseTo(4.6);
    expect(out.z).toBeCloseTo(-4.6);
    const pair = [
      { x: -0.8, z: 0, radius: 1 },
      { x: 0.8, z: 0, radius: 1 },
    ];
    const r = resolveCollisions({ x: 0, z: 0.2 }, 0.3, pair, bounds, 6);
    for (const c of pair) expect(Math.hypot(r.x - c.x, r.z - c.z)).toBeGreaterThanOrEqual(1.3 - 1e-6);
  });

  it('fait glisser la vitesse le long de l’obstacle', () => {
    const v = slideVelocity(1, -1, [{ x: 0, z: 1 }]);
    expect(v.vx).toBeCloseTo(1);
    expect(v.vz).toBeCloseTo(0);
    // Une vitesse qui s'éloigne n'est pas modifiée.
    expect(slideVelocity(0, 2, [{ x: 0, z: 1 }])).toEqual({ vx: 0, vz: 2 });
  });

  it('dérive les cercles de collision des objets', () => {
    const scene = parseScene({
      objects: [
        { id: 'a', model: 'm', position: [1, 0, 2] },
        { id: 'b', model: 'm', position: [0, 0, 0], scale: 3 },
        { id: 'c', model: 'm', position: [0, 0, 0], collider: false },
        { id: 'd', model: 'm', position: [0, 0, 0], scale: 3, collider: { radius: 0.2 } },
      ],
    });
    expect(scene.objects.map(colliderRadius)).toEqual([0.5, 1.5, 0, 0.2]);
    expect(sceneColliders(scene).map((c) => c.id)).toEqual(['a', 'b', 'd']);
  });
});

const interactiveScene: SceneInput = {
  ground: { size: 20, color: '#55aa55' },
  spawn: { x: 0, z: 0, rotation: 180 },
  player: { speed: 3 },
  objects: [
    {
      id: 'coffre',
      model: 'coffre',
      position: [0, 0, -2],
      collider: { radius: 0.5 },
      interact: { text: 'Trésor !', animation: 'open', once: true },
    },
    { id: 'pnj', model: 'pnj', position: [4, 0, 0], collider: { radius: 0.4 }, interact: { text: 'Bonjour.' } },
    { id: 'arbre', model: 'arbre', position: [-3, 0, 0] },
  ],
};

describe('interactions', () => {
  it('trouve l’objet interactif le plus proche à portée', () => {
    const scene = parseScene(interactiveScene);
    const none = new Set<string>();
    expect(findNearestInteractable({ x: 0, z: -0.6 }, 0.35, scene.objects, none)?.id).toBe('coffre');
    expect(findNearestInteractable({ x: 3.2, z: 0 }, 0.35, scene.objects, none)?.id).toBe('pnj');
    expect(findNearestInteractable({ x: 0, z: 5 }, 0.35, scene.objects, none)).toBeNull();
    // Un objet « once » déjà utilisé n'est plus proposé.
    expect(findNearestInteractable({ x: 0, z: -0.6 }, 0.35, scene.objects, new Set(['coffre']))).toBeNull();
  });

  it('ouvre puis ferme la boîte de dialogue et mémorise les objets utilisés', () => {
    const scene = parseScene(interactiveScene);
    const tracker = new InteractionTracker();
    const [coffre, pnj] = scene.objects;
    expect(tracker.confirm(null)).toBeNull();
    expect(tracker.confirm(coffre ?? null)).toEqual({
      type: 'open',
      objectId: 'coffre',
      text: 'Trésor !',
      animation: 'open',
      firstTime: true,
    });
    expect(tracker.active?.text).toBe('Trésor !');
    expect(tracker.confirm(coffre ?? null)).toEqual({ type: 'close', objectId: 'coffre' });
    expect(tracker.active).toBeNull();
    // `once` : plus d'interaction possible.
    expect(tracker.confirm(coffre ?? null)).toBeNull();
    // Sans `once`, on peut recommencer.
    expect(tracker.confirm(pnj ?? null)?.type).toBe('open');
    tracker.close();
    expect(tracker.confirm(pnj ?? null)).toMatchObject({ type: 'open', firstTime: false });
    expect(tracker.triggered).toEqual(['coffre', 'pnj']);
  });
});

describe('SandboxWorld', () => {
  const idle = { moveX: 0, moveY: 0, run: false, confirm: false };

  it('déplace le joueur, bloque sur les obstacles et gèle pendant un dialogue', () => {
    const world = new SandboxWorld(parseScene(interactiveScene));
    const yaw = world.cameraYawBehindPlayer();
    // Spawn tourné de 180° : l'avant du joueur est -Z, vers le coffre.
    for (let i = 0; i < 120; i++) world.step({ ...idle, moveY: 1 }, yaw, 1 / 60);
    expect(world.player.z).toBeLessThan(0);
    // Le coffre (rayon 0,5) bloque à 0,85 m de son centre.
    expect(world.player.z).toBeGreaterThanOrEqual(-2 + 0.85 - 1e-6);
    expect(world.debugState().nearby).toBe('coffre');

    const opened = world.step({ ...idle, confirm: true }, yaw, 1 / 60);
    expect(opened.event).toMatchObject({ type: 'open', objectId: 'coffre' });
    const before = { ...world.player };
    for (let i = 0; i < 60; i++) world.step({ ...idle, moveX: 1 }, yaw, 1 / 60);
    expect(world.player.x).toBeCloseTo(before.x, 1);
    const closed = world.step({ ...idle, confirm: true }, yaw, 1 / 60);
    expect(closed.event).toEqual({ type: 'close', objectId: 'coffre' });
    expect(world.debugState()).toMatchObject({ nearby: null, triggered: ['coffre'] });
  });

  it('sérialise et restaure la position et les interactions', () => {
    const world = new SandboxWorld(parseScene(interactiveScene));
    world.teleport(3, 0);
    world.step({ ...idle, confirm: true }, 0, 1 / 60);
    world.step({ ...idle, confirm: true }, 0, 1 / 60);
    const saved = world.serialize();
    expect(saved).toMatchObject({ version: 1, triggered: ['pnj'] });
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);

    const other = new SandboxWorld(parseScene(interactiveScene));
    expect(other.restore({ nimporte: 'quoi' })).toBe(false);
    expect(other.restore({ ...saved, triggered: ['pnj', 'objet-supprimé'] })).toBe(true);
    expect(other.debugState()).toEqual({
      player: { x: saved.player.x, z: saved.player.z },
      nearby: 'pnj',
      triggered: ['pnj'],
    });
    // Une position invalide (dans un obstacle) est corrigée.
    other.restore({ version: 1, player: { x: 4, z: 0, rotation: 0 }, triggered: [] });
    expect(Math.hypot(other.player.x - 4, other.player.z)).toBeGreaterThanOrEqual(0.75 - 1e-6);
  });

  it('replace le point d’apparition hors du sol ou dans un obstacle', () => {
    const world = new SandboxWorld(parseScene({ ...interactiveScene, spawn: { x: 50, z: -2 } }));
    expect(world.player.x).toBeCloseTo(10 - 0.35);
  });
});

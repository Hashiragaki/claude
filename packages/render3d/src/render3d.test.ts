import { AnimationClip, Group, Object3D, PerspectiveCamera, Scene, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { AnimationController } from './animation';
import { LIGHTING_PRESETS, applyFog, createDefaultLighting, createGround, createSky } from './environment';
import { instantiate } from './gltf';
import {
  angleDelta,
  clamp,
  damp,
  dampAngle,
  fitAspect,
  framingDistance,
  orbitOffset,
  parseHexColor,
  wrapAngle,
} from './math';
import { ThirdPersonCamera } from './thirdPersonCamera';

describe('math', () => {
  it('clamp et wrapAngle', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('damp converge sans dépasser et ne dépend pas du découpage du temps', () => {
    let a = 0;
    for (let i = 0; i < 10; i++) a = damp(a, 10, 5, 0.01);
    const b = damp(0, 10, 5, 0.1);
    expect(a).toBeCloseTo(b, 6);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(10);
    expect(damp(3, 10, 5, 0)).toBe(3);
    expect(damp(0, 10, 50, 10)).toBeCloseTo(10);
  });

  it('dampAngle prend le plus court chemin', () => {
    const next = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 10, 0.05);
    // On passe par ±π plutôt que de faire presque un tour complet.
    expect(Math.abs(next)).toBeGreaterThan(Math.PI - 0.1);
  });

  it('framingDistance fait tenir la sphère dans le champ', () => {
    const d = framingDistance(1, 90, 1, 1);
    expect(d).toBeCloseTo(Math.SQRT2, 5);
    // Un format portrait (étroit) impose de reculer davantage.
    expect(framingDistance(1, 50, 0.5)).toBeGreaterThan(framingDistance(1, 50, 2));
    expect(framingDistance(2, 50, 1)).toBeCloseTo(2 * framingDistance(1, 50, 1));
  });

  it('orbitOffset place la caméra derrière (+Z) avec yaw = 0', () => {
    const o = orbitOffset(0, 0, 5);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(5);
    const up = orbitOffset(Math.PI / 2, Math.PI / 2, 2);
    expect(up.y).toBeCloseTo(2);
    expect(Math.hypot(up.x, up.z)).toBeCloseTo(0);
  });

  it('parseHexColor et fitAspect', () => {
    expect(parseHexColor('#fff')).toBe(0xffffff);
    expect(parseHexColor('#3a7d44')).toBe(0x3a7d44);
    expect(parseHexColor('pas une couleur', 0x123456)).toBe(0x123456);
    expect(fitAspect(1920, 1200, 16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(fitAspect(1000, 1000, 2)).toEqual({ width: 1000, height: 500 });
  });
});

function clipMovingX(name: string, duration: number, to: number): AnimationClip {
  return new AnimationClip(name, duration, [new VectorKeyframeTrack('.position', [0, duration], [0, 0, 0, to, 0, 0])]);
}

describe('AnimationController', () => {
  it('liste les animations et joue par nom', () => {
    const root = new Object3D();
    const ctrl = new AnimationController(root, [clipMovingX('walk', 1, 1), clipMovingX('idle', 1, 0)]);
    expect(ctrl.names.sort()).toEqual(['idle', 'walk']);
    expect(ctrl.play('inconnue')).toBe(false);
    expect(ctrl.current).toBeNull();
    expect(ctrl.play('walk')).toBe(true);
    ctrl.update(0.5);
    expect(root.position.x).toBeCloseTo(0.5);
    // Rejouer l'animation en cours ne la redémarre pas.
    ctrl.play('walk');
    ctrl.update(0.1);
    expect(root.position.x).toBeCloseTo(0.6);
  });

  it('fait un fondu enchaîné puis revient à l’animation « then »', () => {
    const root = new Object3D();
    const ctrl = new AnimationController(root, [clipMovingX('idle', 1, 0), clipMovingX('wave', 0.5, 2)]);
    ctrl.play('idle');
    ctrl.update(0.1);
    ctrl.play('wave', { loop: false, fadeSeconds: 0.1, then: 'idle' });
    expect(ctrl.current).toBe('wave');
    ctrl.update(0.3);
    ctrl.update(0.3);
    expect(ctrl.current).toBe('idle');
  });

  it('peut démarrer une animation directement à sa fin', () => {
    const root = new Object3D();
    const ctrl = new AnimationController(root, [clipMovingX('open', 1, 3)]);
    ctrl.play('open', { loop: false, atEnd: true, fadeSeconds: 0 });
    ctrl.update(0.016);
    expect(root.position.x).toBeCloseTo(3);
    ctrl.stop();
    expect(ctrl.current).toBeNull();
    ctrl.dispose();
  });
});

describe('environnement', () => {
  it('ajoute ciel, lumières, brouillard et sol', () => {
    const scene = new Scene();
    const sky = createSky(scene, { top: '#336699', bottom: '#ffeedd' });
    const lighting = createDefaultLighting(scene, { timeOfDay: 'sunset', extent: 15 });
    expect(lighting.preset).toBe(LIGHTING_PRESETS.sunset);
    expect(lighting.sun.castShadow).toBe(true);
    expect(lighting.sun.shadow.camera.right).toBe(15);
    lighting.focus({ x: 10, y: 0, z: -4 });
    expect(lighting.sun.target.position.x).toBe(10);
    const fog = applyFog(scene, { color: '#ffffff', near: 10, far: 50 });
    expect(fog?.far).toBe(50);
    const ground = createGround(scene, { size: 20, color: '#55aa55' });
    expect(ground.receiveShadow).toBe(true);
    expect(scene.children).toContain(sky.mesh);
    sky.dispose();
    lighting.dispose();
    expect(scene.children).not.toContain(sky.mesh);
    expect(applyFog(scene, null)).toBeNull();
  });

  it('instantiate clone la hiérarchie', () => {
    const group = new Group();
    group.add(new Object3D());
    const copy = instantiate(group);
    expect(copy).not.toBe(group);
    expect(copy.children).toHaveLength(1);
  });
});

describe('ThirdPersonCamera', () => {
  it('suit la cible avec amortissement et borne le tangage', () => {
    const camera = new PerspectiveCamera();
    const target = new Object3D();
    const tpc = new ThirdPersonCamera(camera, target, { distance: 5, height: 2, lookHeight: 1 });
    tpc.snap();
    expect(camera.position.z).toBeCloseTo(5);
    expect(camera.position.y).toBeCloseTo(3);
    target.position.x = 10;
    tpc.update(1 / 60);
    expect(tpc.lookAt.x).toBeGreaterThan(0);
    expect(tpc.lookAt.x).toBeLessThan(10);
    for (let i = 0; i < 300; i++) tpc.update(1 / 60);
    expect(tpc.lookAt.x).toBeCloseTo(10, 2);
    tpc.rotate(0, 100000);
    tpc.snap();
    expect(tpc.pitch).toBeLessThanOrEqual(1.35);
    tpc.zoom(-100000);
    tpc.snap();
    expect(tpc.radius).toBe(2);
    tpc.detach();
  });
});

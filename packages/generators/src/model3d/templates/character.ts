import { animation, keyframes, oscillate } from '../anim';
import { ModelBuilder } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/**
 * Personnage cubique aux proportions « chibi », face vers +Z. Bras et jambes sont des groupes
 * pivotant aux épaules et aux hanches ; animations `idle`, `walk`, `run` et `wave`.
 */
export const character: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const legH = 0.42 + rng.float(-0.03, 0.04);
  const legW = 0.15;
  const torsoH = 0.42 + rng.float(-0.02, 0.04);
  const torsoW = 0.42 + rng.float(-0.02, 0.03);
  const torsoD = 0.24;
  const head = 0.36 + rng.float(-0.02, 0.03);
  const armL = 0.4 + rng.float(-0.02, 0.03);
  const armW = 0.12;
  const shirt = color ?? jitter(rng.pick(['#3f7fbf', '#c0392b', '#2e8b57', '#8e44ad', '#e67e22', '#16a085']), rng);
  b.material('skin', rng.pick(['#f1c7a5', '#e0ac7e', '#c68642', '#8d5524', '#ffdbac']), { roughness: 0.7 });
  b.material('shirt', shirt);
  b.material('pants', jitter(rng.pick(['#34495e', '#5d4037', '#2c3e50', '#4b5563']), rng));
  b.material('shoes', '#3b2a20');
  b.material('hair', rng.pick(['#3b2314', '#1c1c1c', '#d9a441', '#a0522d', '#c9c1b3', '#7b3f00']));
  b.material('eyes', '#1d1d1d', { roughness: 0.3 });
  b.material('belt', '#2b2b2b');

  const root = b.group('root');
  b.group('hips', root, [0, legH, 0]);
  b.add('torso', { parent: 'hips', shape: { type: 'box', size: [torsoW, torsoH, torsoD] }, material: 'shirt', position: [0, torsoH / 2, 0] });
  b.add('belt', { parent: 'hips', shape: { type: 'box', size: [torsoW + 0.01, 0.06, torsoD + 0.01] }, material: 'belt', position: [0, 0.04, 0] });
  b.group('chest', 'hips', [0, torsoH, 0]);
  b.group('head', 'chest', [0, 0.01, 0]);
  b.add('head_mesh', { parent: 'head', shape: { type: 'box', size: [head, head, head * 0.92] }, material: 'skin', position: [0, head / 2, 0] });
  b.add('hair_top', {
    parent: 'head',
    shape: { type: 'box', size: [head + 0.03, head * 0.28, head * 0.92 + 0.03] },
    material: 'hair',
    position: [0, head * 0.9, -0.01],
  });
  b.add('hair_back', {
    parent: 'head',
    shape: { type: 'box', size: [head + 0.03, head * 0.6, head * 0.3] },
    material: 'hair',
    position: [0, head * 0.62, -head * 0.33],
  });
  const face = head * 0.46 + 0.005;
  for (const [id, x] of [['eye_l', 1], ['eye_r', -1]] as const) {
    b.add(id, { parent: 'head', shape: { type: 'box', size: [0.05, 0.075, 0.02] }, material: 'eyes', position: [x * head * 0.2, head * 0.5, face] });
  }
  b.add('mouth', { parent: 'head', shape: { type: 'box', size: [0.08, 0.02, 0.012] }, material: 'eyes', position: [0, head * 0.27, face] });
  if (rng.bool(0.3)) {
    b.material('hat', shade(shirt, -0.15));
    b.add('hat_brim', {
      parent: 'head',
      shape: { type: 'cylinder', radiusTop: head * 0.78, radiusBottom: head * 0.78, height: 0.03, radialSegments: 16 },
      material: 'hat',
      position: [0, head + 0.03, 0],
    });
    b.add('hat_top', {
      parent: 'head',
      shape: { type: 'cylinder', radiusTop: head * 0.42, radiusBottom: head * 0.48, height: head * 0.35, radialSegments: 16 },
      material: 'hat',
      position: [0, head + 0.03 + head * 0.175, 0],
    });
  }

  // Côté gauche du personnage = +X (il regarde vers +Z).
  for (const [side, x] of [['l', 1], ['r', -1]] as const) {
    b.group(`arm_${side}`, 'chest', [x * (torsoW / 2 + armW / 2 + 0.005), -0.05, 0]);
    b.add(`arm_${side}_mesh`, {
      parent: `arm_${side}`,
      shape: { type: 'box', size: [armW, armL * 0.72, armW] },
      material: 'shirt',
      position: [0, -armL * 0.36, 0],
    });
    b.add(`hand_${side}`, {
      parent: `arm_${side}`,
      shape: { type: 'box', size: [armW * 0.92, armL * 0.28, armW * 0.92] },
      material: 'skin',
      position: [0, -armL * 0.86, 0],
    });
    b.group(`leg_${side}`, 'hips', [x * (legW / 2 + 0.02), 0, 0]);
    b.add(`leg_${side}_mesh`, {
      parent: `leg_${side}`,
      shape: { type: 'box', size: [legW, legH - 0.07, legW * 1.1] },
      material: 'pants',
      position: [0, -(legH - 0.07) / 2, 0],
    });
    b.add(`shoe_${side}`, {
      parent: `leg_${side}`,
      shape: { type: 'box', size: [legW * 1.1, 0.08, legW * 1.6] },
      material: 'shoes',
      position: [0, -legH + 0.04, 0.035],
    });
  }

  const gait = (name: string, duration: number, leg: number, arm: number, bob: number, lean: number) =>
    animation(name, duration, [
      oscillate('leg_l', 'rotation', [0, 0, 0], [leg, 0, 0], duration),
      oscillate('leg_r', 'rotation', [0, 0, 0], [-leg, 0, 0], duration),
      oscillate('arm_l', 'rotation', [0, 0, 0], [-arm, 0, 0], duration),
      oscillate('arm_r', 'rotation', [0, 0, 0], [arm, 0, 0], duration),
      oscillate('hips', 'position', [0, legH, 0], [0, bob, 0], duration, { cycles: 2, phase: Math.PI / 2 }),
      oscillate('chest', 'rotation', [lean, 0, 0], [0, 4, 0], duration),
    ]);

  return {
    name: 'Personnage',
    builder: b,
    root,
    animations: {
      idle: () =>
        animation('idle', 2.4, [
          oscillate('chest', 'position', [0, torsoH + 0.006, 0], [0, 0.006, 0], 2.4),
          oscillate('torso', 'scale', [1, 1.012, 1], [0, 0.012, 0], 2.4),
          oscillate('head', 'rotation', [0, 0, 0], [0, 0, 2], 2.4, { phase: 0.8 }),
          oscillate('arm_l', 'rotation', [0, 0, 2], [0, 0, 2], 2.4),
          oscillate('arm_r', 'rotation', [0, 0, -2], [0, 0, -2], 2.4),
        ]),
      walk: () => gait('walk', 0.8, 30, 25, 0.015, 0),
      run: () => gait('run', 0.5, 45, 40, 0.03, 8),
      wave: () =>
        animation('wave', 2, [
          keyframes('arm_r', 'rotation', [
            [0, [0, 0, 0]],
            [0.3, [0, 0, -150]],
            [0.55, [0, 0, -170]],
            [0.8, [0, 0, -135]],
            [1.05, [0, 0, -170]],
            [1.3, [0, 0, -135]],
            [1.55, [0, 0, -155]],
            [2, [0, 0, 0]],
          ]),
          keyframes('head', 'rotation', [
            [0, [0, 0, 0]],
            [0.4, [0, -8, 4]],
            [1.6, [0, -8, 4]],
            [2, [0, 0, 0]],
          ]),
        ]),
    },
  };
};

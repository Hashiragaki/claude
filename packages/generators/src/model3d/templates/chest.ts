import { animation, keyframes } from '../anim';
import { ModelBuilder, type Vec3 } from '../builder';
import { jitter } from '../color';
import type { TemplateFn } from './types';

/** Coffre au trésor : caisson cerclé, couvercle bombé sur charnière arrière ; animations `open` / `close`. */
export const chest: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const w = rng.float(0.85, 1);
  const h = rng.float(0.45, 0.55);
  const d = rng.float(0.55, 0.65);
  const lidH = d * rng.float(0.32, 0.4);
  const gold = rng.bool(0.6);
  b.material('wood', color ?? jitter(rng.pick(['#9c6b3c', '#8a5a33', '#a8743f']), rng), { roughness: 0.85 });
  b.material('metal', gold ? '#c9a227' : '#6d6f73', { metalness: 0.8, roughness: 0.35 });
  b.material('inside', '#3a2414', { roughness: 1 });
  b.material('treasure', '#f5c542', { metalness: 0.9, roughness: 0.3, emissive: '#6a4a00' });

  const root = b.group('root');
  b.add('base', { parent: root, shape: { type: 'box', size: [w, h, d] }, material: 'wood', position: [0, h / 2, 0] });
  b.add('base_trim', {
    parent: root,
    shape: { type: 'box', size: [w + 0.02, 0.05, d + 0.02] },
    material: 'metal',
    position: [0, 0.025, 0],
  });
  b.add('inside', {
    parent: root,
    shape: { type: 'box', size: [w - 0.08, 0.012, d - 0.08] },
    material: 'inside',
    position: [0, h + 0.001, 0],
  });
  b.add('treasure', {
    parent: root,
    shape: { type: 'sphere', radius: w * 0.3, widthSegments: 12, heightSegments: 8 },
    material: 'treasure',
    position: [0, h, 0],
    scale: [1.1, 0.22, 0.8],
  });
  for (const x of [-0.3, 0.3]) {
    b.add(`band_${x < 0 ? 'l' : 'r'}`, {
      parent: root,
      shape: { type: 'box', size: [0.06, h + 0.01, d + 0.02] },
      material: 'metal',
      position: [x * w, (h + 0.01) / 2, 0],
    });
  }

  // Couvercle : demi-ellipse extrudée (profil ZY), tournée de 90° pour s'étendre selon X.
  const arc = (scale: number): number[][] =>
    Array.from({ length: 11 }, (_, i) => {
      const theta = (Math.PI * i) / 10;
      return [-(d / 2) - (d / 2) * scale * Math.cos(theta), lidH * scale * Math.sin(theta)];
    });
  b.group('lid_hinge', root, [0, h, -d / 2]);
  b.add('lid', {
    parent: 'lid_hinge',
    shape: { type: 'extrude', points: arc(1), depth: w },
    material: 'wood',
    rotation: [0, 90, 0],
  });
  for (const x of [-0.3, 0.3]) {
    b.add(`lid_band_${x < 0 ? 'l' : 'r'}`, {
      parent: 'lid_hinge',
      shape: { type: 'extrude', points: arc(1.04), depth: 0.06 },
      material: 'metal',
      position: [x * w, 0, 0],
      rotation: [0, 90, 0],
    });
  }
  const lock: Vec3 = [0, -0.02, d + 0.025];
  b.add('lock', {
    parent: 'lid_hinge',
    shape: { type: 'box', size: [0.12, 0.14, 0.05] },
    material: 'metal',
    position: lock,
  });
  b.add('keyhole', {
    parent: 'lid_hinge',
    shape: { type: 'cylinder', radiusTop: 0.015, radiusBottom: 0.015, height: 0.02, radialSegments: 8 },
    material: 'inside',
    position: [0, -0.03, d + 0.05],
    rotation: [90, 0, 0],
  });

  return {
    name: 'Coffre',
    builder: b,
    root,
    animations: {
      open: () =>
        animation(
          'open',
          0.9,
          [
            keyframes('lid_hinge', 'rotation', [
              [0, [0, 0, 0]],
              [0.2, [-18, 0, 0]],
              [0.45, [-70, 0, 0]],
              [0.7, [-110, 0, 0]],
              [0.9, [-104, 0, 0]],
            ]),
          ],
          false,
        ),
      close: () =>
        animation(
          'close',
          0.6,
          [
            keyframes('lid_hinge', 'rotation', [
              [0, [-104, 0, 0]],
              [0.35, [-40, 0, 0]],
              [0.5, [0, 0, 0]],
              [0.55, [-4, 0, 0]],
              [0.6, [0, 0, 0]],
            ]),
          ],
          false,
        ),
    },
  };
};

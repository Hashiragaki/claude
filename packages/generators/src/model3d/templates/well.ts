import { animation, oscillate } from '../anim';
import { ModelBuilder } from '../builder';
import { jitter } from '../color';
import type { TemplateFn } from './types';

/** Puits : margelle creuse (lathe), eau, poteaux, treuil, toit à deux pans, seau suspendu (`sway`). */
export const well: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const r = rng.float(0.7, 0.82);
  const wallH = rng.float(0.65, 0.8);
  b.material('stone', jitter(rng.pick(['#9a958c', '#8c8f96', '#a39583']), rng, 0.6), { flatShading: true, roughness: 0.95 });
  b.material('water', '#3a6ea5', { roughness: 0.15, opacity: 0.9 });
  b.material('wood', jitter('#7a5230', rng), { roughness: 0.9 });
  b.material('roof', color ?? jitter(rng.pick(['#a8452f', '#6b4a2f', '#4a6fa5']), rng), { flatShading: true, roughness: 0.85 });
  b.material('rope', '#c8b38a', { roughness: 1 });
  b.material('metal', '#5b5f66', { metalness: 0.7, roughness: 0.4 });

  const root = b.group('root');
  b.add('wall', {
    parent: root,
    shape: {
      type: 'lathe',
      points: [
        [r, 0],
        [r, wallH - 0.04],
        [r + 0.06, wallH],
        [r + 0.06, wallH + 0.1],
        [r - 0.18, wallH + 0.1],
        [r - 0.18, 0.1],
      ],
      segments: 12,
    },
    material: 'stone',
  });
  b.add('water', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: r - 0.18, radiusBottom: r - 0.18, height: 0.02, radialSegments: 12 },
    material: 'water',
    position: [0, wallH * 0.55, 0],
  });

  const postH = wallH + 1.3;
  const postX = r - 0.05;
  for (const side of [-1, 1]) {
    b.add(`post_${side < 0 ? 'l' : 'r'}`, {
      parent: root,
      shape: { type: 'box', size: [0.1, postH, 0.1] },
      material: 'wood',
      position: [side * postX, postH / 2, 0],
    });
  }
  const axleY = wallH + 0.85;
  b.add('axle', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.045, radiusBottom: 0.045, height: 2 * postX + 0.25, radialSegments: 8 },
    material: 'wood',
    position: [0, axleY, 0],
    rotation: [0, 0, 90],
  });
  b.add('crank', { parent: root, shape: { type: 'box', size: [0.04, 0.22, 0.04] }, material: 'metal', position: [postX + 0.14, axleY - 0.09, 0] });

  // Toit : deux pans inclinés de part et d'autre du faîte (axe X).
  const ridgeY = postH + 0.05;
  const halfSpan = 0.62;
  const angle = 35;
  const slab = halfSpan / Math.cos((angle * Math.PI) / 180);
  for (const side of [-1, 1]) {
    b.add(`roof_${side < 0 ? 'back' : 'front'}`, {
      parent: root,
      shape: { type: 'box', size: [2 * postX + 0.45, 0.06, slab + 0.08] },
      material: 'roof',
      position: [0, ridgeY - (halfSpan / 2) * Math.tan((angle * Math.PI) / 180), (side * halfSpan) / 2],
      rotation: [side * angle, 0, 0],
    });
  }

  // Seau suspendu à la corde, pivotant sous le treuil.
  b.group('bucket_pivot', root, [0, axleY, 0]);
  const ropeL = rng.float(0.35, 0.5);
  b.add('rope', {
    parent: 'bucket_pivot',
    shape: { type: 'cylinder', radiusTop: 0.012, radiusBottom: 0.012, height: ropeL, radialSegments: 6 },
    material: 'rope',
    position: [0, -ropeL / 2, 0],
  });
  b.add('bucket', {
    parent: 'bucket_pivot',
    shape: { type: 'cylinder', radiusTop: 0.13, radiusBottom: 0.1, height: 0.17, radialSegments: 10 },
    material: 'wood',
    position: [0, -ropeL - 0.1, 0],
  });
  b.add('bucket_band', {
    parent: 'bucket_pivot',
    shape: { type: 'torus', radius: 0.12, tube: 0.012 },
    material: 'metal',
    position: [0, -ropeL - 0.07, 0],
    rotation: [90, 0, 0],
  });

  return {
    name: 'Puits',
    builder: b,
    root,
    animations: {
      sway: () => animation('sway', 2.4, [oscillate('bucket_pivot', 'rotation', [0, 0, 0], [6, 0, 3], 2.4)]),
    },
  };
};

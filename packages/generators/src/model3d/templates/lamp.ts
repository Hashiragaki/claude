import { animation, keyframes } from '../anim';
import { ModelBuilder, type Vec3 } from '../builder';
import { jitter } from '../color';
import type { TemplateFn } from './types';

/** Lampadaire en fonte : lanterne vitrée ou globe lumineux (matériau émissif) ; animation `flicker`. */
export const lamp: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const postH = rng.float(1.9, 2.2);
  const light = color ?? jitter('#ffd27a', rng, 0.5);
  b.material('iron', jitter(rng.pick(['#2f3640', '#233329', '#3b2f2f']), rng, 0.5), { metalness: 0.6, roughness: 0.45 });
  b.material('light', '#fff6d8', { emissive: light, roughness: 0.3 });
  b.material('glass', '#fff8e1', { opacity: 0.35, roughness: 0.1 });

  const root = b.group('root');
  b.add('base', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.14, radiusBottom: 0.22, height: 0.25, radialSegments: 12 },
    material: 'iron',
    position: [0, 0.125, 0],
  });
  b.add('post', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.045, radiusBottom: 0.055, height: postH, radialSegments: 10 },
    material: 'iron',
    position: [0, 0.25 + postH / 2, 0],
  });
  b.add('ring', { parent: root, shape: { type: 'torus', radius: 0.07, tube: 0.02 }, material: 'iron', position: [0, 0.6, 0], rotation: [90, 0, 0] });
  const top = 0.25 + postH;
  b.group('head', root, [0, top, 0]);

  if (rng.bool(0.6)) {
    // Lanterne : socle, vitre, montants, ampoule, chapeau pyramidal.
    b.add('lantern_base', {
      parent: 'head',
      shape: { type: 'cylinder', radiusTop: 0.15, radiusBottom: 0.08, height: 0.06, radialSegments: 4 },
      material: 'iron',
      position: [0, 0.03, 0],
      rotation: [0, 45, 0],
    });
    b.add('bulb', { parent: 'head', shape: { type: 'sphere', radius: 0.08, widthSegments: 12, heightSegments: 8 }, material: 'light', position: [0, 0.23, 0] });
    b.add('glass', { parent: 'head', shape: { type: 'box', size: [0.26, 0.34, 0.26] }, material: 'glass', position: [0, 0.23, 0] });
    for (const [i, corner] of ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).entries()) {
      const p: Vec3 = [corner[0] * 0.135, 0.23, corner[1] * 0.135];
      b.add(`frame_${i}`, { parent: 'head', shape: { type: 'box', size: [0.025, 0.36, 0.025] }, material: 'iron', position: p });
    }
    b.add('cap', {
      parent: 'head',
      shape: { type: 'cone', radius: 0.25, height: 0.18, radialSegments: 4 },
      material: 'iron',
      position: [0, 0.49, 0],
      rotation: [0, 45, 0],
    });
    b.add('finial', { parent: 'head', shape: { type: 'sphere', radius: 0.03, widthSegments: 8, heightSegments: 6 }, material: 'iron', position: [0, 0.61, 0] });
  } else {
    // Globe lumineux sur collerette.
    b.add('collar', {
      parent: 'head',
      shape: { type: 'cylinder', radiusTop: 0.09, radiusBottom: 0.06, height: 0.08, radialSegments: 12 },
      material: 'iron',
      position: [0, 0.04, 0],
    });
    b.add('bulb', { parent: 'head', shape: { type: 'sphere', radius: 0.19, widthSegments: 16, heightSegments: 12 }, material: 'light', position: [0, 0.25, 0] });
    b.add('finial', {
      parent: 'head',
      shape: { type: 'cone', radius: 0.04, height: 0.08, radialSegments: 8 },
      material: 'iron',
      position: [0, 0.47, 0],
    });
  }

  return {
    name: 'Lampadaire',
    builder: b,
    root,
    animations: {
      flicker: () =>
        animation('flicker', 1.6, [
          keyframes('bulb', 'scale', [
            [0, [1, 1, 1]],
            [0.2, [0.97, 0.97, 0.97]],
            [0.3, [1.03, 1.03, 1.03]],
            [0.55, [0.9, 0.9, 0.9]],
            [0.62, [1.02, 1.02, 1.02]],
            [0.9, [0.98, 0.98, 0.98]],
            [1.15, [1.04, 1.04, 1.04]],
            [1.3, [0.94, 0.94, 0.94]],
            [1.6, [1, 1, 1]],
          ]),
        ]),
    },
  };
};

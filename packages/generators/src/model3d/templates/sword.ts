import { ModelBuilder } from '../builder';
import { jitter } from '../color';
import type { TemplateFn } from './types';

/** Épée dressée, pommeau au sol : lame biseautée extrudée, garde, poignée cerclée, gemme émissive. */
export const sword: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const bladeL = rng.float(0.6, 0.85);
  const bladeW = rng.float(0.075, 0.1);
  const gem = color ?? rng.pick(['#e0314b', '#2f7fe0', '#2fbf71', '#a347e0']);
  b.material('steel', jitter('#c9d1d9', rng, 0.3), { metalness: 0.9, roughness: 0.22 });
  b.material('steel_dark', '#8e98a3', { metalness: 0.9, roughness: 0.35 });
  b.material('guard', rng.bool(0.6) ? '#c9a227' : '#7b8088', { metalness: 0.85, roughness: 0.3 });
  b.material('grip', jitter(rng.pick(['#5b3a29', '#3d2b4f', '#2f3b2f']), rng), { roughness: 0.8 });
  b.material('gem', gem, { emissive: gem, roughness: 0.15 });

  const root = b.group('root');
  b.add('pommel', { parent: root, shape: { type: 'sphere', radius: 0.045, widthSegments: 12, heightSegments: 8 }, material: 'guard', position: [0, 0.045, 0] });
  b.add('grip', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.026, radiusBottom: 0.03, height: 0.2, radialSegments: 10 },
    material: 'grip',
    position: [0, 0.19, 0],
  });
  for (let i = 0; i < 3; i++) {
    b.add(`wrap_${i}`, {
      parent: root,
      shape: { type: 'torus', radius: 0.03, tube: 0.008 },
      material: 'guard',
      position: [0, 0.12 + i * 0.07, 0],
      rotation: [90, 0, 0],
    });
  }
  const guardY = 0.315;
  const guardW = rng.float(0.26, 0.34);
  b.add('crossguard', { parent: root, shape: { type: 'box', size: [guardW, 0.05, 0.07] }, material: 'guard', position: [0, guardY, 0] });
  for (const side of [-1, 1]) {
    b.add(`guard_end_${side < 0 ? 'l' : 'r'}`, {
      parent: root,
      shape: { type: 'sphere', radius: 0.035, widthSegments: 10, heightSegments: 8 },
      material: 'guard',
      position: [(side * guardW) / 2, guardY, 0],
    });
  }
  b.add('gem', { parent: root, shape: { type: 'icosahedron', radius: 0.03 }, material: 'gem', position: [0, guardY, 0.04] });
  const half = bladeW / 2;
  b.add('blade', {
    parent: root,
    shape: {
      type: 'extrude',
      points: [
        [-half, 0],
        [half, 0],
        [half * 0.85, bladeL * 0.85],
        [0, bladeL],
        [-half * 0.85, bladeL * 0.85],
      ],
      depth: 0.016,
      bevel: true,
    },
    material: 'steel',
    position: [0, guardY + 0.025, 0],
  });
  b.add('fuller', {
    parent: root,
    shape: { type: 'box', size: [bladeW * 0.18, bladeL * 0.65, 0.026] },
    material: 'steel_dark',
    position: [0, guardY + 0.05 + bladeL * 0.33, 0],
  });
  return { name: 'Épée', builder: b, root, animations: {} };
};

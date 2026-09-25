import { ModelBuilder } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Section de barrière de 2 m : poteaux à chapeau pyramidal et lisses, ou palissade à piquets pointus. */
export const fence: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const picket = rng.bool(0.5);
  const wood =
    color ?? (picket && rng.bool(0.5) ? '#f2efe6' : jitter(rng.pick(['#9c6b3c', '#8a6a4a', '#b08050']), rng));
  b.material('wood', wood, { roughness: 0.9 });
  b.material('wood_dark', shade(wood, -0.08), { roughness: 0.9 });
  const root = b.group('root');
  const length = 2;
  const postH = picket ? 0.75 : rng.float(0.85, 1);

  for (const [i, x] of [-length / 2, 0, length / 2].entries()) {
    b.add(`post_${i}`, {
      parent: root,
      shape: { type: 'box', size: [0.12, postH, 0.12] },
      material: 'wood_dark',
      position: [x, postH / 2, 0],
    });
    b.add(`post_cap_${i}`, {
      parent: root,
      shape: { type: 'cone', radius: 0.085, height: 0.12, radialSegments: 4 },
      material: 'wood_dark',
      position: [x, postH + 0.06, 0],
      rotation: [0, 45, 0],
    });
  }
  const rails = picket ? [0.2, postH - 0.2] : [postH * 0.33, postH * 0.75];
  rails.forEach((y, i) => {
    b.add(`rail_${i}`, {
      parent: root,
      shape: { type: 'box', size: [length + 0.1, 0.1, 0.05] },
      material: 'wood',
      position: [0, y, picket ? -0.035 : 0.075],
      rotation: [0, 0, rng.float(-1.2, 1.2)],
    });
  });
  if (picket) {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const x = -0.88 + (1.76 * i) / (count - 1);
      const h = 0.78 + rng.float(-0.03, 0.03);
      b.add(`picket_${i}`, {
        parent: root,
        shape: { type: 'box', size: [0.11, h, 0.03] },
        material: 'wood',
        position: [x, h / 2, 0.02],
      });
      b.add(`picket_tip_${i}`, {
        parent: root,
        shape: { type: 'cone', radius: 0.078, height: 0.1, radialSegments: 4 },
        material: 'wood',
        position: [x, h + 0.05, 0.02],
        rotation: [0, 45, 0],
        scale: [1, 1, 0.27],
      });
    }
  }
  return { name: picket ? 'Palissade' : 'Barrière', builder: b, root, animations: {} };
};

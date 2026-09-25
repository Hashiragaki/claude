import { animation, oscillate } from '../anim';
import { ModelBuilder } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Arbre feuillu (bouquets d'icosaèdres) ou sapin (cônes empilés) ; animation `sway`. */
export const tree: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const pine = rng.bool(0.4);
  const trunkH = rng.float(0.9, 1.25) * (pine ? 0.8 : 1);
  const trunkR = rng.float(0.12, 0.16);
  const leaf = color ?? jitter(pine ? '#2f7d4f' : rng.pick(['#5caa4a', '#6dbb55', '#4f9e45', '#8cbf3f']), rng);
  b.material('bark', jitter('#7a4e2d', rng), { roughness: 0.95 });
  b.material('leaves', leaf, { flatShading: true, roughness: 0.9 });
  b.material('leaves_light', shade(leaf, 0.07), { flatShading: true, roughness: 0.9 });

  const root = b.group('root');
  b.group('trunk_pivot', root);
  b.add('trunk', {
    parent: 'trunk_pivot',
    shape: { type: 'cylinder', radiusTop: trunkR * 0.7, radiusBottom: trunkR, height: trunkH, radialSegments: 7 },
    material: 'bark',
    position: [0, trunkH / 2, 0],
  });

  if (pine) {
    b.group('crown', 'trunk_pivot', [0, trunkH * 0.55, 0]);
    const layers = rng.int(3, 4);
    let y = 0;
    for (let i = 0; i < layers; i++) {
      const radius = 0.95 * (1 - i / (layers + 0.6));
      const height = 0.8 - i * 0.08;
      b.add(`leaves_${i}`, {
        parent: 'crown',
        shape: { type: 'cone', radius, height, radialSegments: 8 },
        material: i % 2 ? 'leaves_light' : 'leaves',
        position: [0, y + height / 2, 0],
        rotation: [0, rng.float(0, 45), 0],
      });
      y += height * 0.55;
    }
  } else {
    b.group('crown', 'trunk_pivot', [0, trunkH, 0]);
    const r = rng.float(0.7, 0.9);
    b.add('leaves_main', {
      parent: 'crown',
      shape: { type: 'icosahedron', radius: r, detail: 1 },
      material: 'leaves',
      position: [0, r * 0.7, 0],
      scale: [1, 0.88, 1],
    });
    const blobs = rng.int(3, 4);
    for (let k = 0; k < blobs; k++) {
      const angle = (k / blobs) * Math.PI * 2 + rng.float(-0.3, 0.3);
      b.add(`leaves_${k}`, {
        parent: 'crown',
        shape: { type: 'icosahedron', radius: r * rng.float(0.5, 0.62), detail: 1 },
        material: k % 2 ? 'leaves' : 'leaves_light',
        position: [Math.cos(angle) * r * 0.62, r * rng.float(0.45, 0.85), Math.sin(angle) * r * 0.62],
      });
    }
    b.add('leaves_top', {
      parent: 'crown',
      shape: { type: 'icosahedron', radius: r * 0.5, detail: 1 },
      material: 'leaves_light',
      position: [rng.float(-0.1, 0.1), r * 1.35, rng.float(-0.1, 0.1)],
    });
    if (rng.bool(0.35)) addFruits(b, rng.int(4, 6), r, rng.float(0, Math.PI));
  }

  return {
    name: pine ? 'Sapin' : 'Arbre',
    builder: b,
    root,
    animations: {
      sway: () =>
        animation('sway', 3, [
          oscillate('trunk_pivot', 'rotation', [0, 0, 0], [1.2, 0, 2.2], 3),
          oscillate('crown', 'rotation', [0, 0, 0], [1.5, 0, 3], 3, { phase: -0.6 }),
        ]),
    },
  };
};

/** Petits fruits rouges répartis sur la couronne principale. */
function addFruits(b: ModelBuilder, count: number, r: number, offset: number): void {
  b.material('fruit', '#d94436', { roughness: 0.5 });
  for (let i = 0; i < count; i++) {
    const angle = offset + (i / count) * Math.PI * 2;
    const tilt = 0.5 + 0.35 * Math.sin(i * 2.3);
    const dir = [Math.cos(angle) * Math.sin(tilt), Math.cos(tilt), Math.sin(angle) * Math.sin(tilt)];
    b.add(`fruit_${i}`, {
      parent: 'crown',
      shape: { type: 'sphere', radius: 0.07, widthSegments: 8, heightSegments: 6 },
      material: 'fruit',
      position: [dir[0] * r * 0.98, r * 0.7 + dir[1] * r * 0.88 * 0.98, dir[2] * r * 0.98],
    });
  }
}

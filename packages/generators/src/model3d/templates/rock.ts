import { ModelBuilder } from '../builder';
import { modelBounds } from '../bounds';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Amas de rochers facettés (icosaèdres déformés), parfois couverts de mousse. */
export const rock: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const stone = color ?? jitter(rng.pick(['#8a8f98', '#9a8f84', '#7d848c', '#a09a90']), rng);
  b.material('stone', stone, { flatShading: true, roughness: 0.95 });
  b.material('stone_light', shade(stone, 0.07), { flatShading: true, roughness: 0.95 });
  b.material('stone_dark', shade(stone, -0.07), { flatShading: true, roughness: 0.95 });

  const root = b.group('root');
  const r = rng.float(0.5, 0.7);
  // Bloc principal : deux icosaèdres bruts imbriqués, tournés différemment, pour une silhouette irrégulière.
  b.add('rock_main', {
    parent: root,
    shape: { type: 'icosahedron', radius: r, detail: 0 },
    material: 'stone',
    position: [0, r * 0.58, 0],
    rotation: [rng.float(0, 40), rng.float(0, 360), rng.float(0, 30)],
    scale: [rng.float(1.1, 1.3), rng.float(0.75, 0.9), rng.float(0.95, 1.1)],
  });
  b.add('rock_main_b', {
    parent: root,
    shape: { type: 'icosahedron', radius: r * 0.9, detail: 0 },
    material: 'stone',
    position: [r * rng.float(-0.25, 0.25), r * 0.55, r * rng.float(-0.2, 0.2)],
    rotation: [rng.float(20, 70), rng.float(0, 360), rng.float(20, 60)],
    scale: [rng.float(1.05, 1.25), rng.float(0.7, 0.85), rng.float(0.95, 1.1)],
  });
  const count = rng.int(2, 4);
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const dist = r * rng.float(0.9, 1.15);
    const size = r * rng.float(0.32, 0.55);
    b.add(`rock_${k}`, {
      parent: root,
      shape: { type: 'icosahedron', radius: size, detail: rng.bool(0.25) ? 1 : 0 },
      material: k % 2 ? 'stone_light' : 'stone_dark',
      position: [Math.cos(angle) * dist, size * 0.5, Math.sin(angle) * dist],
      rotation: [rng.float(0, 40), rng.float(0, 360), rng.float(0, 40)],
      scale: [rng.float(0.9, 1.3), rng.float(0.6, 0.9), rng.float(0.9, 1.2)],
    });
  }
  if (rng.bool(0.4)) {
    b.material('moss', jitter('#6a9a4a', rng), { flatShading: true, roughness: 1 });
    b.add('moss', {
      parent: root,
      shape: { type: 'icosahedron', radius: r * 0.68, detail: 1 },
      material: 'moss',
      position: [rng.float(-0.05, 0.05), r * 1.2, rng.float(-0.05, 0.05)],
      scale: [1.2, 0.28, 1.05],
    });
  }
  // Pose l'amas au sol : le point le plus bas, légèrement enfoncé (2 cm), passe à y = 0.
  const lowest = modelBounds(b).min[1] + 0.02;
  for (const node of b.nodes) {
    if (node.parent === root && node.position) node.position[1] -= lowest;
  }
  return { name: 'Rocher', builder: b, root, animations: {} };
};

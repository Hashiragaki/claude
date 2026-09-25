import { ModelBuilder, type Vec3 } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Caisse en bois : panneau central, cadre de 12 planches et croisillons sur les quatre faces. */
export const crate: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const s = rng.float(0.9, 1.1);
  const beam = s * rng.float(0.11, 0.13);
  const wood = color ?? jitter(rng.pick(['#b07a45', '#c08a52', '#9c6a3a']), rng);
  b.material('panel', shade(wood, 0.05), { roughness: 0.9 });
  b.material('plank', shade(wood, -0.1), { roughness: 0.9 });

  const root = b.group('root');
  const inner = s - beam * 0.6;
  b.add('body', {
    parent: root,
    shape: { type: 'box', size: [inner, inner, inner] },
    material: 'panel',
    position: [0, s / 2, 0],
  });

  const edge = s / 2 - beam / 2;
  const add = (id: string, size: Vec3, position: Vec3, rotation?: Vec3) =>
    b.add(id, { parent: root, shape: { type: 'box', size }, material: 'plank', position, rotation });
  let n = 0;
  for (const y of [beam / 2, s - beam / 2]) {
    for (const o of [-edge, edge]) {
      add(`edge_${n++}`, [s, beam, beam], [0, y, o]);
      add(`edge_${n++}`, [beam, beam, s], [o, y, 0]);
    }
  }
  for (const x of [-edge, edge]) for (const z of [-edge, edge]) add(`edge_${n++}`, [beam, s, beam], [x, s / 2, z]);

  // Croisillons diagonaux, affleurant le cadre.
  const diagonal = (s - 2 * beam) * Math.SQRT2 * 0.98;
  const face = s / 2 - beam * 0.25;
  const size: Vec3 = [diagonal, beam * 0.9, beam * 0.5];
  add('brace_front', size, [0, s / 2, face], [0, 0, 45]);
  add('brace_back', size, [0, s / 2, -face], [0, 0, -45]);
  add('brace_right', size, [face, s / 2, 0], [0, 90, 45]);
  add('brace_left', size, [-face, s / 2, 0], [0, 90, -45]);

  return { name: 'Caisse', builder: b, root, animations: {} };
};

import { animation, oscillate } from '../anim';
import { ModelBuilder } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Tour de pierre : donjon crénelé ou tour de mage à toit conique, porte, fenêtres, drapeau (`flag`). */
export const tower: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const radius = rng.float(0.9, 1.1);
  const height = rng.float(3.2, 3.9);
  const roofed = rng.bool(0.5);
  const stone = jitter(rng.pick(['#9a958c', '#8c8f96', '#a39583']), rng, 0.6);
  b.material('stone', stone, { flatShading: true, roughness: 0.95 });
  b.material('stone_dark', shade(stone, -0.1), { flatShading: true, roughness: 0.95 });
  b.material('roof', color ?? jitter(rng.pick(['#b0413e', '#3d5a80', '#5b4a8a']), rng), { flatShading: true, roughness: 0.8 });
  b.material('wood', jitter('#6b4a2f', rng));
  b.material('dark', '#1f1c1a', { roughness: 1 });
  b.material('flag', color ?? jitter(rng.pick(['#d64545', '#e2b33c', '#3f7fbf']), rng), { roughness: 0.9 });

  const root = b.group('root');
  // Prismes à 10 pans tournés de 18° : une face plane (et non une arête) regarde +Z.
  const sides = 10;
  const faceTurn: [number, number, number] = [0, 180 / sides, 0];
  const faceRatio = Math.cos(Math.PI / sides);
  const cyl = (r1: number, r2: number, h: number) =>
    ({ type: 'cylinder', radiusTop: r1, radiusBottom: r2, height: h, radialSegments: sides }) as const;
  b.add('plinth', {
    parent: root,
    shape: cyl(radius * 1.12, radius * 1.18, 0.4),
    material: 'stone_dark',
    position: [0, 0.2, 0],
    rotation: faceTurn,
  });
  b.add('body', {
    parent: root,
    shape: cyl(radius * 0.92, radius, height),
    material: 'stone',
    position: [0, 0.4 + height / 2, 0],
    rotation: faceTurn,
  });
  const top = 0.4 + height;
  b.add('parapet', {
    parent: root,
    shape: cyl(radius * 1.12, radius * 1.02, 0.35),
    material: 'stone_dark',
    position: [0, top + 0.175, 0],
    rotation: faceTurn,
  });
  /** Distance du centre à la face du corps à la hauteur `y`. */
  const faceAt = (y: number) => radius * (1 - 0.08 * ((y - 0.4) / height)) * faceRatio;

  let flagBase: number;
  if (roofed) {
    const roofH = rng.float(1.5, 1.9);
    b.add('roof', {
      parent: root,
      shape: { type: 'cone', radius: radius * 1.28, height: roofH, radialSegments: sides },
      material: 'roof',
      position: [0, top + 0.35 + roofH / 2, 0],
      rotation: faceTurn,
    });
    flagBase = top + 0.35 + roofH - 0.05;
  } else {
    const merlonR = radius * 1.12 * faceRatio - 0.12;
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      b.add(`merlon_${i}`, {
        parent: root,
        shape: { type: 'box', size: [0.3, 0.32, 0.22] },
        material: 'stone',
        position: [Math.sin(angle) * merlonR, top + 0.51, Math.cos(angle) * merlonR],
        rotation: [0, (angle * 180) / Math.PI, 0],
      });
    }
    flagBase = top + 0.35;
  }

  // Porte cintrée (disque derrière le haut de la porte) et fenêtres étroites.
  const doorZ = faceAt(0.9);
  b.add('door', { parent: root, shape: { type: 'box', size: [0.6, 0.95, 0.12] }, material: 'wood', position: [0, 0.4 + 0.475, doorZ] });
  b.add('door_arch', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.3, radiusBottom: 0.3, height: 0.12, radialSegments: 12 },
    material: 'wood',
    position: [0, 0.4 + 0.95, doorZ - 0.005],
    rotation: [90, 0, 0],
  });
  // Fenêtres étroites, centrées sur des faces du prisme.
  const faces = rng.shuffle([-3, -2, -1, 1, 2, 3, 5]);
  const windows = rng.int(3, 4);
  for (let i = 0; i < windows; i++) {
    const angle = (faces[i] / sides) * Math.PI * 2;
    const y = 0.4 + height * (0.45 + (0.4 * i) / windows);
    const r = faceAt(y) + 0.02;
    b.add(`window_${i}`, {
      parent: root,
      shape: { type: 'box', size: [0.2, 0.42, 0.12] },
      material: 'dark',
      position: [Math.sin(angle) * r, y, Math.cos(angle) * r],
      rotation: [0, (angle * 180) / Math.PI, 0],
    });
  }

  b.add('flagpole', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.025, radiusBottom: 0.03, height: 1.1, radialSegments: 6 },
    material: 'wood',
    position: [0, flagBase + 0.55, 0],
  });
  b.group('flag_pivot', root, [0, flagBase + 0.9, 0]);
  b.add('flag', { parent: 'flag_pivot', shape: { type: 'box', size: [0.55, 0.32, 0.02] }, material: 'flag', position: [0.29, 0, 0] });

  return {
    name: roofed ? 'Tour de mage' : 'Donjon',
    builder: b,
    root,
    animations: {
      flag: () =>
        animation('flag', 1.4, [
          oscillate('flag_pivot', 'rotation', [0, 0, 0], [0, 18, 3], 1.4),
          oscillate('flag', 'scale', [1, 1, 1], [0.05, 0, 0], 1.4, { cycles: 2 }),
        ]),
    },
  };
};

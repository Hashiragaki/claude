import type { Rng } from '@forge/core';
import { animation, oscillate } from '../anim';
import { alignYTo, ModelBuilder, type Vec3 } from '../builder';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Champignon à chapeau tacheté (parfois accompagné de petits) ; animation `wobble`. */
export const mushroom: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const cap = color ?? jitter(rng.pick(['#d63c32', '#d63c32', '#8e5ac8', '#c7802f', '#3f8fd6']), rng);
  b.material('cap', cap, { roughness: 0.55 });
  b.material('spots', '#fbf6ea', { roughness: 0.7 });
  b.material('stem', jitter('#f3ead7', rng, 0.5), { roughness: 0.85 });
  b.material('gills', shade('#e8d8bf', -0.05), { roughness: 0.9 });
  const root = b.group('root');
  addMushroom(b, rng, 'main', root, [0, 0, 0], 1);
  if (rng.bool(0.5)) {
    addMushroom(b, rng, 'small_a', root, [0.5, 0, 0.25], rng.float(0.4, 0.55));
    if (rng.bool(0.6)) addMushroom(b, rng, 'small_b', root, [-0.35, 0, 0.45], rng.float(0.3, 0.42));
  }
  return {
    name: 'Champignon',
    builder: b,
    root,
    animations: {
      wobble: () =>
        animation('wobble', 1.6, [
          oscillate('main_cap_pivot', 'rotation', [0, 0, 0], [3, 0, 5], 1.6),
          oscillate('main', 'scale', [1, 1, 1], [0.02, -0.03, 0.02], 1.6, { cycles: 2 }),
        ]),
    },
  };
};

function addMushroom(b: ModelBuilder, rng: Rng, id: string, parent: string, position: Vec3, size: number): void {
  const stemH = rng.float(0.5, 0.65);
  const rx = rng.float(0.52, 0.66);
  const ry = rng.float(0.34, 0.46);
  b.add(id, { parent, position, rotation: [0, rng.float(0, 360), 0], scale: [size, size, size] });
  b.add(`${id}_stem`, {
    parent: id,
    shape: {
      type: 'lathe',
      points: [
        [0, 0],
        [0.17, 0],
        [0.19, 0.06],
        [0.16, stemH * 0.45],
        [0.13, stemH * 0.85],
        [0.15, stemH],
        [0, stemH],
      ],
      segments: 14,
    },
    material: 'stem',
  });
  b.group(`${id}_cap_pivot`, id, [0, stemH - 0.04, 0]);
  // Dôme elliptique (profil du lathe) + dessous clair ; les taches suivent exactement la surface.
  const dome: number[][] = [];
  for (let i = 0; i <= 8; i++) {
    const phi = (Math.PI / 2) * (1 - i / 8);
    dome.push([rx * Math.sin(phi), 0.02 + ry * Math.cos(phi)]);
  }
  b.add(`${id}_cap`, { parent: `${id}_cap_pivot`, shape: { type: 'lathe', points: dome, segments: 16 }, material: 'cap' });
  b.add(`${id}_gills`, {
    parent: `${id}_cap_pivot`,
    shape: { type: 'cylinder', radiusTop: rx * 0.97, radiusBottom: 0.16, height: 0.06, radialSegments: 16 },
    material: 'gills',
    position: [0, -0.01, 0],
  });
  const spots = rng.int(5, 8);
  for (let s = 0; s < spots; s++) {
    const phi = rng.float(0.25, 1.15);
    const theta = (s / spots) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const p: Vec3 = [rx * Math.sin(phi) * Math.cos(theta), 0.02 + ry * Math.cos(phi), rx * Math.sin(phi) * Math.sin(theta)];
    const n = normalize([(Math.sin(phi) * Math.cos(theta)) / rx, Math.cos(phi) / ry, (Math.sin(phi) * Math.sin(theta)) / rx]);
    const radius = rng.float(0.05, 0.085);
    b.add(`${id}_spot_${s}`, {
      parent: `${id}_cap_pivot`,
      shape: { type: 'sphere', radius, widthSegments: 10, heightSegments: 6 },
      material: 'spots',
      position: p,
      rotation: alignYTo(n),
      scale: [1, 0.3, 1],
    });
  }
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

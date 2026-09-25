import type { Rng } from '@forge/core';
import { animation } from '../anim';
import { ModelBuilder, type Vec3 } from '../builder';
import type { KeySpec, TrackSpec } from '../dsl';
import { jitter, shade } from '../color';
import type { TemplateFn } from './types';

/** Maisonnette : soubassement, murs, pignon extrudé, toit à deux pans, porte, fenêtres, cheminée. */
export const house: TemplateFn = ({ rng, color }) => {
  const b = new ModelBuilder();
  const w = rng.float(2.1, 2.5);
  const d = rng.float(1.8, 2.1);
  const h = rng.float(1.45, 1.7);
  const roofH = rng.float(0.95, 1.2);
  const overhang = 0.16;
  const base = 0.2;
  const top = base + h;
  const lit = rng.bool(0.4);
  b.material('walls', jitter(rng.pick(['#f1e3c6', '#f4efe6', '#e9d3a8', '#dfe8ee']), rng, 0.5));
  b.material('roof', color ?? jitter(rng.pick(['#c4553a', '#4a6fa5', '#5d8a4e', '#8e5a3c']), rng), { roughness: 0.85 });
  b.material('trim', jitter('#6b4a2f', rng, 0.5));
  b.material('door', jitter('#8a5a35', rng));
  b.material('stone', jitter('#8d8a86', rng, 0.5), { flatShading: true });
  b.material('brick', jitter('#9e5b45', rng));
  b.material('gold', '#d4af37', { metalness: 0.8, roughness: 0.35 });
  b.material('glass', lit ? '#ffe6a8' : '#9fd3f0', lit ? { emissive: '#ffb347', roughness: 0.3 } : { roughness: 0.2 });

  const root = b.group('root');
  b.add('foundation', { parent: root, shape: { type: 'box', size: [w + 0.12, base, d + 0.12] }, material: 'stone', position: [0, base / 2, 0] });
  b.add('walls', { parent: root, shape: { type: 'box', size: [w, h, d] }, material: 'walls', position: [0, base + h / 2, 0] });
  b.add('gable', {
    parent: root,
    shape: { type: 'extrude', points: [[-w / 2, 0], [w / 2, 0], [0, roofH * 0.96]], depth: d },
    material: 'walls',
    position: [0, top, 0],
  });

  // Deux pans de toit posés sur les pentes du pignon, avec débord.
  const slope = Math.atan2(roofH, w / 2);
  const eaveX = w / 2 + overhang;
  const length = eaveX / Math.cos(slope) + 0.02;
  const thickness = 0.1;
  const midX = eaveX / 2;
  const midY = (roofH - overhang * Math.tan(slope)) / 2;
  for (const side of [-1, 1]) {
    b.add(side < 0 ? 'roof_left' : 'roof_right', {
      parent: root,
      shape: { type: 'box', size: [length, thickness, d + 2 * overhang] },
      material: 'roof',
      position: [side * (midX + (Math.sin(slope) * thickness) / 2), top + midY + (Math.cos(slope) * thickness) / 2, 0],
      rotation: [0, 0, (-side * slope * 180) / Math.PI],
    });
  }
  b.add('ridge', {
    parent: root,
    shape: { type: 'cylinder', radiusTop: 0.07, radiusBottom: 0.07, height: d + 2 * overhang + 0.04, radialSegments: 8 },
    material: 'trim',
    position: [0, top + roofH + thickness * 0.6, 0],
    rotation: [90, 0, 0],
  });
  const chimneyX = w * 0.25;
  const chimneyTop = top + roofH * 0.5 + 0.7;
  b.add('chimney', { parent: root, shape: { type: 'box', size: [0.32, 0.9, 0.32] }, material: 'brick', position: [chimneyX, chimneyTop - 0.45, -d * 0.2] });
  b.add('chimney_cap', { parent: root, shape: { type: 'box', size: [0.4, 0.08, 0.4] }, material: 'stone', position: [chimneyX, chimneyTop + 0.04, -d * 0.2] });

  // Façade : porte, marche, fenêtres.
  const doorX = rng.bool(0.5) ? 0 : -w * 0.22;
  const front = d / 2;
  b.add('door_frame', { parent: root, shape: { type: 'box', size: [0.67, 1.08, 0.04] }, material: 'trim', position: [doorX, base + 0.54, front + 0.015] });
  b.add('door', { parent: root, shape: { type: 'box', size: [0.55, 1.0, 0.06] }, material: 'door', position: [doorX, base + 0.5, front + 0.03] });
  b.add('door_knob', {
    parent: root,
    shape: { type: 'sphere', radius: 0.035, widthSegments: 8, heightSegments: 6 },
    material: 'gold',
    position: [doorX + 0.18, base + 0.5, front + 0.08],
  });
  b.add('step', { parent: root, shape: { type: 'box', size: [0.8, 0.12, 0.35] }, material: 'stone', position: [doorX, 0.06, front + 0.2] });
  const windowY = base + h * 0.58;
  const frontWindows = doorX === 0 ? [-w * 0.3, w * 0.3] : [w * 0.22];
  frontWindows.forEach((x, i) => addWindow(b, `window_front_${i}`, root, [x, windowY, front + 0.025], 0));
  addWindow(b, 'window_right', root, [w / 2 + 0.025, windowY, 0], 90);
  addWindow(b, 'window_left', root, [-w / 2 - 0.025, windowY, 0], -90);

  return {
    name: 'Maison',
    builder: b,
    root,
    animations: { smoke: (builder) => smokeAnimation(builder, rng, [chimneyX, chimneyTop + 0.1, -d * 0.2]) },
  };
};

function addWindow(b: ModelBuilder, id: string, parent: string, position: Vec3, rotationY: number): void {
  b.group(id, parent, position, [0, rotationY, 0]);
  b.add(`${id}_frame`, { parent: id, shape: { type: 'box', size: [0.55, 0.55, 0.05] }, material: 'trim' });
  b.add(`${id}_glass`, { parent: id, shape: { type: 'box', size: [0.42, 0.42, 0.06] }, material: 'glass' });
  b.add(`${id}_bar_h`, { parent: id, shape: { type: 'box', size: [0.42, 0.04, 0.07] }, material: 'trim' });
  b.add(`${id}_bar_v`, { parent: id, shape: { type: 'box', size: [0.04, 0.42, 0.07] }, material: 'trim' });
}

/** Trois bouffées de fumée qui montent en grossissant puis disparaissent, décalées dans le temps. */
function smokeAnimation(b: ModelBuilder, rng: Rng, origin: Vec3) {
  const duration = 3;
  b.material('smoke', '#e4e4e4', { opacity: 0.75, roughness: 1 });
  const tracks: TrackSpec[] = [];
  for (let k = 0; k < 3; k++) {
    const id = `smoke_${k}`;
    b.add(id, {
      parent: 'root',
      shape: { type: 'icosahedron', radius: 0.16, detail: 1 },
      material: 'smoke',
      position: origin,
      scale: [0.001, 0.001, 0.001],
    });
    const offset = k / 3;
    const wrap = duration * (1 - offset);
    const times = new Set<number>([0, duration, ...Array.from({ length: 12 }, (_, i) => (duration * i) / 12)]);
    [wrap - 0.001, wrap + 0.001].filter((t) => t <= duration).forEach((t) => times.add(t));
    const sorted = [...times].sort((a, x) => a - x);
    const drift = rng.float(-0.15, 0.15);
    const at = (t: number) => (t / duration + offset) % 1;
    const pos: KeySpec[] = [];
    const scale: KeySpec[] = [];
    for (const t of sorted) {
      const u = Math.abs(t - wrap) < 0.0011 ? (t < wrap ? 0.999 : 0) : at(t);
      const s = Math.max(0.001, Math.sin(Math.PI * u) * (0.6 + u));
      pos.push({ t, value: [origin[0] + drift * u, origin[1] + u * 1.2, origin[2]] });
      scale.push({ t, value: [s, s, s] });
    }
    tracks.push({ node: id, property: 'position', keys: pos }, { node: id, property: 'scale', keys: scale });
  }
  return animation('smoke', duration, tracks);
}

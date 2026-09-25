import type { Rng } from '@forge/core';
import { z } from 'zod';
import type { GeneratorDefinition, GeneratorResult } from '../types';
import { GENERIC_ANIMATIONS, normalizeAnimationNames } from './anim';
import { buildModel } from './build';
import { MAX_NODES, MAX_SEGMENTS, model3dSpecSchema, type Model3dSpec } from './dsl';
import { MODEL_TEMPLATES, resolveTemplate } from './templates';

export const MODEL_TEMPLATE_OPTIONS = [
  'auto',
  'tree',
  'rock',
  'house',
  'crate',
  'character',
  'chest',
  'lamp',
  'tower',
  'fence',
  'mushroom',
  'sword',
  'well',
] as const;

export const model3dParamsSchema = z.object({
  prompt: z.string().default('').describe('Description libre du modèle (ex. « petite maison au toit bleu »)'),
  template: z
    .enum(MODEL_TEMPLATE_OPTIONS)
    .default('auto')
    .describe('Modèle de base ; « auto » le déduit de la description ou de la graine'),
  animations: z
    .array(z.string().min(1).max(40))
    .max(16)
    .default([])
    .describe('Animations souhaitées (ex. idle, walk, wave, open, sway, spin, bob)'),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Couleur hexadécimale attendue, ex. « #3f7fbf »')
    .optional()
    .describe('Couleur principale'),
});
export type Model3dParams = z.infer<typeof model3dParamsSchema>;

const SYSTEM_PROMPT = `You build charming low-poly 3D models for the Forge game engine. You answer with a JSON "spec" (a small
DSL) that is converted to an animated binary glTF (GLB).

Spec: { name, materials, nodes, animations? }
- materials: { "<id>": { color: "#rrggbb", metalness? (0-1, default 0), roughness? (0-1, default 0.8),
  emissive?: "#rrggbb" (self-lit parts: lamps, gems, lit windows), opacity? (0.05-1; < 1 = glass, water),
  flatShading?: true (faceted low-poly look) } }
- nodes (1-${MAX_NODES}): { id (unique), parent? (id of another node; omitted = root), shape?, material? (a key of
  materials), position? [x,y,z], rotation? [x,y,z] in degrees (Euler XYZ), scale? [x,y,z] }. Transforms are relative
  to the parent. A node without shape is an empty group / pivot.
- shape (centered on the node origin; segments are optional, 3-${MAX_SEGMENTS}):
  box { size: [w,h,d] } | sphere { radius, widthSegments?, heightSegments? }
  | cylinder { radiusTop, radiusBottom, height, radialSegments? } (axis Y) | cone { radius, height, radialSegments? }
  (axis Y, apex up; radialSegments 4 = pyramid) | torus { radius, tube } (ring in the XY plane; rotate [90,0,0] to
  lay it flat) | capsule { radius, length } (axis Y, total height = length + 2*radius) | plane { size: [w,h] } (XY
  plane facing +Z; rotate [-90,0,0] for a floor) | lathe { points: [[radius,y],...], segments? } (profile revolved
  around Y; radius >= 0; great for vases, domes, bottles, stems) | extrude { points: [[x,y],...], depth, bevel? }
  (polygon in XY extruded along Z and centered in depth; rotate [0,90,0] to extrude along X; roofs, blades, signs)
  | icosahedron { radius, detail? 0-3 } (faceted; rocks, foliage, gems).
- animations: [{ name, duration (s), loop? (default true), tracks: [{ node, property: "position" | "rotation" |
  "scale", interpolation?: "linear" | "step", keys: [{ t, value: [x,y,z] }] }] }]
  Values are absolute: they replace the node's own position/rotation/scale (keep its base values, e.g. its height).
  Rotation keys are in degrees; consecutive keys must differ by less than 180 degrees (a full spin: 0, 90, 180, 270,
  360). Key times are strictly increasing and within [0, duration]; for loops, make the last key equal the first.

Conventions: Y is up, units are meters, the model stands on y = 0 (lowest point at 0), its front faces +Z. Realistic
scales: character 1.2-1.8 m, door 1 m, house 3-4 m tall, tree 2-4 m, crate 1 m, sword 1 m, small props 0.2-0.6 m.

Rigging: put an empty pivot node where each joint is (shoulder, hip, neck, hinge, trunk base) and offset the visible
parts from it, then animate the pivot. Blocky humanoid: root -> hips (group at leg height) -> torso box and a chest
group -> head group, arm_l / arm_r groups at the shoulders (arm box offset downwards), leg_l / leg_r groups at the
hips. The character's left side is +X. Chest lid: hinge group on the back top edge, lid offset from it.

Art direction: readable silhouettes, chunky friendly proportions, simple shapes, 3-7 harmonious colors
(avoid pure black and white; vary shades between similar parts), small details that add charm (windows, rivets,
spots, eyes). Prefer 6-16 radial segments. Keep the node count reasonable (10-80 typically).

Example:
{"name":"Mushroom","materials":{"stem":{"color":"#f3ead7"},"cap":{"color":"#d63c32","roughness":0.5},
"spot":{"color":"#fbf6ea"}},"nodes":[{"id":"root"},
{"id":"stem","parent":"root","shape":{"type":"cylinder","radiusTop":0.12,"radiusBottom":0.16,"height":0.5},
"material":"stem","position":[0,0.25,0]},
{"id":"cap_pivot","parent":"root","position":[0,0.48,0]},
{"id":"cap","parent":"cap_pivot","shape":{"type":"lathe","points":[[0.5,0],[0.45,0.18],[0.3,0.32],[0,0.38]]},
"material":"cap"},
{"id":"spot_1","parent":"cap_pivot","shape":{"type":"sphere","radius":0.06},"material":"spot",
"position":[0.2,0.3,0.12],"scale":[1,0.4,1]}],
"animations":[{"name":"wobble","duration":1.6,"tracks":[{"node":"cap_pivot","property":"rotation","keys":[
{"t":0,"value":[0,0,0]},{"t":0.4,"value":[0,0,6]},{"t":1.2,"value":[0,0,-6]},{"t":1.6,"value":[0,0,0]}]}]}]}`;

function describeParams(params: Model3dParams): string {
  const lines: string[] = [];
  if (params.template !== 'auto') lines.push(`Kind of object: ${params.template}.`);
  if (params.color) lines.push(`Main color: ${params.color}.`);
  const animations = normalizeAnimationNames(params.animations);
  if (animations.length) lines.push(`Include these animations, named exactly: ${animations.join(', ')}.`);
  return lines.join('\n');
}

function buildPrompt(params: Model3dParams): string {
  const what = params.prompt.trim() || (params.template !== 'auto' ? `a ${params.template}` : 'a charming game prop');
  const details = describeParams(params);
  return `Model this: ${what}${details ? `\n${details}` : ''}\nReturn the complete spec.`;
}

function buildEditPrompt(spec: Model3dSpec, instruction: string, params: Model3dParams): string {
  const context = params.prompt.trim() ? `Original request: ${params.prompt.trim()}\n` : '';
  const details = describeParams(params);
  return (
    `Current model spec:\n${JSON.stringify(spec)}\n\n${context}${details ? `${details}\n` : ''}\n` +
    `Modify it according to this instruction: ${instruction}\n` +
    'Keep the nodes, materials and animations the instruction does not concern (same ids), and return the complete ' +
    'modified spec.'
  );
}

function procedural(params: Model3dParams, rng: Rng): Model3dSpec {
  const template = resolveTemplate(params.template, params.prompt, rng);
  const model = MODEL_TEMPLATES[template]({ rng: rng.fork(template), color: params.color });
  for (const name of normalizeAnimationNames(params.animations)) {
    const make = model.animations[name];
    if (make) model.builder.animations.push(make(model.builder));
    else if (GENERIC_ANIMATIONS[name]) model.builder.animations.push(GENERIC_ANIMATIONS[name](model.root));
  }
  return model3dSpecSchema.parse(model.builder.toSpec(model.name));
}

async function render(spec: Model3dSpec): Promise<GeneratorResult> {
  const parsed = model3dSpecSchema.parse(spec);
  const built = buildModel(parsed);
  return {
    files: [
      { role: 'main', ext: 'glb', mime: 'model/gltf-binary', data: built.glb },
      { role: 'source', ext: 'json', mime: 'application/json', data: JSON.stringify(parsed, null, 2) },
    ],
    info: { nodes: built.nodes, triangles: built.triangles, animations: built.animations.join(',') },
  };
}

/** Modèles 3D low-poly animés (DSL JSON → GLB). */
export const model3dGenerator: GeneratorDefinition<Model3dParams, Model3dSpec> = {
  id: 'model3d',
  kind: 'model',
  label: 'Modèle 3D',
  description: 'Modèles 3D low-poly (arbres, maisons, personnages, coffres…) avec animations, exportés en GLB.',
  paramsSchema: model3dParamsSchema,
  specSchema: model3dSpecSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt,
  buildEditPrompt,
  procedural,
  render,
};

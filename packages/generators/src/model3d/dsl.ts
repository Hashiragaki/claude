import { z } from 'zod';

/**
 * DSL JSON des modèles 3D : matériaux PBR, hiérarchie de nœuds portant des formes primitives, et
 * animations par images clés. Conventions : Y vers le haut, mètres, modèle posé sur y = 0, face
 * avant vers +Z, rotations en degrés (Euler XYZ).
 */

export const MAX_NODES = 200;
export const MAX_MATERIALS = 32;
export const MAX_SEGMENTS = 64;
export const MAX_ANIMATIONS = 16;

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = (description: string) =>
  z.string().regex(HEX, 'Couleur hexadécimale attendue, ex. « #a0522d »').describe(description);
const length = z.number().min(0.001).max(100);
const segments = (description: string) => z.number().int().min(3).max(MAX_SEGMENTS).optional().describe(description);
const vec3 = (description: string) => z.array(z.number().min(-1000).max(1000)).length(3).describe(description);
const point2 = z.array(z.number().min(-100).max(100)).length(2);

export const materialSchema = z.object({
  color: hex('Couleur de base (sRGB)'),
  metalness: z.number().min(0).max(1).optional().describe('0 = non métallique (défaut), 1 = métal'),
  roughness: z.number().min(0).max(1).optional().describe('0 = lisse et brillant, 1 = mat (défaut 0,8)'),
  emissive: hex('Couleur émise (lumière propre : lampes, gemmes, fenêtres éclairées)').optional(),
  opacity: z.number().min(0.05).max(1).optional().describe('Opacité (< 1 = transparent : verre, eau)'),
  flatShading: z.boolean().optional().describe('Facettes plates (look low-poly)'),
});

export const shapeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('box'), size: z.array(length).length(3).describe('Largeur, hauteur, profondeur') }),
  z.object({
    type: z.literal('sphere'),
    radius: length,
    widthSegments: segments('Segments horizontaux (défaut 16)'),
    heightSegments: segments('Segments verticaux (défaut 12)'),
  }),
  z.object({
    type: z.literal('cylinder'),
    radiusTop: z.number().min(0).max(100),
    radiusBottom: z.number().min(0).max(100),
    height: length,
    radialSegments: segments('Segments autour de l’axe Y (défaut 16)'),
  }),
  z.object({
    type: z.literal('cone'),
    radius: length,
    height: length,
    radialSegments: segments('Segments autour de l’axe Y (défaut 16 ; 4 = pyramide)'),
  }),
  z.object({
    type: z.literal('torus'),
    radius: length.describe('Rayon de l’anneau (plan XY)'),
    tube: length.describe('Rayon du tube'),
  }),
  z.object({
    type: z.literal('capsule'),
    radius: length,
    length: z.number().min(0).max(100).describe('Longueur de la partie droite (hauteur totale = length + 2 × radius)'),
  }),
  z.object({ type: z.literal('plane'), size: z.array(length).length(2).describe('Largeur, hauteur (plan XY, face +Z)') }),
  z.object({
    type: z.literal('lathe'),
    points: z.array(point2).min(2).max(64).describe('Profil [rayon, y] tourné autour de l’axe Y'),
    segments: segments('Segments de révolution (défaut 16)'),
  }),
  z.object({
    type: z.literal('extrude'),
    points: z.array(point2).min(3).max(64).describe('Contour [x, y] dans le plan XY, extrudé selon Z (centré)'),
    depth: length,
    bevel: z.boolean().optional().describe('Arêtes biseautées'),
  }),
  z.object({
    type: z.literal('icosahedron'),
    radius: length,
    detail: z.number().int().min(0).max(3).optional().describe('Subdivision 0–3 (0 = 20 faces, facettes plates)'),
  }),
]);

export const nodeSchema = z.object({
  id: z.string().min(1).max(64).describe('Identifiant unique'),
  parent: z.string().min(1).max(64).optional().describe('Identifiant du nœud parent (sinon racine)'),
  shape: shapeSchema.optional().describe('Forme centrée sur l’origine du nœud (absent = groupe / pivot)'),
  material: z.string().min(1).max(64).optional().describe('Clé dans materials'),
  position: vec3('Position relative au parent (m)').optional(),
  rotation: vec3('Rotation en degrés (Euler XYZ)').optional(),
  scale: vec3('Échelle').optional(),
});

export const keySchema = z.object({
  t: z.number().min(0).max(600).describe('Temps en secondes'),
  value: z.array(z.number().min(-10000).max(10000)).length(3).describe('Valeur absolue (rotation en degrés)'),
});

export const trackSchema = z.object({
  node: z.string().min(1).max(64),
  property: z.enum(['position', 'rotation', 'scale']),
  interpolation: z.enum(['linear', 'step']).optional(),
  keys: z.array(keySchema).min(1).max(240),
});

export const animationSchema = z.object({
  name: z.string().min(1).max(40),
  duration: z.number().min(0.05).max(60).describe('Durée en secondes'),
  loop: z.boolean().optional().describe('Animation en boucle (défaut true)'),
  tracks: z.array(trackSchema).min(1).max(64),
});

export type MaterialSpec = z.infer<typeof materialSchema>;
export type ShapeSpec = z.infer<typeof shapeSchema>;
export type NodeSpec = z.infer<typeof nodeSchema>;
export type KeySpec = z.infer<typeof keySchema>;
export type TrackSpec = z.infer<typeof trackSchema>;
export type AnimationSpec = z.infer<typeof animationSchema>;

interface ModelShape {
  materials: Record<string, MaterialSpec>;
  nodes: NodeSpec[];
  animations?: AnimationSpec[];
}

type Issue = { path: (string | number)[]; message: string };

const list = (ids: Iterable<string>) => {
  const all = [...ids];
  return all.length ? all.slice(0, 12).join(', ') + (all.length > 12 ? '…' : '') : 'aucun';
};

/** Vérifie les références croisées du modèle et renvoie des messages explicites. */
export function validateModel(model: ModelShape): Issue[] {
  const issues: Issue[] = [];
  const materialIds = Object.keys(model.materials);
  if (materialIds.length > MAX_MATERIALS) {
    issues.push({ path: ['materials'], message: `Trop de matériaux (${materialIds.length}, maximum ${MAX_MATERIALS}).` });
  }
  const byId = new Map<string, number>();
  model.nodes.forEach((node, i) => {
    const previous = byId.get(node.id);
    if (previous !== undefined) {
      issues.push({
        path: ['nodes', i, 'id'],
        message: `Identifiant de nœud en double : « ${node.id} » (nœuds n°${previous + 1} et n°${i + 1}).`,
      });
    } else byId.set(node.id, i);
  });
  model.nodes.forEach((node, i) => issues.push(...validateNode(node, i, byId, materialIds)));
  issues.push(...findCycles(model.nodes, byId));
  (model.animations ?? []).forEach((anim, a) => issues.push(...validateAnimation(anim, a, model, byId)));
  return issues;
}

function validateNode(node: NodeSpec, i: number, byId: Map<string, number>, materialIds: string[]): Issue[] {
  const issues: Issue[] = [];
  const at = (field: string) => ['nodes', i, field];
  if (node.parent !== undefined) {
    if (node.parent === node.id) {
      issues.push({ path: at('parent'), message: `Nœud « ${node.id} » : il ne peut pas être son propre parent.` });
    } else if (!byId.has(node.parent)) {
      issues.push({
        path: at('parent'),
        message: `Nœud « ${node.id} » : parent « ${node.parent} » introuvable (ids existants : ${list(byId.keys())}).`,
      });
    }
  }
  if (node.material !== undefined && !materialIds.includes(node.material)) {
    issues.push({
      path: at('material'),
      message:
        `Nœud « ${node.id} » : matériau « ${node.material} » absent de materials ` +
        `(matériaux définis : ${list(materialIds)}).`,
    });
  }
  const shape = node.shape;
  if (shape?.type === 'lathe' && shape.points.some((p) => p[0] < 0)) {
    issues.push({
      path: at('shape'),
      message: `Nœud « ${node.id} » : les rayons (1re valeur) des points d’un lathe doivent être ≥ 0.`,
    });
  }
  if (shape?.type === 'cylinder' && shape.radiusTop === 0 && shape.radiusBottom === 0) {
    issues.push({ path: at('shape'), message: `Nœud « ${node.id} » : radiusTop et radiusBottom ne peuvent pas être nuls tous les deux.` });
  }
  return issues;
}

function findCycles(nodes: NodeSpec[], byId: Map<string, number>): Issue[] {
  const issues: Issue[] = [];
  const reported = new Set<string>();
  nodes.forEach((node, i) => {
    const chain = [node.id];
    let current = node.parent;
    while (current !== undefined && byId.has(current) && current !== node.id) {
      if (chain.includes(current)) return; // cycle qui ne passe pas par ce nœud : signalé ailleurs
      chain.push(current);
      current = nodes[byId.get(current)!].parent;
    }
    if (current === node.id && chain.length > 1) {
      const key = [...chain].sort().join('|');
      if (reported.has(key)) return;
      reported.add(key);
      issues.push({
        path: ['nodes', i, 'parent'],
        message: `Cycle de parenté : ${[...chain, node.id].join(' → ')} (un nœud ne peut pas descendre de lui-même).`,
      });
    }
  });
  return issues;
}

function validateAnimation(anim: AnimationSpec, a: number, model: ModelShape, byId: Map<string, number>): Issue[] {
  const issues: Issue[] = [];
  const name = anim.name;
  const firstIndex = (model.animations ?? []).findIndex((x) => x.name === name);
  if (firstIndex !== a) {
    issues.push({ path: ['animations', a, 'name'], message: `Nom d’animation en double : « ${name} ».` });
  }
  const seen = new Set<string>();
  anim.tracks.forEach((track, t) => {
    const label = `Animation « ${name} », piste ${track.node}.${track.property}`;
    const at = (...rest: (string | number)[]) => ['animations', a, 'tracks', t, ...rest];
    if (!byId.has(track.node)) {
      issues.push({ path: at('node'), message: `${label} : nœud « ${track.node} » introuvable (ids existants : ${list(byId.keys())}).` });
    }
    const key = `${track.node}.${track.property}`;
    if (seen.has(key)) issues.push({ path: at(), message: `${label} : cette propriété est déjà animée par une autre piste.` });
    seen.add(key);
    track.keys.forEach((k, i) => {
      if (k.t > anim.duration + 1e-6) {
        issues.push({ path: at('keys', i, 't'), message: `${label} : la clé t=${k.t} dépasse la durée (${anim.duration} s).` });
      }
      const prev = track.keys[i - 1];
      if (prev && k.t <= prev.t) {
        issues.push({
          path: at('keys', i, 't'),
          message: `${label} : les temps des clés doivent être strictement croissants (t=${prev.t} puis t=${k.t}).`,
        });
      }
    });
  });
  return issues;
}

export const model3dSpecSchema = z
  .object({
    name: z.string().min(1).max(60).describe('Nom du modèle'),
    materials: z.record(z.string(), materialSchema).describe('Matériaux indexés par identifiant'),
    nodes: z.array(nodeSchema).min(1).max(MAX_NODES).describe(`Nœuds (${MAX_NODES} au maximum)`),
    animations: z.array(animationSchema).max(MAX_ANIMATIONS).optional().describe('Animations par images clés'),
  })
  .superRefine((model, ctx) => {
    for (const issue of validateModel(model)) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

export type Model3dSpec = z.infer<typeof model3dSpecSchema>;

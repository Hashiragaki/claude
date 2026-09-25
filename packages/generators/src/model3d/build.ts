import { Euler, Quaternion } from 'three';
import {
  buildGlb,
  type GlbAnimationChannelInput,
  type GlbAnimationInput,
  type GlbMaterialInput,
  type GlbMeshInput,
  type GlbNodeInput,
  type Vec3,
  type Vec4,
} from '../encode/glb';
import { hexToLinear } from './color';
import type { AnimationSpec, MaterialSpec, Model3dSpec, NodeSpec, TrackSpec } from './dsl';
import { shapeMesh } from './geometry';

/** Construction du GLB à partir d'une spec validée. */

/** Nombre maximal de triangles d'un modèle (garde-fou mémoire). */
export const MAX_TRIANGLES = 300_000;

const DEG = Math.PI / 180;
const DEFAULT_MATERIAL: MaterialSpec = { color: '#b8b8b8' };

export interface BuiltModel {
  glb: Uint8Array;
  nodes: number;
  triangles: number;
  animations: string[];
}

/** Quaternion xyzw d'une rotation Euler XYZ en degrés. */
export function eulerDegToQuat(rotation: number[]): Vec4 {
  const q = new Quaternion().setFromEuler(new Euler(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, 'XYZ'));
  return [q.x, q.y, q.z, q.w];
}

function convertMaterial(id: string, m: MaterialSpec, doubleSided: boolean): GlbMaterialInput {
  const [r, g, b] = hexToLinear(m.color);
  const out: GlbMaterialInput = {
    name: id,
    baseColor: [r, g, b, m.opacity ?? 1],
    metallic: m.metalness ?? 0,
    roughness: m.roughness ?? 0.8,
  };
  if (m.emissive) out.emissive = hexToLinear(m.emissive);
  if (doubleSided || (m.opacity ?? 1) < 1) out.doubleSided = true;
  return out;
}

/** Convertit une piste du DSL en canal glTF, en complétant les clés à 0 et à `duration`. */
function convertTrack(track: TrackSpec, node: number, duration: number): GlbAnimationChannelInput {
  const keys = [...track.keys];
  if (keys[0].t > 0) keys.unshift({ t: 0, value: keys[0].value });
  const last = keys[keys.length - 1];
  if (last.t < duration) keys.push({ t: duration, value: last.value });
  const times = keys.map((k) => k.t);
  const values: number[] = [];
  if (track.property === 'rotation') {
    let previous: Vec4 | null = null;
    for (const k of keys) {
      const q = eulerDegToQuat(k.value);
      // Continuité : on reste dans le même hémisphère pour que l'interpolation prenne le chemin court.
      if (previous && q[0] * previous[0] + q[1] * previous[1] + q[2] * previous[2] + q[3] * previous[3] < 0) {
        for (let i = 0; i < 4; i++) q[i] = -q[i];
      }
      values.push(...q);
      previous = q;
    }
  } else {
    for (const k of keys) values.push(k.value[0], k.value[1], k.value[2]);
  }
  return {
    node,
    path: track.property === 'position' ? 'translation' : track.property,
    interpolation: track.interpolation === 'step' ? 'STEP' : 'LINEAR',
    times,
    values,
  };
}

function convertAnimation(anim: AnimationSpec, nodeIndex: Map<string, number>): GlbAnimationInput {
  return {
    name: anim.name,
    channels: anim.tracks.map((t) => convertTrack(t, nodeIndex.get(t.node)!, anim.duration)),
    extras: { loop: anim.loop ?? true, duration: anim.duration },
  };
}

function convertNode(node: NodeSpec): GlbNodeInput {
  const out: GlbNodeInput = { name: node.id };
  if (node.position) out.translation = node.position as Vec3;
  if (node.rotation) out.rotation = eulerDegToQuat(node.rotation);
  if (node.scale) out.scale = node.scale as Vec3;
  return out;
}

/** Construit le fichier GLB (géométrie, matériaux, hiérarchie, animations) d'une spec validée. */
export function buildModel(spec: Model3dSpec): BuiltModel {
  const nodeIndex = new Map(spec.nodes.map((n, i) => [n.id, i]));
  const materialIds = Object.keys(spec.materials);
  const doubleSidedIds = new Set(
    spec.nodes.filter((n) => n.shape?.type === 'plane' || n.shape?.type === 'lathe').map((n) => n.material ?? ''),
  );
  const materials = materialIds.map((id) => convertMaterial(id, spec.materials[id], doubleSidedIds.has(id)));
  let defaultMaterial = -1;

  const nodes = spec.nodes.map(convertNode);
  spec.nodes.forEach((n, i) => {
    if (n.parent === undefined) return;
    const parent = nodes[nodeIndex.get(n.parent)!];
    (parent.children ??= []).push(i);
  });

  // Une maille par combinaison (forme, matériau) : les formes répétées sont partagées.
  const meshes: GlbMeshInput[] = [];
  const meshCache = new Map<string, { index: number; triangles: number }>();
  let triangles = 0;
  spec.nodes.forEach((n, i) => {
    if (!n.shape) return;
    let material = n.material !== undefined ? materialIds.indexOf(n.material) : -1;
    if (material < 0) {
      if (defaultMaterial < 0) {
        materials.push(convertMaterial('default', DEFAULT_MATERIAL, false));
        defaultMaterial = materials.length - 1;
      }
      material = defaultMaterial;
    }
    const flat = n.material !== undefined && spec.materials[n.material]?.flatShading === true;
    const key = `${JSON.stringify(n.shape)}|${material}|${flat}`;
    let mesh = meshCache.get(key);
    if (!mesh) {
      const data = shapeMesh(n.shape, flat);
      meshes.push({ name: n.id, primitives: [{ ...data, material }] });
      mesh = { index: meshes.length - 1, triangles: data.triangles };
      meshCache.set(key, mesh);
    }
    nodes[i].mesh = mesh.index;
    triangles += mesh.triangles;
  });
  if (triangles > MAX_TRIANGLES) {
    throw new Error(
      `Modèle trop détaillé : ${triangles} triangles (maximum ${MAX_TRIANGLES}) ; réduisez les segments ou le nombre de nœuds.`,
    );
  }

  const animations = (spec.animations ?? []).map((a) => convertAnimation(a, nodeIndex));
  const glb = buildGlb({
    name: spec.name,
    nodes,
    meshes,
    materials,
    animations,
    generator: 'Forge model3d',
  });
  return { glb, nodes: spec.nodes.length, triangles, animations: animations.map((a) => a.name) };
}

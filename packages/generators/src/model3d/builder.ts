import type { AnimationSpec, MaterialSpec, Model3dSpec, NodeSpec, ShapeSpec } from './dsl';

/** Petit assistant d'écriture de specs pour les modèles procéduraux. */

export type Vec3 = [number, number, number];

export interface NodeOptions {
  parent?: string;
  shape?: ShapeSpec;
  material?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

/** Arrondit récursivement les nombres (JSON source plus lisible, valeurs stables). */
export function roundDeep<T>(value: T, decimals = 4): T {
  const f = Math.pow(10, decimals);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'number') return Math.round(v * f) / f + 0;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export class ModelBuilder {
  readonly materials: Record<string, MaterialSpec> = {};
  readonly nodes: NodeSpec[] = [];
  readonly animations: AnimationSpec[] = [];

  material(id: string, color: string, extra: Omit<MaterialSpec, 'color'> = {}): string {
    this.materials[id] = { color, ...extra };
    return id;
  }

  /** Ajoute un nœud (forme ou groupe) et renvoie son identifiant. */
  add(id: string, options: NodeOptions = {}): string {
    const node: NodeSpec = { id };
    if (options.parent) node.parent = options.parent;
    if (options.shape) node.shape = options.shape;
    if (options.material) node.material = options.material;
    if (options.position && options.position.some((v) => v !== 0)) node.position = options.position;
    if (options.rotation && options.rotation.some((v) => v !== 0)) node.rotation = options.rotation;
    if (options.scale && options.scale.some((v) => v !== 1)) node.scale = options.scale;
    this.nodes.push(node);
    return id;
  }

  /** Groupe vide (pivot d'articulation, conteneur). */
  group(id: string, parent?: string, position?: Vec3, rotation?: Vec3): string {
    return this.add(id, { parent, position, rotation });
  }

  toSpec(name: string): Model3dSpec {
    const spec: Model3dSpec = { name, materials: this.materials, nodes: this.nodes };
    if (this.animations.length) spec.animations = this.animations;
    return roundDeep(spec);
  }
}

/** Rotation Euler XYZ (degrés) qui aligne l'axe Y local sur la normale `n` (unitaire). */
export function alignYTo(n: Vec3): Vec3 {
  const rx = Math.atan2(n[2], n[1]);
  const rz = Math.asin(Math.max(-1, Math.min(1, -n[0])));
  return [(rx * 180) / Math.PI, 0, (rz * 180) / Math.PI];
}

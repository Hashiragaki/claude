import { MathUtils, Object3D, Vector3 } from 'three';
import type { Model3dSpec } from './dsl';
import { shapeMesh } from './geometry';

/** Boîte englobante exacte (repère du modèle) d'une spec, sommets transformés compris. */
export function modelBounds(spec: Pick<Model3dSpec, 'nodes'>): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const objects = new Map<string, Object3D>();
  for (const node of spec.nodes) {
    const o = new Object3D();
    if (node.position) o.position.fromArray(node.position);
    if (node.rotation) {
      const [x, y, z] = node.rotation.map((d) => MathUtils.degToRad(d));
      o.rotation.set(x, y, z, 'XYZ');
    }
    if (node.scale) o.scale.fromArray(node.scale);
    objects.set(node.id, o);
  }
  const scene = new Object3D();
  for (const node of spec.nodes) {
    const parent = node.parent !== undefined ? objects.get(node.parent) : undefined;
    (parent ?? scene).add(objects.get(node.id)!);
  }
  scene.updateMatrixWorld(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (const node of spec.nodes) {
    if (!node.shape) continue;
    const matrix = objects.get(node.id)!.matrixWorld;
    const positions = shapeMesh(node.shape).positions;
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrix);
      min.min(v);
      max.max(v);
    }
  }
  if (!Number.isFinite(min.x)) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
}

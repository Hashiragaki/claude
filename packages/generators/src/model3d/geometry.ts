import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
} from 'three';
import type { ShapeSpec } from './dsl';

/**
 * Conversion des formes du DSL en sommets, via les classes de géométrie de three.js utilisées
 * uniquement pour le calcul (aucun rendu, aucun DOM).
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  triangles: number;
}

function createGeometry(shape: ShapeSpec): BufferGeometry {
  switch (shape.type) {
    case 'box':
      return new BoxGeometry(shape.size[0], shape.size[1], shape.size[2]);
    case 'sphere':
      return new SphereGeometry(shape.radius, shape.widthSegments ?? 16, shape.heightSegments ?? 12);
    case 'cylinder':
      return new CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.radialSegments ?? 16);
    case 'cone':
      return new ConeGeometry(shape.radius, shape.height, shape.radialSegments ?? 16);
    case 'torus':
      return new TorusGeometry(shape.radius, shape.tube, 10, 24);
    case 'capsule':
      return new CapsuleGeometry(shape.radius, shape.length, 4, 12);
    case 'plane':
      return new PlaneGeometry(shape.size[0], shape.size[1]);
    case 'lathe':
      return new LatheGeometry(
        shape.points.map((p) => new Vector2(p[0], p[1])),
        shape.segments ?? 16,
      );
    case 'extrude':
      return createExtrude(shape.points, shape.depth, shape.bevel ?? false);
    case 'icosahedron':
      return new IcosahedronGeometry(shape.radius, shape.detail ?? 0);
  }
}

/** Extrusion d'un contour XY selon Z, centrée en profondeur ; biseau proportionné à la forme. */
function createExtrude(points: number[][], depth: number, bevel: boolean): BufferGeometry {
  const outline = new Shape(points.map((p) => new Vector2(p[0], p[1])));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const extent = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const bevelSize = Math.min(extent * 0.08, depth * 0.3);
  const geometry = new ExtrudeGeometry(outline, {
    depth,
    curveSegments: 8,
    bevelEnabled: bevel,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Sommets d'une forme ; `flat` (ou un icosaèdre) produit des normales par face (facettes). */
export function shapeMesh(shape: ShapeSpec, flat = false): MeshData {
  let geometry = createGeometry(shape);
  if (flat || shape.type === 'icosahedron') {
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  }
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const data: MeshData = {
    positions: Float32Array.from(position.array as ArrayLike<number>),
    normals: Float32Array.from(normal.array as ArrayLike<number>),
    triangles: index ? index.count / 3 : position.count / 3,
  };
  if (uv) data.uvs = Float32Array.from(uv.array as ArrayLike<number>);
  if (index) {
    data.indices = position.count > 65535 ? Uint32Array.from(index.array) : Uint16Array.from(index.array);
  }
  geometry.dispose();
  return data;
}

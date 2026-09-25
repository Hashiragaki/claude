/**
 * Écriture (et relecture minimale) de fichiers glTF 2.0 binaires (GLB).
 *
 * L'appelant décrit la scène avec des tableaux typés (sommets, indices, clés d'animation) ; ce module
 * se charge du tampon binaire (alignement 4 octets), des accessors (min/max requis), des bufferViews
 * et de l'assemblage des deux chunks JSON + BIN. Aucune dépendance au DOM (pas de FileReader/Blob).
 */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface GlbPrimitiveInput {
  /** Positions xyz (float32). */
  positions: Float32Array;
  normals?: Float32Array;
  /** Coordonnées de texture uv (float32). */
  uvs?: Float32Array;
  /** Indices de triangles ; converti en uint16 ou uint32 selon le nombre de sommets. */
  indices?: ArrayLike<number>;
  material?: number;
}

export interface GlbMeshInput {
  name?: string;
  primitives: GlbPrimitiveInput[];
}

export interface GlbMaterialInput {
  name?: string;
  /** Couleur de base RGBA en espace linéaire (0–1). */
  baseColor: Vec4;
  metallic?: number;
  roughness?: number;
  /** Émission RGB en espace linéaire (0–1). */
  emissive?: Vec3;
  /** `BLEND` si alpha < 1 (déduit automatiquement si absent). */
  alphaMode?: 'OPAQUE' | 'BLEND' | 'MASK';
  doubleSided?: boolean;
}

export interface GlbNodeInput {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: Vec3;
  /** Quaternion xyzw. */
  rotation?: Vec4;
  scale?: Vec3;
  extras?: Record<string, unknown>;
}

export type GlbAnimationPath = 'translation' | 'rotation' | 'scale';

export interface GlbAnimationChannelInput {
  node: number;
  path: GlbAnimationPath;
  interpolation?: 'LINEAR' | 'STEP';
  /** Temps des clés en secondes, strictement croissants. */
  times: ArrayLike<number>;
  /** Valeurs aplaties : 3 composantes par clé (4 pour une rotation en quaternion). */
  values: ArrayLike<number>;
}

export interface GlbAnimationInput {
  name: string;
  channels: GlbAnimationChannelInput[];
  extras?: Record<string, unknown>;
}

export interface GlbDocumentInput {
  /** Nom de la scène. */
  name?: string;
  nodes: GlbNodeInput[];
  meshes?: GlbMeshInput[];
  materials?: GlbMaterialInput[];
  animations?: GlbAnimationInput[];
  /** Nœuds racines de la scène ; par défaut, tous les nœuds qui ne sont l'enfant d'aucun autre. */
  roots?: number[];
  generator?: string;
  /** Métadonnées libres stockées dans `asset.extras`. */
  extras?: Record<string, unknown>;
}

/** Sous-ensemble du JSON glTF produit (utile pour les tests et l'inspection). */
export interface GltfJson {
  asset: { version: string; generator?: string; extras?: Record<string, unknown> };
  scene?: number;
  scenes?: { name?: string; nodes: number[] }[];
  nodes?: GlbNodeInput[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  materials?: Record<string, unknown>[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number }[];
  animations?: {
    name?: string;
    channels: { sampler: number; target: { node: number; path: GlbAnimationPath } }[];
    samplers: { input: number; output: number; interpolation: string }[];
    extras?: Record<string, unknown>;
  }[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
}

export interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

const GLB_MAGIC = 0x46546c67; // « glTF »
const CHUNK_JSON = 0x4e4f534a; // « JSON »
const CHUNK_BIN = 0x004e4942; // « BIN\0 »
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

type AccessorType = GltfAccessor['type'];
const COMPONENTS: Record<AccessorType, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Accumule les données binaires et les descriptions d'accessors / bufferViews. */
class BinaryBuilder {
  readonly parts: Uint8Array[] = [];
  readonly views: GltfBufferView[] = [];
  readonly accessors: GltfAccessor[] = [];
  private length = 0;
  private readonly timeCache = new Map<string, number>();

  private addView(data: Uint8Array, target?: number): number {
    const view: GltfBufferView = { buffer: 0, byteOffset: this.length, byteLength: data.byteLength };
    if (target !== undefined) view.target = target;
    this.parts.push(data);
    this.length += data.byteLength;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.views.push(view);
    return this.views.length - 1;
  }

  /** Ajoute un accessor flottant ; `withBounds` calcule min/max par composante. */
  addFloat(values: ArrayLike<number>, type: AccessorType, target?: number, withBounds = false): number {
    const data = values instanceof Float32Array ? values : Float32Array.from(values);
    const n = COMPONENTS[type];
    if (data.length % n !== 0) throw new Error(`buildGlb : longueur ${data.length} incompatible avec ${type}`);
    const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const accessor: GltfAccessor = {
      bufferView: this.addView(bytes, target),
      componentType: FLOAT,
      count: data.length / n,
      type,
    };
    if (withBounds) Object.assign(accessor, bounds(data, n));
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  addIndices(indices: ArrayLike<number>, vertexCount: number): number {
    const wide = vertexCount > 65535;
    const data = wide ? Uint32Array.from(indices) : Uint16Array.from(indices);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.accessors.push({
      bufferView: this.addView(bytes, ELEMENT_ARRAY_BUFFER),
      componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT,
      count: data.length,
      type: 'SCALAR',
    });
    return this.accessors.length - 1;
  }

  /** Temps d'animation : partagés entre canaux identiques, toujours avec min/max. */
  addTimes(times: ArrayLike<number>): number {
    const key = Array.from(times).join(',');
    const cached = this.timeCache.get(key);
    if (cached !== undefined) return cached;
    const index = this.addFloat(times, 'SCALAR', undefined, true);
    this.timeCache.set(key, index);
    return index;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}

function bounds(data: Float32Array, n: number): { min: number[]; max: number[] } {
  const min = new Array<number>(n).fill(Infinity);
  const max = new Array<number>(n).fill(-Infinity);
  for (let i = 0; i < data.length; i++) {
    const c = i % n;
    const v = data[i];
    if (v < min[c]) min[c] = v;
    if (v > max[c]) max[c] = v;
  }
  // Math.fround : les bornes doivent correspondre exactement aux valeurs float32 stockées.
  const f32 = (v: number) => (Number.isFinite(v) ? Math.fround(v) : 0);
  return { min: min.map(f32), max: max.map(f32) };
}

function buildMaterial(m: GlbMaterialInput): Record<string, unknown> {
  const alpha = m.baseColor[3];
  const out: Record<string, unknown> = {
    pbrMetallicRoughness: {
      baseColorFactor: m.baseColor.map(clamp01),
      metallicFactor: clamp01(m.metallic ?? 0),
      roughnessFactor: clamp01(m.roughness ?? 0.8),
    },
  };
  if (m.name) out.name = m.name;
  if (m.emissive && m.emissive.some((v) => v > 0)) out.emissiveFactor = m.emissive.map(clamp01);
  const alphaMode = m.alphaMode ?? (alpha < 1 ? 'BLEND' : 'OPAQUE');
  if (alphaMode !== 'OPAQUE') out.alphaMode = alphaMode;
  if (m.doubleSided) out.doubleSided = true;
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function buildNode(node: GlbNodeInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.name) out.name = node.name;
  if (node.mesh !== undefined) out.mesh = node.mesh;
  if (node.children && node.children.length) out.children = node.children;
  if (node.translation && node.translation.some((v) => v !== 0)) out.translation = node.translation;
  if (node.rotation && !isIdentityQuat(node.rotation)) out.rotation = node.rotation;
  if (node.scale && node.scale.some((v) => v !== 1)) out.scale = node.scale;
  if (node.extras) out.extras = node.extras;
  return out;
}

function isIdentityQuat(q: Vec4): boolean {
  return q[0] === 0 && q[1] === 0 && q[2] === 0 && Math.abs(q[3]) === 1;
}

/** Racines par défaut : nœuds qui ne sont l'enfant d'aucun autre. */
function defaultRoots(nodes: GlbNodeInput[]): number[] {
  const isChild = new Set<number>();
  for (const n of nodes) for (const c of n.children ?? []) isChild.add(c);
  return nodes.map((_, i) => i).filter((i) => !isChild.has(i));
}

/** Construit un fichier GLB (glTF 2.0 binaire) à partir d'une description de scène. */
export function buildGlb(doc: GlbDocumentInput): Uint8Array {
  const bin = new BinaryBuilder();
  const meshes = (doc.meshes ?? []).map((mesh) => {
    const primitives = mesh.primitives.map((p) => {
      const vertexCount = p.positions.length / 3;
      const attributes: Record<string, number> = {
        POSITION: bin.addFloat(p.positions, 'VEC3', ARRAY_BUFFER, true),
      };
      if (p.normals) attributes.NORMAL = bin.addFloat(p.normals, 'VEC3', ARRAY_BUFFER);
      if (p.uvs) attributes.TEXCOORD_0 = bin.addFloat(p.uvs, 'VEC2', ARRAY_BUFFER);
      const prim: GltfPrimitive = { attributes, mode: 4 };
      if (p.indices) prim.indices = bin.addIndices(p.indices, vertexCount);
      if (p.material !== undefined) prim.material = p.material;
      return prim;
    });
    return mesh.name ? { name: mesh.name, primitives } : { primitives };
  });

  const animations = (doc.animations ?? []).map((anim) => {
    const samplers = anim.channels.map((ch) => {
      const size = ch.path === 'rotation' ? 4 : 3;
      if (ch.values.length !== ch.times.length * size) {
        throw new Error(`buildGlb : animation « ${anim.name} » : nombre de valeurs incohérent pour ${ch.path}`);
      }
      return {
        input: bin.addTimes(ch.times),
        output: bin.addFloat(ch.values, size === 4 ? 'VEC4' : 'VEC3'),
        interpolation: ch.interpolation ?? 'LINEAR',
      };
    });
    const channels = anim.channels.map((ch, i) => ({ sampler: i, target: { node: ch.node, path: ch.path } }));
    const out: Record<string, unknown> = { name: anim.name, channels, samplers };
    if (anim.extras) out.extras = anim.extras;
    return out;
  });

  const binary = bin.concat();
  const asset: Record<string, unknown> = { version: '2.0', generator: doc.generator ?? 'Forge' };
  if (doc.extras) asset.extras = doc.extras;
  const json: Record<string, unknown> = {
    asset,
    scene: 0,
    scenes: [{ name: doc.name ?? 'Scene', nodes: doc.roots ?? defaultRoots(doc.nodes) }],
    nodes: doc.nodes.map(buildNode),
  };
  if (meshes.length) json.meshes = meshes;
  if (doc.materials?.length) json.materials = doc.materials.map(buildMaterial);
  if (bin.accessors.length) json.accessors = bin.accessors;
  if (bin.views.length) json.bufferViews = bin.views;
  if (binary.byteLength) json.buffers = [{ byteLength: binary.byteLength }];
  if (animations.length) json.animations = animations;

  return assembleGlb(json, binary);
}

/** Assemble l'en-tête GLB, le chunk JSON (complété par des espaces) et le chunk BIN (complété par des zéros). */
function assembleGlb(json: unknown, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = align4(jsonBytes.byteLength);
  const binPadded = align4(binary.byteLength);
  const total = 12 + 8 + jsonPadded + (binary.byteLength ? 8 + binPadded : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded);
  if (binary.byteLength) {
    const start = 20 + jsonPadded;
    view.setUint32(start, binPadded, true);
    view.setUint32(start + 4, CHUNK_BIN, true);
    out.set(binary, start + 8);
  }
  return out;
}

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

/** Relit un GLB : vérifie l'en-tête et l'alignement, renvoie le JSON et le chunk binaire. */
export function parseGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB invalide : en-tête absent');
  if (view.getUint32(4, true) !== 2) throw new Error('GLB invalide : version différente de 2');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB invalide : longueur totale incohérente');
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0) throw new Error('GLB invalide : chunk non aligné sur 4 octets');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + length;
  }
  if (!json) throw new Error('GLB invalide : chunk JSON absent');
  return { json, bin };
}

/** Lit les valeurs d'un accessor flottant (float32) d'un GLB relu avec `parseGlb`. */
export function readAccessor(json: GltfJson, bin: Uint8Array, index: number): Float32Array | Uint16Array | Uint32Array {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`Accessor ${index} introuvable`);
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`BufferView ${accessor.bufferView} introuvable`);
  const count = accessor.count * COMPONENTS[accessor.type];
  const start = bin.byteOffset + view.byteOffset + (accessor.byteOffset ?? 0);
  const buffer = bin.buffer.slice(start, start + view.byteLength);
  if (accessor.componentType === FLOAT) return new Float32Array(buffer, 0, count);
  if (accessor.componentType === UNSIGNED_SHORT) return new Uint16Array(buffer, 0, count);
  return new Uint32Array(buffer, 0, count);
}

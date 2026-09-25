import { describe, expect, it } from 'vitest';
import { buildGlb, parseGlb, readAccessor, type GlbDocumentInput } from './glb';

const triangle: GlbDocumentInput = {
  name: 'Test',
  nodes: [
    { name: 'root', children: [1], translation: [0, 1, 0] },
    { name: 'tri', mesh: 0, rotation: [0, 0, 0.7071068, 0.7071068], scale: [2, 2, 2] },
  ],
  meshes: [
    {
      name: 'tri',
      primitives: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, -1]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
          indices: [0, 1, 2],
          material: 0,
        },
      ],
    },
  ],
  materials: [{ name: 'verre', baseColor: [0.2, 0.4, 0.6, 0.5], emissive: [1, 0.5, 0], metallic: 0.3 }],
  animations: [
    {
      name: 'bounce',
      channels: [
        { node: 0, path: 'translation', times: [0, 0.5, 1], values: [0, 1, 0, 0, 2, 0, 0, 1, 0] },
        {
          node: 1,
          path: 'rotation',
          interpolation: 'STEP',
          times: [0, 0.5, 1],
          values: [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1],
        },
        { node: 1, path: 'scale', times: [0.25, 2], values: [1, 1, 1, 2, 2, 2] },
      ],
    },
  ],
};

describe('buildGlb', () => {
  it('produit un en-tête GLB 2.0 et des chunks alignés sur 4 octets', () => {
    const glb = buildGlb(triangle);
    const view = new DataView(glb.buffer);
    expect(String.fromCharCode(...glb.subarray(0, 4))).toBe('glTF');
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.length);
    expect(glb.length % 4).toBe(0);
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    const binLength = view.getUint32(20 + jsonLength, true);
    expect(binLength % 4).toBe(0);
    expect(view.getUint32(24 + jsonLength, true)).toBe(0x004e4942);
    expect(28 + jsonLength + binLength).toBe(glb.length);
  });

  it('écrit un JSON glTF valide : scène, hiérarchie, matériau, accessors bornés', () => {
    const { json, bin } = parseGlb(buildGlb(triangle));
    expect(json.asset.version).toBe('2.0');
    expect(json.scenes?.[0]).toEqual({ name: 'Test', nodes: [0] });
    expect(json.nodes?.[0].children).toEqual([1]);
    expect(json.nodes?.[1].mesh).toBe(0);
    expect(json.buffers?.[0].byteLength).toBe(bin?.byteLength);
    for (const view of json.bufferViews ?? []) expect(view.byteOffset % 4).toBe(0);

    const material = json.materials?.[0] as Record<string, any>;
    expect(material.alphaMode).toBe('BLEND');
    expect(material.pbrMetallicRoughness.baseColorFactor).toEqual([0.2, 0.4, 0.6, 0.5]);
    expect(material.emissiveFactor).toEqual([1, 0.5, 0]);

    const prim = json.meshes![0].primitives[0];
    const position = json.accessors![prim.attributes.POSITION];
    expect(position.min).toEqual([0, 0, -1]);
    expect(position.max).toEqual([1, 2, 0]);
    expect(json.accessors![prim.indices!].componentType).toBe(5123);
    expect(Array.from(readAccessor(json, bin!, prim.attributes.TEXCOORD_0))).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('écrit les animations : échantillonneurs, canaux, temps bornés et partagés', () => {
    const { json, bin } = parseGlb(buildGlb(triangle));
    const anim = json.animations![0];
    expect(anim.name).toBe('bounce');
    expect(anim.channels.map((c) => c.target.path)).toEqual(['translation', 'rotation', 'scale']);
    expect(anim.samplers[1].interpolation).toBe('STEP');
    // Mêmes temps → même accessor d'entrée.
    expect(anim.samplers[0].input).toBe(anim.samplers[1].input);
    const input = json.accessors![anim.samplers[2].input];
    expect(input.min).toEqual([0.25]);
    expect(input.max).toEqual([2]);
    expect(json.accessors![anim.samplers[1].output].type).toBe('VEC4');
    expect(Array.from(readAccessor(json, bin!, anim.samplers[0].output))).toEqual([0, 1, 0, 0, 2, 0, 0, 1, 0]);
  });

  it('passe aux indices 32 bits au-delà de 65535 sommets', () => {
    const count = 70000;
    const positions = new Float32Array(count * 3).map((_, i) => i % 7);
    const { json } = parseGlb(
      buildGlb({ nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ positions, indices: [0, 1, count - 1] }] }] }),
    );
    const prim = json.meshes![0].primitives[0];
    expect(json.accessors![prim.indices!].componentType).toBe(5125);
  });

  it('omet le chunk binaire pour une scène sans géométrie', () => {
    const glb = buildGlb({ nodes: [{ name: 'vide' }] });
    const { json, bin } = parseGlb(glb);
    expect(bin).toBeNull();
    expect(json.buffers).toBeUndefined();
    expect(json.meshes).toBeUndefined();
    expect(json.nodes).toEqual([{ name: 'vide' }]);
  });

  it('refuse des valeurs d’animation incohérentes et un GLB corrompu', () => {
    expect(() =>
      buildGlb({
        nodes: [{}],
        animations: [{ name: 'x', channels: [{ node: 0, path: 'rotation', times: [0, 1], values: [0, 0, 0] }] }],
      }),
    ).toThrow(/incohérent/);
    expect(() => parseGlb(new Uint8Array(24))).toThrow(/GLB invalide/);
  });
});

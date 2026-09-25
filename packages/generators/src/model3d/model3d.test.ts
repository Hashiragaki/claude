import { Rng } from '@forge/core';
import { Box3, Quaternion } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseGlb, readAccessor } from '../encode/glb';
import type { RenderContext } from '../types';
import { eulerDegToQuat } from './build';
import { model3dSpecSchema, type Model3dSpec } from './dsl';
import { model3dGenerator } from './model3d';
import { detectTemplate, MODEL_TEMPLATE_NAMES } from './templates';

const ctx: RenderContext = { rasterizeSvg: async () => new Uint8Array() };
const params = (over: Record<string, unknown> = {}) => model3dGenerator.paramsSchema.parse(over);

async function render(spec: Model3dSpec) {
  const result = await model3dGenerator.render(spec, params(), ctx);
  const glb = result.files.find((f) => f.role === 'main')!.data as Uint8Array;
  return { result, glb, ...parseGlb(glb) };
}

function loadWithThree(glb: Uint8Array): Promise<GLTF> {
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
}

/** Spec telle que Claude pourrait l'écrire : toutes les formes, hiérarchie, transparence, animation. */
const claudeSpec = {
  name: 'Lanterne de jardin',
  materials: {
    fer: { color: '#2f3640', metalness: 0.7, roughness: 0.4 },
    lumiere: { color: '#fff3c4', emissive: '#ffcc66' },
    verre: { color: '#e8f4ff', opacity: 0.4 },
    pierre: { color: '#8d8a86', flatShading: true },
  },
  nodes: [
    { id: 'racine' },
    {
      id: 'socle',
      parent: 'racine',
      shape: { type: 'cylinder', radiusTop: 0.2, radiusBottom: 0.25, height: 0.1 },
      material: 'pierre',
      position: [0, 0.05, 0],
    },
    {
      id: 'pied',
      parent: 'racine',
      shape: {
        type: 'lathe',
        points: [
          [0.06, 0],
          [0.04, 0.5],
          [0.05, 0.9],
          [0, 0.92],
        ],
        segments: 10,
      },
      material: 'fer',
      position: [0, 0.1, 0],
    },
    { id: 'tete', parent: 'racine', position: [0, 1.05, 0] },
    { id: 'vitre', parent: 'tete', shape: { type: 'box', size: [0.2, 0.25, 0.2] }, material: 'verre' },
    { id: 'flamme', parent: 'tete', shape: { type: 'capsule', radius: 0.03, length: 0.06 }, material: 'lumiere' },
    {
      id: 'chapeau',
      parent: 'tete',
      shape: { type: 'cone', radius: 0.18, height: 0.12, radialSegments: 4 },
      material: 'fer',
      position: [0, 0.19, 0],
      rotation: [0, 45, 0],
    },
    {
      id: 'anneau',
      parent: 'tete',
      shape: { type: 'torus', radius: 0.05, tube: 0.01 },
      material: 'fer',
      position: [0, 0.28, 0],
    },
    {
      id: 'plaque',
      parent: 'racine',
      shape: { type: 'plane', size: [0.3, 0.1] },
      material: 'fer',
      position: [0, 0.6, 0.06],
    },
    {
      id: 'blason',
      parent: 'racine',
      shape: {
        type: 'extrude',
        points: [
          [0, 0],
          [0.1, 0],
          [0.05, 0.1],
        ],
        depth: 0.02,
        bevel: true,
      },
      material: 'fer',
      position: [0, 0.4, 0.06],
    },
    {
      id: 'gemme',
      parent: 'racine',
      shape: { type: 'icosahedron', radius: 0.03, detail: 1 },
      material: 'lumiere',
      position: [0, 0.75, 0.06],
    },
    { id: 'boule', parent: 'racine', shape: { type: 'sphere', radius: 0.04 }, position: [0, 1.4, 0] },
  ],
  animations: [
    {
      name: 'flicker',
      duration: 1.2,
      tracks: [
        {
          node: 'flamme',
          property: 'scale',
          keys: [
            { t: 0, value: [1, 1, 1] },
            { t: 0.6, value: [0.9, 1.1, 0.9] },
            { t: 1.2, value: [1, 1, 1] },
          ],
        },
        {
          node: 'tete',
          property: 'rotation',
          interpolation: 'step',
          keys: [
            { t: 0.3, value: [0, 0, 5] },
            { t: 0.9, value: [0, 0, -5] },
          ],
        },
      ],
    },
  ],
};

describe('générateur de modèles 3D', () => {
  it('accepte des paramètres vides avec des valeurs par défaut', () => {
    expect(params()).toEqual({ prompt: '', template: 'auto', animations: [] });
    expect(() => params({ color: 'bleu' })).toThrow();
    expect(model3dGenerator.kind).toBe('model');
  });

  it('expose un schéma de spec convertible en JSON Schema', () => {
    expect(() => z.toJSONSchema(model3dGenerator.specSchema)).not.toThrow();
  });

  it('est déterministe pour une graine donnée', () => {
    const p = params({ template: 'tree', animations: ['sway'] });
    expect(model3dGenerator.procedural(p, new Rng(5))).toEqual(model3dGenerator.procedural(p, new Rng(5)));
    expect(model3dGenerator.procedural(p, new Rng(5))).not.toEqual(model3dGenerator.procedural(p, new Rng(6)));
  });

  it('rend chaque modèle procédural (plusieurs graines) en GLB valide', async () => {
    for (const template of MODEL_TEMPLATE_NAMES) {
      for (const seed of [1, 2, 3]) {
        const spec = model3dGenerator.procedural(params({ template }), new Rng(seed));
        expect(model3dSpecSchema.safeParse(spec).success).toBe(true);
        const { result, json, glb } = await render(spec);
        expect(String.fromCharCode(...glb.subarray(0, 4))).toBe('glTF');
        expect(json.nodes).toHaveLength(spec.nodes.length);
        expect(result.info.nodes).toBe(spec.nodes.length);
        expect(result.info.triangles).toBeGreaterThan(10);
        expect(result.info.animations).toBe('');
        // Relu par three.js et posé au sol : rien sous y = 0 (à 3 cm près, les rochers sont un peu enfoncés).
        const loaded = await loadWithThree(glb);
        const box = new Box3().setFromObject(loaded.scene, true);
        expect(box.min.y).toBeGreaterThan(-0.03);
        expect(box.max.y).toBeGreaterThan(0.2);
      }
    }
  });

  it('ajoute les animations demandées (alias français), ignore les inconnues', async () => {
    const spec = model3dGenerator.procedural(
      params({ template: 'character', animations: ['marche', 'walk', 'salut', 'idle', 'danse', 'spin'] }),
      new Rng(1),
    );
    expect(spec.animations?.map((a) => a.name)).toEqual(['walk', 'wave', 'idle', 'spin']);
    const { result, json } = await render(spec);
    expect(result.info.animations).toBe('walk,wave,idle,spin');
    expect(json.animations?.map((a) => a.name)).toEqual(['walk', 'wave', 'idle', 'spin']);
    const loaded = await loadWithThree(
      (await model3dGenerator.render(spec, params(), ctx)).files[0].data as Uint8Array,
    );
    expect(loaded.animations.map((a) => a.name)).toEqual(['walk', 'wave', 'idle', 'spin']);
    expect(loaded.animations[0].duration).toBeCloseTo(0.8, 5);
  });

  it('propose des animations propres à chaque modèle', () => {
    const names = (template: string, animations: string[]) =>
      model3dGenerator.procedural(params({ template, animations }), new Rng(2)).animations?.map((a) => a.name) ?? [];
    expect(names('chest', ['open', 'close'])).toEqual(['open', 'close']);
    expect(names('tree', ['sway'])).toEqual(['sway']);
    expect(names('lamp', ['flicker'])).toEqual(['flicker']);
    expect(names('tower', ['drapeau'])).toEqual(['flag']);
    expect(names('house', ['smoke'])).toEqual(['smoke']);
    expect(names('well', ['sway', 'bob'])).toEqual(['sway', 'bob']);
    expect(names('mushroom', ['wobble', 'bounce'])).toEqual(['wobble', 'bounce']);
    expect(names('crate', ['open'])).toEqual([]);
  });

  it('choisit le modèle d’après la description (français et anglais)', () => {
    expect(detectTemplate('un vieux puits en pierre')).toBe('well');
    expect(detectTemplate('Coffre au trésor')).toBe('chest');
    expect(detectTemplate('une épée légendaire')).toBe('sword');
    expect(detectTemplate('le héros du village')).toBe('character');
    expect(detectTemplate('grand arbre')).toBe('tree');
    expect(detectTemplate('lampadaire de rue')).toBe('lamp');
    expect(detectTemplate('tour du château')).toBe('tower');
    expect(detectTemplate('barrière en bois')).toBe('fence');
    expect(detectTemplate('champignon magique')).toBe('mushroom');
    expect(detectTemplate('caisse en bois')).toBe('crate');
    expect(detectTemplate('petite maison')).toBe('house');
    expect(detectTemplate('gros rocher')).toBe('rock');
    expect(detectTemplate('wooden crate')).toBe('crate');
    const spec = model3dGenerator.procedural(params({ prompt: 'un coffre' }), new Rng(1));
    expect(spec.name).toBe('Coffre');
  });

  it('applique la couleur principale demandée', () => {
    const spec = model3dGenerator.procedural(params({ template: 'character', color: '#ff00aa' }), new Rng(1));
    expect(spec.materials.shirt.color).toBe('#ff00aa');
  });

  it('rend une spec écrite à la main avec toutes les formes', async () => {
    const spec = model3dSpecSchema.parse(claudeSpec);
    const { result, json, bin } = await render(spec);
    expect(result.info).toMatchObject({ nodes: 12, animations: 'flicker' });
    // Matériau transparent → BLEND ; couleur hexadécimale convertie en linéaire.
    const verre = json.materials!.find((m) => m.name === 'verre') as Record<string, any>;
    expect(verre.alphaMode).toBe('BLEND');
    expect(verre.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.4);
    const lumiere = json.materials!.find((m) => m.name === 'lumiere') as Record<string, any>;
    expect(lumiere.emissiveFactor[0]).toBeCloseTo(1);
    // Un nœud sans matériau reçoit le matériau par défaut.
    expect(json.materials!.some((m) => m.name === 'default')).toBe(true);
    // Bornes POSITION exactes.
    for (const mesh of json.meshes!) {
      const accessor = json.accessors![mesh.primitives[0].attributes.POSITION];
      const values = readAccessor(json, bin!, mesh.primitives[0].attributes.POSITION);
      const ys = Array.from(values).filter((_, i) => i % 3 === 1);
      expect(accessor.min![1]).toBe(Math.min(...ys));
      expect(accessor.max![1]).toBe(Math.max(...ys));
    }
    // Clés complétées à 0 et à la durée ; entrées bornées.
    const anim = json.animations![0];
    const input = json.accessors![anim.samplers[1].input];
    expect(input.min).toEqual([0]);
    expect(input.max![0]).toBeCloseTo(1.2);
    expect(anim.samplers[1].interpolation).toBe('STEP');
    const loaded = await loadWithThree(
      (await model3dGenerator.render(spec, params(), ctx)).files[0].data as Uint8Array,
    );
    expect(loaded.scene.getObjectByName('flamme')?.parent?.name).toBe('tete');
    expect(loaded.animations[0].tracks).toHaveLength(2);
  });

  it('convertit les rotations Euler XYZ en quaternions et garde leur continuité', async () => {
    const q = eulerDegToQuat([90, 0, 0]);
    expect(q[0]).toBeCloseTo(Math.SQRT1_2);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2);
    const spec = model3dGenerator.procedural(params({ template: 'rock', animations: ['spin'] }), new Rng(1));
    const { json, bin } = await render(spec);
    const out = readAccessor(json, bin!, json.animations![0].samplers[0].output);
    const quats = Array.from({ length: out.length / 4 }, (_, i) => new Quaternion(...out.subarray(i * 4, i * 4 + 4)));
    for (let i = 1; i < quats.length; i++) expect(quats[i].dot(quats[i - 1])).toBeGreaterThan(0);
    for (const quat of quats) expect(quat.length()).toBeCloseTo(1, 5);
  });

  it('construit des consignes qui intègrent les paramètres et la spec courante', () => {
    const p = params({ prompt: 'coffre de pirate', template: 'chest', animations: ['ouvrir'], color: '#224488' });
    const prompt = model3dGenerator.buildPrompt(p);
    expect(prompt).toContain('coffre de pirate');
    expect(prompt).toContain('chest');
    expect(prompt).toContain('open');
    expect(prompt).toContain('#224488');
    const spec = model3dGenerator.procedural(p, new Rng(1));
    const edit = model3dGenerator.buildEditPrompt(spec, 'couvercle doré', p);
    expect(edit).toContain('couvercle doré');
    expect(edit).toContain(JSON.stringify(spec));
    expect(model3dGenerator.systemPrompt).toMatch(/lathe/);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { model3dSpecSchema } from './dsl';

const base = {
  name: 'Test',
  materials: { bois: { color: '#8a5a35' } },
  nodes: [
    { id: 'root' },
    { id: 'caisse', parent: 'root', shape: { type: 'box', size: [1, 1, 1] }, material: 'bois', position: [0, 0.5, 0] },
  ],
};

function messages(spec: unknown): string[] {
  const result = model3dSpecSchema.safeParse(spec);
  expect(result.success).toBe(false);
  return result.error!.issues.map((i) => i.message);
}

describe('DSL des modèles 3D', () => {
  it('accepte une spec minimale et se convertit en JSON Schema', () => {
    expect(model3dSpecSchema.safeParse(base).success).toBe(true);
    const schema = z.toJSONSchema(model3dSpecSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['name', 'materials', 'nodes', 'animations']);
    expect(JSON.stringify(schema)).toContain('icosahedron');
    expect(z.toJSONSchema(model3dSpecSchema, { io: 'input' })).toBeTruthy();
  });

  it('signale un parent introuvable', () => {
    const spec = { ...base, nodes: [...base.nodes, { id: 'toit', parent: 'maison' }] };
    expect(messages(spec)).toEqual([
      expect.stringMatching(/Nœud « toit » : parent « maison » introuvable \(ids existants : root, caisse/),
    ]);
  });

  it('signale un matériau absent', () => {
    const spec = { ...base, nodes: [{ id: 'a', shape: { type: 'sphere', radius: 1 }, material: 'pierre' }] };
    expect(messages(spec)[0]).toMatch(
      /Nœud « a » : matériau « pierre » absent de materials \(matériaux définis : bois\)/,
    );
  });

  it('signale un cycle de parenté une seule fois', () => {
    const spec = {
      ...base,
      nodes: [
        { id: 'a', parent: 'c' },
        { id: 'b', parent: 'a' },
        { id: 'c', parent: 'b' },
        { id: 'd', parent: 'd' },
      ],
    };
    const list = messages(spec);
    expect(list.filter((m) => m.startsWith('Cycle de parenté'))).toEqual([
      'Cycle de parenté : a → c → b → a (un nœud ne peut pas descendre de lui-même).',
    ]);
    expect(list).toContain('Nœud « d » : il ne peut pas être son propre parent.');
  });

  it('signale les identifiants en double', () => {
    const spec = { ...base, nodes: [{ id: 'x' }, { id: 'y' }, { id: 'x' }] };
    expect(messages(spec)[0]).toMatch(/Identifiant de nœud en double : « x » \(nœuds n°1 et n°3\)/);
  });

  it('vérifie les animations : nœud, temps croissants, durée, pistes et noms uniques', () => {
    const track = (keys: { t: number; value: number[] }[], node = 'caisse') => ({ node, property: 'rotation', keys });
    const spec = {
      ...base,
      animations: [
        {
          name: 'tourne',
          duration: 1,
          tracks: [
            track([
              { t: 0, value: [0, 0, 0] },
              { t: 0.5, value: [0, 90, 0] },
              { t: 0.5, value: [0, 180, 0] },
              { t: 2, value: [0, 0, 0] },
            ]),
            track([{ t: 0, value: [0, 0, 0] }]),
            track([{ t: 0, value: [0, 0, 0] }], 'fantome'),
          ],
        },
        { name: 'tourne', duration: 1, tracks: [track([{ t: 0, value: [0, 0, 0] }])] },
      ],
    };
    const list = messages(spec);
    expect(list).toContain(
      'Animation « tourne », piste caisse.rotation : ' +
        'les temps des clés doivent être strictement croissants (t=0.5 puis t=0.5).',
    );
    expect(list).toContain('Animation « tourne », piste caisse.rotation : la clé t=2 dépasse la durée (1 s).');
    expect(list).toContain(
      'Animation « tourne », piste caisse.rotation : cette propriété est déjà animée par une autre piste.',
    );
    expect(list.some((m) => /piste fantome.rotation : nœud « fantome » introuvable/.test(m))).toBe(true);
    expect(list).toContain('Nom d’animation en double : « tourne ».');
  });

  it('borne les tailles et le nombre de segments', () => {
    const shape = (s: object) => ({ ...base, nodes: [{ id: 'a', shape: s }] });
    expect(model3dSpecSchema.safeParse(shape({ type: 'sphere', radius: 1, widthSegments: 200 })).success).toBe(false);
    expect(model3dSpecSchema.safeParse(shape({ type: 'box', size: [1, 1] })).success).toBe(false);
    expect(model3dSpecSchema.safeParse(shape({ type: 'icosahedron', radius: 1, detail: 9 })).success).toBe(false);
    expect(
      messages(
        shape({
          type: 'lathe',
          points: [
            [-1, 0],
            [1, 1],
          ],
        }),
      )[0],
    ).toMatch(/rayons .* ≥ 0/);
    const many = { ...base, nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}` })) };
    expect(model3dSpecSchema.safeParse(many).success).toBe(false);
    expect(model3dSpecSchema.safeParse({ ...base, materials: { a: { color: 'rouge' } } }).success).toBe(false);
  });
});

import {
  loadProjectBundle,
  MemoryProjectFiles,
  PROJECT_FORMAT,
  type AssetKind,
  type AssetMeta,
  type Diagnostic,
  type ProjectBundle,
} from '@forge/core';
import { describe, expect, it } from 'vitest';
import { loadPointClickProject } from './loader';
import {
  POINTCLICK_ITEMS_PATH,
  POINTCLICK_SYSTEM_PATH,
  scenePath,
  type ItemsFileInput,
  type PointClickSystemInput,
  type SceneInput,
} from './schema';
import { validatePointClickProject } from './validate';

const texts = (list: Diagnostic[], severity: Diagnostic['severity']) =>
  list.filter((d) => d.severity === severity).map((d) => d.message);

function asset(kind: AssetKind, alias: string, id: string): AssetMeta {
  return {
    id,
    kind,
    name: alias,
    alias,
    file: `${id}.bin`,
    extra: {},
    mime: 'application/octet-stream',
    tags: [],
    origin: 'template',
    version: 1,
    info: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const ASSETS = [asset('image', 'fond', 'a1'), asset('image', 'icone', 'a2'), asset('sfx', 'son', 'a3')];

const SQUARE = [
  { x: 0, y: 400 },
  { x: 1280, y: 400 },
  { x: 1280, y: 720 },
  { x: 0, y: 720 },
];

function baseScene(overrides: Partial<SceneInput> = {}): SceneInput {
  return {
    id: 'a',
    background: 'fond',
    walkArea: [SQUARE],
    playerStart: { x: 100, y: 500 },
    hotspots: [
      {
        id: 'porte',
        name: 'Porte',
        shape: { type: 'rect', x: 10, y: 10, w: 50, h: 50 },
        interactions: [{ actions: [{ type: 'end' }] }],
      },
    ],
    ...overrides,
  };
}

const BASE_ITEMS: ItemsFileInput = { items: [{ id: 'cle', name: 'Clé', icon: 'icone' }] };

async function bundleOf(
  options: {
    system?: Partial<PointClickSystemInput> | object;
    items?: ItemsFileInput | null;
    scenes?: Record<string, object>;
    assets?: AssetMeta[];
  } = {},
): Promise<ProjectBundle> {
  const files = new MemoryProjectFiles();
  files.write(POINTCLICK_SYSTEM_PATH, options.system ?? { startScene: 'a', scenes: ['a'] });
  if (options.items !== null) files.write(POINTCLICK_ITEMS_PATH, options.items ?? BASE_ITEMS);
  for (const [id, content] of Object.entries(options.scenes ?? { a: baseScene() })) files.write(scenePath(id), content);
  files.write('project.json', {
    format: PROJECT_FORMAT,
    id: 'projet',
    name: 'Test',
    mode: 'pointclick',
    entry: POINTCLICK_SYSTEM_PATH,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: options.assets ?? ASSETS,
  });
  return loadProjectBundle(files);
}

/** Valide une scène `a` dont les actions de la zone `porte` sont remplacées. */
async function withActions(actions: object[]): Promise<Diagnostic[]> {
  const scene = baseScene();
  (scene.hotspots as { interactions: unknown[] }[])[0]!.interactions = [{ actions }];
  return validatePointClickProject(await bundleOf({ scenes: { a: scene } }));
}

describe('validatePointClickProject', () => {
  it('accepte un petit projet valide', async () => {
    expect(await validatePointClickProject(await bundleOf())).toEqual([]);
  });

  it('signale un système invalide avec le chemin du fichier', async () => {
    const diags = await validatePointClickProject(await bundleOf({ system: { startScene: 'a', scenes: [] } }));
    expect(diags[0]).toMatchObject({ file: POINTCLICK_SYSTEM_PATH, severity: 'error' });
    expect(diags[0]!.message).toContain('Format invalide');
  });

  it('signale une scène de départ inconnue et une scène introuvable', async () => {
    const diags = await validatePointClickProject(await bundleOf({ system: { startScene: 'zz', scenes: ['a', 'b'] } }));
    const errors = texts(diags, 'error');
    expect(errors.some((m) => m.includes('Scène de départ inconnue « zz »'))).toBe(true);
    expect(errors.some((m) => m.includes('Scène introuvable « b »'))).toBe(true);
  });

  it('signale un identifiant de scène différent du nom de fichier et des zones en double', async () => {
    const scene = baseScene({ id: 'autre' });
    scene.hotspots = [...(scene.hotspots ?? []), ...(scene.hotspots ?? [])];
    const errors = texts(await validatePointClickProject(await bundleOf({ scenes: { a: scene } })), 'error');
    expect(errors.some((m) => m.includes('différent du nom de fichier'))).toBe(true);
    expect(errors.some((m) => m.includes('« porte »') && m.includes('en double'))).toBe(true);
  });

  it('signale les objets inconnus dans les actions, récursivement', async () => {
    const diags = await withActions([
      { type: 'give', item: 'fantome' },
      {
        type: 'if',
        condition: 'True',
        then: [{ type: 'dialogue', choices: [{ text: 'Oui', actions: [{ type: 'remove', item: 'spectre' }] }] }],
        else: [{ type: 'give', item: 'ombre' }],
      },
    ]);
    const errors = texts(diags, 'error');
    for (const id of ['fantome', 'spectre', 'ombre']) {
      expect(
        errors.some((m) => m.includes(`« ${id} »`)),
        id,
      ).toBe(true);
    }
  });

  it('signale les scènes et zones inconnues (goto, hide, show)', async () => {
    const errors = texts(
      await withActions([
        { type: 'goto', scene: 'nulle-part' },
        { type: 'hide', hotspot: 'fantome' },
        { type: 'show', hotspot: 'porte', scene: 'ailleurs' },
        { type: 'end' },
      ]),
      'error',
    );
    expect(errors.some((m) => m.includes('scène inconnue « nulle-part »'))).toBe(true);
    expect(errors.some((m) => m.includes('zone inconnue « fantome »'))).toBe(true);
    expect(errors.some((m) => m.includes('scène inconnue « ailleurs »'))).toBe(true);
  });

  it("vérifie les références de l'onEnter et des combinaisons", async () => {
    const scene = baseScene({ onEnter: [{ type: 'give', item: 'fantome' }] });
    const items: ItemsFileInput = {
      ...BASE_ITEMS,
      combinations: [{ a: 'cle', b: 'inconnu', result: 'autre', actions: [{ type: 'hide', hotspot: 'xx' }] }],
    };
    const errors = texts(await validatePointClickProject(await bundleOf({ scenes: { a: scene }, items })), 'error');
    expect(errors.some((m) => m.includes('onEnter') && m.includes('« fantome »'))).toBe(true);
    expect(errors.some((m) => m.includes('Combinaison') && m.includes('« inconnu »'))).toBe(true);
    expect(errors.some((m) => m.includes('Combinaison') && m.includes('« autre »'))).toBe(true);
    expect(errors.some((m) => m.includes('zone inconnue « xx »'))).toBe(true);
  });

  it('signale les expressions qui ne se parsent pas', async () => {
    const errors = texts(
      await withActions([
        { type: 'set', var: 'x', value: '1 +' },
        { type: 'if', condition: '((', then: [{ type: 'end' }] },
      ]),
      'error',
    );
    expect(errors.filter((m) => m.includes('expression invalide'))).toHaveLength(2);
  });

  it('avertit pour has()/visited() inconnus, et pour les conditions invalides des interactions', async () => {
    const scene = baseScene();
    (scene.hotspots as { interactions: unknown[] }[])[0]!.interactions = [
      { condition: 'has("fantome") and visited("nulle")', actions: [{ type: 'end' }] },
      { condition: 'a b', actions: [{ type: 'end' }] },
    ];
    const diags = await validatePointClickProject(await bundleOf({ scenes: { a: scene } }));
    const warnings = texts(diags, 'warning');
    expect(warnings.some((m) => m.includes('has("fantome")'))).toBe(true);
    expect(warnings.some((m) => m.includes('visited("nulle")'))).toBe(true);
    expect(texts(diags, 'error').some((m) => m.includes('expression invalide'))).toBe(true);
  });

  it('avertit si un départ, un point d’approche ou une arrivée est hors de la zone de marche', async () => {
    const scene = baseScene({ playerStart: { x: 10, y: 10 } });
    const hotspots = scene.hotspots as { walkTo?: object; interactions: unknown[] }[];
    hotspots[0]!.walkTo = { x: 5, y: 5 };
    hotspots[0]!.interactions = [{ actions: [{ type: 'goto', scene: 'a', x: 1, y: 1 }] }];
    const warnings = texts(await validatePointClickProject(await bundleOf({ scenes: { a: scene } })), 'warning');
    expect(warnings.some((m) => m.includes('Départ du joueur'))).toBe(true);
    expect(warnings.some((m) => m.includes("point d'approche"))).toBe(true);
    expect(warnings.some((m) => m.includes('arrivée (1, 1)'))).toBe(true);
  });

  it('avertit pour les assets absents du registre', async () => {
    const warnings = texts(await validatePointClickProject(await bundleOf({ assets: [] })), 'warning');
    expect(warnings.some((m) => m.includes('image « fond » introuvable'))).toBe(true);
    expect(warnings.some((m) => m.includes('icône') && m.includes('« icone »'))).toBe(true);
  });

  it('signale un son inconnu et accepte un son connu', async () => {
    const warnings = texts(
      await withActions([{ type: 'sound', asset: 'son' }, { type: 'sound', asset: 'absent' }, { type: 'end' }]),
      'warning',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('« absent »');
  });

  it('un jeu sans action « end » reçoit une simple information', async () => {
    const scene = baseScene();
    (scene.hotspots as { interactions: unknown[] }[])[0]!.interactions = [];
    const diags = await validatePointClickProject(await bundleOf({ scenes: { a: scene } }));
    expect(texts(diags, 'info')).toHaveLength(1);
    expect(texts(diags, 'error')).toEqual([]);
  });
});

describe('loadPointClickProject', () => {
  it('charge un projet sans data/items.json (objets vides)', async () => {
    const data = await loadPointClickProject(await bundleOf({ items: null }));
    expect(data.items.items).toEqual([]);
    expect([...data.scenes.keys()]).toEqual(['a']);
  });

  it('lève des erreurs françaises claires', async () => {
    await expect(
      loadPointClickProject(await bundleOf({ system: { startScene: 'a', scenes: ['a', 'b'] } })),
    ).rejects.toThrow('Scène introuvable : « scenes/b.json »');
    await expect(loadPointClickProject(await bundleOf({ system: { startScene: 'a' } }))).rejects.toThrow(
      /Fichier invalide « data\/pointclick.json »/,
    );
    await expect(
      loadPointClickProject(await bundleOf({ system: { startScene: 'zz', scenes: ['a'] } })),
    ).rejects.toThrow('Scène de départ inconnue « zz »');
  });
});

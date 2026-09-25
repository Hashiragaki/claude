import {
  loadProjectBundle,
  MemoryProjectFiles,
  PROJECT_FORMAT,
  type AssetKind,
  type AssetMeta,
  type Diagnostic,
  type ProjectBundle,
  type ProjectTemplate,
} from '@forge/core';
import { describe, expect, it } from 'vitest';
import { LevelBuilder } from './levelBuilder';
import { PLATFORMER_SYSTEM_PATH, levelPath, type PlatformerLevelInput, type PlatformerSystemInput } from './schema';
import { PLATFORMER_TEMPLATES } from './templates';
import { validatePlatformerProject } from './validate';

/** Outils du test (voir `packages/mode-rpg/src/validate.test.ts` pour le modèle imité). */

const GENERATOR_KINDS: Record<string, AssetKind> = {
  'tileset.side': 'tileset',
  charset: 'charset',
  'image.svg': 'image',
  music: 'music',
  sfx: 'sfx',
};

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

/** Métadonnées d'assets fictives correspondant aux demandes d'un modèle de projet. */
function templateAssets(template: ProjectTemplate): AssetMeta[] {
  return template.assets.map((a, i) => asset(GENERATOR_KINDS[a.generator] ?? 'image', a.alias, `asset_${i}`));
}

/** Fichiers d'un modèle de projet, avec un manifeste complet. */
function templateFiles(template: ProjectTemplate): MemoryProjectFiles {
  const files = new MemoryProjectFiles();
  for (const f of template.files) files.write(f.path, f.content);
  files.write('project.json', {
    format: PROJECT_FORMAT,
    id: 'projet',
    name: template.name,
    mode: 'platformer',
    entry: template.manifest.entry,
    resolution: template.manifest.resolution,
    pixelArt: template.manifest.pixelArt,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: templateAssets(template),
  });
  return files;
}

/** Petit niveau valide (10×6), tileset et charset référencés par `baseAssets`. */
function baseLevel(id = 'lvl'): PlatformerLevelInput {
  return new LevelBuilder(id, 10, 6, 'tileset-test').ground(0, 9, 4).start(1, 3).goal(8, 3).build();
}

function baseSystem(overrides: Partial<PlatformerSystemInput> = {}): PlatformerSystemInput {
  return { title: 'Test', levels: ['lvl'], playerCharset: 'charset-test', ...overrides };
}

function baseAssets(): AssetMeta[] {
  return [asset('tileset', 'tileset-test', 'a1'), asset('charset', 'charset-test', 'a2')];
}

/** Bundle minimal (système + niveaux + assets), pour tester une règle à la fois. */
async function baseBundle(
  options: {
    system?: object;
    levels?: Record<string, object>;
    assets?: AssetMeta[];
  } = {},
): Promise<ProjectBundle> {
  const files = new MemoryProjectFiles();
  files.write(PLATFORMER_SYSTEM_PATH, options.system ?? baseSystem());
  const levels = options.levels ?? { lvl: baseLevel() };
  for (const [id, content] of Object.entries(levels)) files.write(levelPath(id), content);
  files.write('project.json', {
    format: PROJECT_FORMAT,
    id: 'projet',
    name: 'Test',
    mode: 'platformer',
    entry: PLATFORMER_SYSTEM_PATH,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: options.assets ?? baseAssets(),
  });
  return loadProjectBundle(files);
}

describe('validatePlatformerProject', () => {
  it('accepte les modèles de projet sans aucun diagnostic', async () => {
    for (const template of PLATFORMER_TEMPLATES) {
      const bundle = await loadProjectBundle(templateFiles(template));
      expect(await validatePlatformerProject(bundle), template.id).toEqual([]);
    }
  });

  it('signale un système illisible ou invalide (erreurs zod lisibles, avec chemin de fichier)', async () => {
    const bundle = await baseBundle({ system: { title: 'x', levels: [] } });
    const diags = await validatePlatformerProject(bundle);
    expect(diags[0]).toMatchObject({ file: PLATFORMER_SYSTEM_PATH, severity: 'error' });
    expect(diags[0]!.message).toMatch(/Format invalide/);

    const filesBrut = new MemoryProjectFiles();
    filesBrut.write(PLATFORMER_SYSTEM_PATH, '{ invalide');
    filesBrut.write(levelPath('lvl'), baseLevel());
    filesBrut.write('project.json', {
      format: PROJECT_FORMAT,
      id: 'projet',
      name: 'Test',
      mode: 'platformer',
      entry: PLATFORMER_SYSTEM_PATH,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      assets: baseAssets(),
    });
    const diagsBrut = await validatePlatformerProject(await loadProjectBundle(filesBrut));
    expect(diagsBrut[0]).toMatchObject({ file: PLATFORMER_SYSTEM_PATH, severity: 'error' });
    expect(diagsBrut[0]!.message).toMatch(/Lecture impossible/);
  });

  it('signale un niveau listé manquant', async () => {
    const bundle = await baseBundle({ system: baseSystem({ levels: ['lvl', 'absent'] }) });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Niveau introuvable « absent »')]));
  });

  it('signale un niveau de départ inconnu', async () => {
    const bundle = await baseBundle({ system: baseSystem({ startLevel: 'inconnu' }) });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Niveau de départ inconnu « inconnu »')]));
  });

  it('signale un niveau suivant inconnu', async () => {
    const level: PlatformerLevelInput = { ...baseLevel(), next: 'ailleurs' };
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Niveau suivant inconnu « ailleurs »')]));
  });

  it('signale une couche de taille différente de width × height', async () => {
    const level = baseLevel();
    level.layers.terrain = level.layers.terrain.slice(0, -1);
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Couche « terrain » : 59 tuile(s) au lieu de 60')]));
  });

  it('signale un index de tuile hors de [-1, 15]', async () => {
    const level = baseLevel();
    level.layers.terrain[0] = 99;
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('hors limites [-1, 15]')]));
  });

  it('signale des identifiants d\'entités en double', async () => {
    const level = baseLevel();
    level.entities = [
      ...level.entities!,
      { id: 'coin-x', type: 'coin', x: 2, y: 3 },
      { id: 'coin-x', type: 'coin', x: 3, y: 3 },
    ];
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('« coin-x » : identifiant en double')]));
  });

  it('signale une entité hors des limites du niveau', async () => {
    const level = baseLevel();
    level.entities = [...level.entities!, { id: 'coin-loin', type: 'coin', x: 50, y: 3 }];
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('« coin-loin » : position (50, 3) hors du niveau')]),
    );
  });

  it('signale un départ hors des limites du niveau', async () => {
    const level: PlatformerLevelInput = { ...baseLevel(), playerStart: { x: 50, y: 3 } };
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Départ : position (50, 3) hors du niveau')]));
  });

  it('signale un départ dans une tuile solide', async () => {
    const level = new LevelBuilder('lvl', 10, 6, 'tileset-test').fill(0, 0, 9, 5, 'brick').start(2, 2).goal(8, 2).build();
    const bundle = await baseBundle({ levels: { lvl: level } });
    const errors = texts(await validatePlatformerProject(bundle), 'error');
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Départ : position (2, 2) dans une tuile solide')]),
    );
  });

  it('avertit si le niveau n\'a aucune arrivée', async () => {
    const level = new LevelBuilder('lvl', 10, 6, 'tileset-test').ground(0, 9, 4).start(1, 3).build();
    const bundle = await baseBundle({ levels: { lvl: level } });
    const warnings = texts(await validatePlatformerProject(bundle), 'warning');
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('Aucune arrivée (« goal »)')]));
  });

  it('signale des références d\'assets inexistantes', async () => {
    const bundle = await baseBundle({ assets: [] });
    const warnings = texts(await validatePlatformerProject(bundle), 'warning');
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tileset : tileset « tileset-test » introuvable dans les assets'),
        expect.stringContaining('Charset du joueur : charset « charset-test » introuvable dans les assets'),
      ]),
    );
  });
});

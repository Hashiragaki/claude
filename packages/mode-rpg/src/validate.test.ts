import { AssetRegistry, MemoryProjectFiles, TILE, loadProjectBundle, type Diagnostic } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { RpgDatabaseSchema, RpgSystemSchema, type RpgMap } from './schema';
import { RPG_TEMPLATES, demoTemplate } from './templates';
import { TEST_DATABASE, grassMap, templateAssets, templateFiles } from './test-helpers';
import {
  interpolationExpressions,
  validateDatabase,
  validateMap,
  validateProject,
  validateSystem,
  type ValidationContext,
} from './validate';

const texts = (list: Diagnostic[], severity: Diagnostic['severity']) =>
  list.filter((d) => d.severity === severity).map((d) => d.message);

function context(maps: RpgMap[]): ValidationContext {
  return { database: RpgDatabaseSchema.parse(TEST_DATABASE), maps: new Map(maps.map((m) => [m.id, m])) };
}

describe('validation', () => {
  it('accepte les modèles de projet sans aucun diagnostic', async () => {
    for (const template of RPG_TEMPLATES) {
      const bundle = await loadProjectBundle(templateFiles(template));
      expect(await validateProject(bundle), template.id).toEqual([]);
    }
  });

  it('extrait les interpolations', () => {
    expect(interpolationExpressions('Or : [gold], [[littéral], [liste["a"]]')).toEqual(['gold', 'liste["a"]']);
  });

  it('signale les erreurs de carte et de commandes', () => {
    const map = grassMap('m', 5, 5)
      .event({
        id: 'a',
        x: 1,
        y: 1,
        pages: [
          {
            graphic: { tile: 77 },
            commands: [
              { type: 'text', text: 'Bonjour [nom +]' },
              { type: 'teleport', map: 'nulle_part', x: 0, y: 0 },
              { type: 'teleport', map: 'm', x: 9, y: 9 },
              { type: 'battle', troop: 'inconnu', onWin: [{ type: 'giveItem', item: 'epee' }] },
              { type: 'script', code: 'x = = 1' },
              { type: 'if', condition: { script: '1 +' }, then: [] },
              { type: 'choice', options: [{ label: 'A', commands: [] }], cancel: 3 },
              { type: 'moveRoute', target: 'fantome', steps: ['up'] },
            ],
          },
        ],
      })
      .event({ id: 'dehors', x: 10, y: 1, pages: [{}] })
      .encounters({ troops: ['inconnu'], onlyOnRole: 'lave' })
      .build();
    map.events.push({ ...structuredClone(map.events[0]!), x: 2 });
    map.layers.decor = [1, 2];
    map.layers.ground[0] = 99;
    const diags = validateMap(map, context([map]));
    expect(diags.every((d) => d.file === 'maps/m.json')).toBe(true);
    const errors = texts(diags, 'error');
    const patterns = [
      /Couche « decor » : 2 tuiles au lieu de 25/,
      /interpolation « \[nom \+\] » invalide/,
      /carte de destination introuvable « nulle_part »/,
      /destination \(9, 9\) hors de la carte/,
      /groupe d'ennemis inconnu « inconnu »/,
      /objet inconnu « epee »/,
      /script « x = = 1 » invalide/,
      /condition « 1 \+ » invalide/,
      /option d'annulation 3 hors limites/,
      /cible de trajet inconnue « fantome »/,
      /Événement « dehors » : position \(10, 1\) hors de la carte/,
      /Événement « a » : identifiant en double/,
      /Rencontres : groupe inconnu « inconnu »/,
    ];
    for (const p of patterns) expect(errors.some((m) => p.test(m)), p.source).toBe(true);
    const warnings = texts(diags, 'warning');
    expect(warnings.some((m) => /tuile\(s\) d'index inconnu/.test(m))).toBe(true);
    expect(warnings.some((m) => /rôle de tuile inconnu « lave »/.test(m))).toBe(true);
    expect(warnings.some((m) => /tuile 77 inconnue/.test(m))).toBe(true);
  });

  it('signale les références cassées de la base de données', () => {
    const db = RpgDatabaseSchema.parse({
      ...TEST_DATABASE,
      actors: [...(TEST_DATABASE.actors ?? []), { id: 'hero', name: 'Double', charset: 'c', skills: ['vol'] }],
      enemies: [{ id: 'loup', name: 'Loup', battler: 'b', skills: ['morsure'], drops: [{ item: 'os', chance: 0.5 }] }],
      troops: [{ id: 'meute', members: ['loup', 'ours'] }],
    });
    const errors = texts(validateDatabase(db), 'error');
    expect(errors).toEqual(
      expect.arrayContaining([
        'Acteurs : identifiant en double « hero ».',
        'Acteur « hero » : compétence inconnue « vol ».',
        'Ennemi « loup » : compétence inconnue « morsure ».',
        'Ennemi « loup » : butin inconnu « os ».',
        'Groupe « meute » : ennemi inconnu « ours ».',
      ]),
    );
  });

  it('vérifie le système (départ, équipe) et les assets', () => {
    const map = grassMap('m', 5, 5).set('decor', 2, 2, TILE.rock).build();
    const ctx = context([map]);
    const bad = RpgSystemSchema.parse({ startMap: 'm', startX: 2, startY: 2, party: ['fantome'], battleMusic: 'boum' });
    const errors = texts(validateSystem(bad, ctx), 'error');
    expect(errors).toEqual([
      'Position de départ (2, 2) infranchissable sur « m ».',
      'Équipe : acteur inconnu « fantome ».',
    ]);
    const missing = RpgSystemSchema.parse({ startMap: 'ailleurs', party: [] });
    expect(texts(validateSystem(missing, ctx), 'error')).toEqual([
      'Carte de départ introuvable « ailleurs » (maps/ailleurs.json).',
      'L\'équipe de départ est vide.',
    ]);
    const assets = new AssetRegistry(templateAssets(demoTemplate), new MemoryProjectFiles());
    const warnings = texts(validateSystem(bad, { ...ctx, assets }), 'warning');
    expect(warnings).toEqual(['battleMusic : musique « boum » introuvable dans les assets.']);
    const mapWarnings = texts(validateMap(map, { ...ctx, assets }), 'warning');
    expect(mapWarnings).toEqual(['Tileset : tileset « tiles test » introuvable dans les assets.']);
  });

  it('signale un système illisible ou invalide', async () => {
    const files = templateFiles(demoTemplate);
    files.write('data/system.json', { startMap: 12 });
    const diags = await validateProject(await loadProjectBundle(files));
    expect(diags[0]).toMatchObject({ file: 'data/system.json', severity: 'error' });
    files.write('data/system.json', '{ invalide');
    expect((await validateProject(await loadProjectBundle(files)))[0]?.message).toMatch(/Lecture impossible/);
  });
});

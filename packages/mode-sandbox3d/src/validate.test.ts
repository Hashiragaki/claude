import { MemoryProjectFiles, PROJECT_FORMAT, parseManifest, type ProjectBundle } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { validateSandbox3d } from './validate';

const asset = (id: string, kind: 'model' | 'music' | 'image', alias: string, animations?: string[]) => ({
  id,
  kind,
  name: alias,
  alias,
  file: `assets/${id}.${kind === 'model' ? 'glb' : kind === 'music' ? 'wav' : 'png'}`,
  mime: 'application/octet-stream',
  origin: 'template' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...(animations ? { params: { template: 'x', animations } } : {}),
});

function bundle(scene: unknown, entry = 'scenes/main.json'): ProjectBundle {
  const manifest = parseManifest({
    format: PROJECT_FORMAT,
    id: 'p1',
    name: 'Test 3D',
    mode: 'sandbox3d',
    entry: 'scenes/main.json',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets: [
      asset('m1', 'model', 'arbre', ['sway']),
      asset('m2', 'model', 'héros', ['idle', 'walk']),
      asset('m3', 'model', 'coffre'),
      asset('s1', 'music', 'thème'),
      asset('i1', 'image', 'fond'),
    ],
  });
  const files = new MemoryProjectFiles(scene === undefined ? {} : { [entry]: scene as string | object });
  return { manifest, files };
}

describe('validation', () => {
  it('ne signale rien pour une scène correcte', async () => {
    const diags = await validateSandbox3d(
      bundle({
        ground: { size: 20, color: '#55aa55' },
        player: { model: 'héros', idle: 'idle', walk: 'walk' },
        music: 'thème',
        objects: [
          { id: 'a1', model: 'arbre', position: [3, 0, 3], animation: 'sway' },
          { id: 'c1', model: 'coffre', position: [-3, 0, 1], interact: { text: 'Ouvert', animation: 'open' } },
        ],
      }),
    );
    expect(diags).toEqual([]);
  });

  it('signale un fichier de scène manquant ou un JSON invalide', async () => {
    expect((await validateSandbox3d(bundle(undefined)))[0]?.message).toContain('introuvable');
    const diags = await validateSandbox3d(bundle('{ "objects": [ }'));
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.message).toContain('JSON invalide');
  });

  it('transforme les erreurs de schéma en diagnostics localisés', async () => {
    const text = JSON.stringify(
      {
        objects: [
          { id: 'ok', model: 'arbre', position: [0, 0, 0] },
          { id: 'cassé', model: 'arbre', position: 'ici' },
        ],
      },
      null,
      2,
    );
    const diags = await validateSandbox3d(bundle(text));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ file: 'scenes/main.json', severity: 'error' });
    expect(diags[0]?.message).toMatch(/^objects\[1\]\.position : /);
    expect(diags[0]?.line).toBe(text.split('\n').findIndex((l) => l.includes('"cassé"')) + 1);
  });

  it('signale les références introuvables, de mauvais type, et les animations inconnues', async () => {
    const diags = await validateSandbox3d(
      bundle({
        ground: { size: 20, color: '#55aa55' },
        player: { model: 'dragon', walk: 'walk' },
        music: 'fond',
        objects: [
          { id: 'a1', model: 'arbre', position: [0, 0, 0], animation: 'danse' },
          { id: 'x1', model: 'maison', position: [1, 0, 1] },
        ],
      }),
    );
    const messages = diags.map((d) => `${d.severity}: ${d.message}`);
    expect(messages).toContain('error: Joueur : asset « dragon » introuvable');
    expect(messages).toContain('error: Musique : « fond » est un asset de type image, pas une musique');
    expect(messages).toContain('error: Objet « x1 » : asset « maison » introuvable');
    expect(messages.some((m) => m.startsWith('warning: Objet « a1 » : animation « danse » absente'))).toBe(true);
  });

  it('avertit pour les objets et le point d’apparition hors du sol', async () => {
    const diags = await validateSandbox3d(
      bundle({
        ground: { size: 10, color: '#55aa55' },
        spawn: { x: 0, z: 8 },
        objects: [
          { id: 'dedans', model: 'arbre', position: [4.9, 0, -4.9] },
          { id: 'dehors', model: 'arbre', position: [6, 0, 0] },
        ],
      }),
    );
    expect(diags.map((d) => d.severity)).toEqual(['warning', 'warning']);
    expect(diags[0]?.message).toContain('« dehors »');
    expect(diags[0]?.message).toContain('hors du sol');
    expect(diags[1]?.message).toContain('apparition');
  });
});

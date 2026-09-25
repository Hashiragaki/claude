import { AssetRegistry, InputManager, MemoryProjectFiles, PROJECT_FORMAT, loadProjectBundle } from '@forge/core';
import type { AssetKind, AssetMeta, ProjectTemplate, TemplateAssetRequest } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { compileSource } from './compiler';
import { vnMode } from './index';
import { VNInterpreter } from './interpreter';
import { HeadlessPresenter } from './presenter';
import { looksLikePath, resolveAudioAsset } from './refs';
import { VN_DEMO_SCRIPT, VN_TEMPLATES } from './templates';
import type { MenuStep, VNEffect } from './types';

const DATE = '2026-01-01T00:00:00.000Z';

function kindOf(req: TemplateAssetRequest): AssetKind {
  return req.generator === 'music' ? 'music' : req.generator === 'sfx' ? 'sfx' : 'image';
}

/** Asset tel que le serveur le créerait à partir d'une demande de modèle. */
function assetFromRequest(req: TemplateAssetRequest, i: number): AssetMeta {
  const kind = kindOf(req);
  const image = kind === 'image';
  return {
    id: `asset_${i}`,
    kind,
    name: req.name,
    alias: req.alias,
    file: `assets/${i}.${image ? 'png' : 'wav'}`,
    extra: {},
    mime: image ? 'image/png' : 'audio/wav',
    tags: req.tags ?? [],
    origin: 'template',
    version: 1,
    info: {},
    createdAt: DATE,
  };
}

interface BundleOptions {
  files?: Record<string, string>;
  assets?: AssetMeta[];
}

async function bundleFor(template: ProjectTemplate, options: BundleOptions = {}) {
  const files = new MemoryProjectFiles({
    'project.json': {
      format: PROJECT_FORMAT,
      id: 'projet',
      name: 'Projet test',
      mode: 'vn',
      entry: template.manifest.entry,
      createdAt: DATE,
      updatedAt: DATE,
      assets: options.assets ?? template.assets.map(assetFromRequest),
    },
    ...Object.fromEntries(template.files.map((f) => [f.path, f.content])),
    ...options.files,
  });
  return loadProjectBundle(files);
}

function template(id: string): ProjectTemplate {
  const t = VN_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`modèle ${id} introuvable`);
  return t;
}

/** Joue la démo en suivant les choix donnés, jusqu'à la fin. */
function playDemo(choices: number[]) {
  const { program } = compileSource(VN_DEMO_SCRIPT, 'scripts/script.vn');
  const interp = new VNInterpreter(program);
  const texts: string[] = [];
  const speakers = new Set<string>();
  const menus: MenuStep[] = [];
  const effects: VNEffect[] = [];
  const queue = [...choices];
  let step = interp.start();
  for (let guard = 0; step.kind !== 'end'; guard++) {
    if (guard > 500) throw new Error('la démo ne se termine pas');
    effects.push(...step.effects);
    if (step.kind === 'menu') {
      menus.push(step);
      const choice = queue.shift();
      if (choice === undefined) throw new Error('choix manquant');
      step = interp.choose(choice);
      continue;
    }
    if (step.kind === 'say') {
      texts.push(step.text);
      if (step.speaker) speakers.add(step.speaker.name);
    }
    step = interp.advance();
  }
  return { interp, texts, speakers, menus, effects };
}

describe('vnMode', () => {
  it('décrit le mode et ses modèles', () => {
    expect(vnMode).toMatchObject({ id: 'vn', name: 'Visual Novel' });
    expect(vnMode.description).toMatch(/Ren'Py/);
    expect(VN_TEMPLATES.map((t) => [t.id, t.name])).toEqual([
      ['vn-blank', 'Visual novel vide'],
      ['vn-demo', 'Démo : Le Café des Étoiles'],
    ]);
    for (const t of VN_TEMPLATES) {
      expect(t.manifest).toMatchObject({
        resolution: { width: 1280, height: 720 },
        pixelArt: false,
        entry: 'scripts/script.vn',
      });
      expect(t.files.map((f) => f.path)).toEqual(['scripts/script.vn']);
    }
  });

  it('déclare des assets de modèle cohérents (alias uniques, graines entières, paramètres attendus)', () => {
    for (const t of VN_TEMPLATES) {
      const aliases = t.assets.map((a) => a.alias);
      expect(new Set(aliases).size).toBe(aliases.length);
      for (const a of t.assets) {
        expect(Number.isInteger(a.seed)).toBe(true);
        expect(['image.svg', 'music', 'sfx']).toContain(a.generator);
        expect(typeof a.params.prompt).toBe('string');
        if (a.params.subject === 'background') {
          expect(a.params).toMatchObject({ width: 1280, height: 720 });
          expect(a.tags).toEqual(['bg']);
        } else if (a.params.subject === 'portrait') {
          expect(a.params).toMatchObject({ width: 600, height: 900, character: expect.any(String) });
          expect(['neutral', 'happy', 'sad', 'angry', 'surprised', 'embarrassed']).toContain(a.params.expression);
          expect(a.tags).toEqual(['character']);
        }
      }
    }
    const demo = template('vn-demo');
    expect(demo.assets.filter((a) => a.params.subject === 'background')).toHaveLength(3);
    expect(demo.assets.find((a) => a.alias === 'mina')?.params.expression).toBe('neutral');
  });

  it('valide les modèles sans aucun diagnostic', async () => {
    for (const t of VN_TEMPLATES) {
      expect(await vnMode.validate!(await bundleFor(t))).toEqual([]);
    }
  });

  it('signale les images et sons introuvables', async () => {
    const diags = await vnMode.validate!(await bundleFor(template('vn-blank'), { assets: [] }));
    expect(diags).toEqual([
      expect.objectContaining({
        file: 'scripts/script.vn',
        line: 7,
        severity: 'warning',
        message: expect.stringMatching(/Image introuvable : « bg parc »/),
      }),
      expect.objectContaining({ line: 8, severity: 'warning', message: expect.stringMatching(/« alice »/) }),
    ]);
    const demo = await vnMode.validate!(await bundleFor(template('vn-demo'), { assets: [] }));
    expect(demo.filter((d) => /Son introuvable/.test(d.message)).map((d) => d.message)).toHaveLength(5);
  });

  it('suit les include et rapporte les erreurs de chaque fichier', async () => {
    const t: ProjectTemplate = {
      ...template('vn-blank'),
      files: [
        {
          path: 'scripts/script.vn',
          content: 'include "scripts/chapitre2.vn"\ninclude "absent.vn"\nlabel start:\n    jump chapitre2\n',
        },
      ],
    };
    const diags = await vnMode.validate!(
      await bundleFor(t, {
        files: {
          'scripts/chapitre2.vn': 'include "script.vn"\nlabel chapitre2:\n    show bg inconnu\n    oups "x"\n',
        },
      }),
    );
    expect(diags.map((d) => [d.file, d.line, d.severity, d.message])).toEqual([
      ['scripts/script.vn', 2, 'error', 'Fichier inclus introuvable : « absent.vn »'],
      ['scripts/chapitre2.vn', 4, 'error', expect.stringMatching(/Personnage « oups » non défini/)],
      ['scripts/chapitre2.vn', 3, 'warning', expect.stringMatching(/Image introuvable : « bg inconnu »/)],
    ]);
  });

  it("signale un script d'entrée manquant", async () => {
    const t: ProjectTemplate = { ...template('vn-blank'), files: [] };
    const diags = await vnMode.validate!(await bundleFor(t));
    expect(diags).toContainEqual(
      expect.objectContaining({ severity: 'error', message: 'Script introuvable : « scripts/script.vn »' }),
    );
  });

  it("n'importe ni pixi.js ni render2d statiquement depuis index.ts", async () => {
    const fs = (await import(/* @vite-ignore */ String('node:fs'))) as {
      readFileSync(path: URL, encoding: 'utf8'): string;
    };
    const seen = new Set<string>();
    const pending = ['index.ts'];
    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)) {
        const spec = match[1] as string;
        expect(spec, `${file} importe ${spec}`).not.toMatch(/pixi|render2d/);
        if (spec.startsWith('./')) pending.push(`${spec.slice(2)}.ts`);
      }
    }
    expect(seen.has('runtime.ts')).toBe(false);
    expect(seen.has('interpreter.ts')).toBe(true);
  });
});

describe('démo « Le Café des Étoiles »', () => {
  it('compile sans erreur ni avertissement', () => {
    expect(compileSource(VN_DEMO_SCRIPT, 'scripts/script.vn').diagnostics).toEqual([]);
    const lines = VN_DEMO_SCRIPT.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(60);
    expect(lines.length).toBeLessThanOrEqual(100);
  });

  it('mène à la fin « Sous les étoiles » avec le chocolat chaud', () => {
    const { interp, texts, speakers, menus, effects } = playDemo([0, 0]);
    expect(speakers).toEqual(new Set(['Mina', 'Sacha', 'Léo']));
    expect(texts).toContain("Moi, c'est Sacha. Joli nom, pour un café.");
    expect(texts).toContain('Le Café des Étoiles');
    expect(texts).toContain("Quelques minutes plus tard, Mina m'apporte mon chocolat chaud.");
    expect(texts).toContain("Reste autant que tu veux, la pluie ne va pas s'arrêter de sitôt.");
    expect(menus[1]?.choices.map((c) => c.enabled)).toEqual([true, true]);
    expect(texts.at(-1)).toBe('Fin : Sous les étoiles');
    expect(interp.getVariables()).toMatchObject({ affection: 2, boisson: 'chocolat chaud' });
    expect(interp.state.audio).toEqual({ music: 'musique etoiles' });
    expect(effects).toContainEqual({ type: 'play', channel: 'sound', ref: 'clochette', fadein: null, loop: false });
    expect(effects).toContainEqual(
      expect.objectContaining({
        type: 'show',
        image: expect.objectContaining({ tag: 'leo', position: 'left' }),
        transition: 'moveinleft',
      }),
    );
  });

  it('mène à la même fin avec le thé aux étoiles (branche if)', () => {
    const { texts, interp } = playDemo([2, 0]);
    expect(texts).toContain("Tu sais, Sacha, c'est rare qu'un client me fasse autant confiance.");
    expect(interp.getVariables().affection).toBe(3);
    expect(texts.at(-1)).toBe('Fin : Sous les étoiles');
  });

  it("mène à la fin « Un soir de pluie » avec le verre d'eau (choix conditionnel verrouillé)", () => {
    const { texts, menus, interp } = playDemo([1, 1]);
    expect(menus[0]?.caption).toEqual({
      speaker: { name: 'Mina', color: '#f48fb1' },
      text: "Qu'est-ce que je te sers ?",
    });
    expect(menus[1]?.choices).toEqual([
      { text: "Proposer à Mina d'aller voir les étoiles filantes.", enabled: false },
      { text: 'Rentrer chez moi avant la prochaine averse.', enabled: true },
    ]);
    expect(texts).toContain("Tu as l'air pressé… Tu es sûr de ne pas vouloir rester un peu ?");
    expect(texts.at(-1)).toBe('Fin : Un soir de pluie');
    expect(interp.getVariables().affection).toBe(1);
    expect(interp.scene).toEqual({ background: 'bg rue', images: [] });
  });
});

describe('références et affichage sans écran', () => {
  it('résout les sons par canal puis par tout type, et reconnaît les chemins', () => {
    const reqs: TemplateAssetRequest[] = [
      { alias: 'theme', name: 'Thème', generator: 'music', params: {}, seed: 1 },
      { alias: 'porte', name: 'Porte', generator: 'sfx', params: {}, seed: 2 },
    ];
    const registry = new AssetRegistry(reqs.map(assetFromRequest), new MemoryProjectFiles());
    expect(resolveAudioAsset(registry, 'theme', 'music')?.kind).toBe('music');
    expect(resolveAudioAsset(registry, 'porte', 'sound')?.kind).toBe('sfx');
    expect(resolveAudioAsset(registry, 'porte', 'music')?.alias).toBe('porte');
    expect(resolveAudioAsset(registry, 'absent', 'voice')).toBeUndefined();
    expect([looksLikePath('audio/theme.wav'), looksLikePath('musique cafe')]).toEqual([true, false]);
  });

  it('accepte les images intégrées black / white sans avertissement', async () => {
    const t: ProjectTemplate = {
      ...template('vn-blank'),
      files: [{ path: 'scripts/script.vn', content: 'label start:\n    scene black with fade\n    scene white\n' }],
    };
    expect(await vnMode.validate!(await bundleFor(t))).toEqual([]);
  });

  it('navigue dans les menus au clavier en mode sans affichage', () => {
    const presenter = new HeadlessPresenter();
    const input = new InputManager();
    const choices = [
      { text: 'A', enabled: false },
      { text: 'B', enabled: true },
      { text: 'C', enabled: true },
    ];
    presenter.showMenu({ kind: 'menu', caption: null, choices, effects: [] });
    input.tap('down');
    input.update();
    expect(presenter.pollMenu(input)).toBeNull();
    input.tap('confirm');
    input.update();
    expect(presenter.pollMenu(input)).toBe(2);
    input.tap('down');
    input.update();
    presenter.pollMenu(input);
    input.tap('confirm');
    input.update();
    // Le choix désactivé « A » est sauté.
    expect(presenter.pollMenu(input)).toBe(1);
  });
});

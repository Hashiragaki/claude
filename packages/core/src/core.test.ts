import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './assets';
import { Engine } from './engine';
import { I18n } from './i18n';
import { slugify } from './ids';
import { InputManager } from './input';
import { GameLoop } from './loop';
import { ModeRegistry, type GameModeDefinition } from './mode';
import { MemoryProjectFiles, PROJECT_FORMAT, loadProjectBundle, normalizeProjectPath, type AssetMeta } from './project';
import { Rng } from './rng';
import { MemorySaveStorage, SaveManager } from './save';

const asset = (over: Partial<AssetMeta>): AssetMeta => ({
  id: 'a1',
  kind: 'image',
  name: 'Alice',
  file: 'assets/alice.png',
  extra: {},
  mime: 'image/png',
  tags: [],
  origin: 'procedural',
  version: 1,
  info: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('Rng', () => {
  it('est déterministe pour une graine donnée', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(new Rng('forêt').int(0, 1000)).toBe(new Rng('forêt').int(0, 1000));
  });

  it('respecte les bornes', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('utilitaires', () => {
  it('slugify retire accents et ponctuation', () => {
    expect(slugify('Épée de feu !')).toBe('epee-de-feu');
    expect(slugify('***')).toBe('asset');
  });

  it('normalizeProjectPath interdit les remontées', () => {
    expect(normalizeProjectPath('./a//b/c.png')).toBe('a/b/c.png');
    expect(() => normalizeProjectPath('../secret')).toThrow();
  });

  it('i18n traduit avec paramètres et repli', () => {
    const i18n = new I18n('en', 'fr');
    expect(i18n.t('battle.damage', { target: 'Slime', value: 5 })).toBe('Slime takes 5 damage.');
    i18n.extend('fr', { 'only.fr': 'Seulement FR' });
    expect(i18n.t('only.fr')).toBe('Seulement FR');
    expect(i18n.t('missing.key')).toBe('missing.key');
  });
});

describe('AssetRegistry', () => {
  it('résout id, alias et préfixes d\'alias (attributs Ren\'Py)', () => {
    const files = new MemoryProjectFiles();
    const reg = new AssetRegistry(
      [asset({ id: 'a1', alias: 'alice' }), asset({ id: 'a2', alias: 'Alice  Joyeuse' }), asset({ id: 'b1', alias: 'bg parc' })],
      files,
    );
    expect(reg.resolve('a1')?.id).toBe('a1');
    expect(reg.resolve('alice joyeuse')?.id).toBe('a2');
    expect(reg.resolve('alice triste')?.id).toBe('a1');
    expect(reg.resolve('bg parc', 'sfx')).toBeUndefined();
    expect(reg.resolve('assets/alice.png')?.id).toBe('a1');
  });
});

describe('InputManager', () => {
  it('détecte justPressed une seule frame', () => {
    const input = new InputManager();
    input.press('confirm');
    input.update();
    expect(input.justPressed('confirm')).toBe(true);
    expect(input.isDown('confirm')).toBe(true);
    input.update();
    expect(input.justPressed('confirm')).toBe(false);
    input.release('confirm');
    input.update();
    expect(input.isDown('confirm')).toBe(false);
    input.tap('cancel');
    input.update();
    expect(input.justPressed('cancel')).toBe(true);
    expect(input.isDown('cancel')).toBe(false);
  });
});

describe('GameLoop', () => {
  it('exécute des pas fixes', () => {
    let updates = 0;
    const loop = new GameLoop({ update: () => updates++, fixedStep: 0.1 });
    loop.step(0.35);
    expect(updates).toBe(3);
    loop.step(0.05);
    expect(updates).toBe(4);
  });
});

describe('SaveManager', () => {
  it('sauvegarde, liste et recharge', async () => {
    const saves = new SaveManager(new MemorySaveStorage(), 'p1', 'vn');
    await saves.save('1', { label: 'start' }, 'Chapitre 1', 12);
    await saves.save('2', { label: 'end' }, 'Chapitre 2', 30);
    const list = await saves.list();
    expect(list.map((s) => s.slot).sort()).toEqual(['1', '2']);
    expect((await saves.load('2'))?.state).toEqual({ label: 'end' });
    await saves.remove('1');
    expect(await saves.load('1')).toBeNull();
  });
});

describe('Engine', () => {
  it('charge un projet et exécute le mode correspondant', async () => {
    const files = new MemoryProjectFiles({
      'project.json': {
        format: PROJECT_FORMAT,
        id: 'p1',
        name: 'Test',
        mode: 'counter',
        entry: 'data.json',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      'data.json': { start: 5 },
    });
    let count = 0;
    const mode: GameModeDefinition = {
      id: 'counter',
      name: 'Compteur',
      description: 'test',
      templates: [],
      createRuntime: (ctx) => ({
        async start() {
          count = (await ctx.bundle.files.readJson<{ start: number }>(ctx.bundle.manifest.entry)).start;
        },
        update() {
          if (ctx.input.justPressed('confirm')) count++;
        },
        destroy() {},
        serialize: () => ({ count }),
        deserialize: (s) => {
          count = (s as { count: number }).count;
        },
        getDebugState: () => ({ count }),
      }),
    };
    const bundle = await loadProjectBundle(files);
    expect(bundle.manifest.resolution).toEqual({ width: 1280, height: 720 });
    const engine = new Engine({ bundle, modes: new ModeRegistry([mode]), autoLoop: false, saveStorage: new MemorySaveStorage() });
    await engine.start();
    expect(count).toBe(5);
    engine.input.tap('confirm');
    engine.step(1 / 60);
    expect(engine.debugState()).toEqual({ count: 6 });
    await engine.save('quick');
    engine.input.tap('confirm');
    engine.step(1 / 60);
    expect(count).toBe(7);
    await engine.load('quick');
    expect(count).toBe(6);
    engine.destroy();
  });
});

import {
  loadProjectBundle,
  MemoryProjectFiles,
  PROJECT_FORMAT,
  type AssetKind,
  type AssetMeta,
  type ProjectTemplate,
} from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadPointClickProject } from './loader';
import { POINTCLICK_SYSTEM_PATH } from './schema';
import { PointClickSession } from './session';
import { POINTCLICK_TEMPLATES, pointClickDemoTemplate } from './templates';
import type { PointClickData } from './types';
import { validatePointClickProject } from './validate';

/**
 * `@forge/mode-pointclick` ne dépend pas de `@forge/generators` : les schémas ci-dessous reproduisent
 * localement les paramètres acceptés par les générateurs utilisés (voir `packages/generators/src`).
 */
const HEX6 = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const GENERATOR_SCHEMAS: Record<string, z.ZodType> = {
  charset: z.object({
    prompt: z.string(),
    skinTone: HEX6.optional(),
    hairColor: HEX6.optional(),
    outfitColor: HEX6.optional(),
    hairStyle: z.enum(['short', 'long', 'spiky', 'bald', 'ponytail', 'hood']).optional(),
    outfitStyle: z.enum(['tunic', 'robe', 'armor', 'dress']).optional(),
    accessory: z.enum(['none', 'hat', 'helmet', 'crown', 'glasses']).optional(),
  }),
  'image.svg': z.object({
    prompt: z.string(),
    subject: z.enum(['background', 'portrait', 'battler', 'object', 'icon', 'illustration']),
    width: z.number().int().min(16).max(2048).optional(),
    height: z.number().int().min(16).max(2048).optional(),
    character: z.string().optional(),
    hairStyle: z.enum(['short', 'long', 'spiky', 'bald', 'ponytail', 'hood']).optional(),
    scene: z
      .enum(['cafe', 'street', 'park', 'bedroom', 'classroom', 'forest', 'beach', 'castle', 'space', 'generic'])
      .optional(),
    timeOfDay: z.enum(['day', 'sunset', 'night']).optional(),
  }),
  music: z.object({
    prompt: z.string(),
    mood: z.enum(['calm', 'happy', 'tense', 'sad', 'epic', 'mysterious', 'battle', 'village']),
    bars: z.number().int().min(4).max(32),
  }),
  sfx: z.object({
    prompt: z.string(),
    preset: z.enum([
      'coin',
      'laser',
      'explosion',
      'powerup',
      'hit',
      'jump',
      'blip',
      'select',
      'cancel',
      'door',
      'step',
      'magic',
      'random',
    ]),
  }),
};

const KINDS: Record<string, AssetKind> = {
  charset: 'charset',
  'image.svg': 'image',
  music: 'music',
  sfx: 'sfx',
};

function templateBundle(template: ProjectTemplate) {
  const files = new MemoryProjectFiles();
  for (const f of template.files) files.write(f.path, f.content);
  const assets: AssetMeta[] = template.assets.map((a, i) => ({
    id: `asset_${i}`,
    kind: KINDS[a.generator] ?? 'image',
    name: a.name,
    alias: a.alias,
    file: `asset_${i}.bin`,
    extra: {},
    mime: 'application/octet-stream',
    tags: [],
    origin: 'template',
    version: 1,
    info: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  files.write('project.json', {
    format: PROJECT_FORMAT,
    id: 'projet',
    name: template.name,
    mode: 'pointclick',
    entry: template.manifest.entry,
    resolution: template.manifest.resolution,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assets,
  });
  return loadProjectBundle(files);
}

describe('modèles point & click', () => {
  it('ont une entrée, une résolution 1280×720 et des alias uniques en kebab-case', () => {
    for (const template of POINTCLICK_TEMPLATES) {
      expect(template.manifest.entry).toBe(POINTCLICK_SYSTEM_PATH);
      expect(template.manifest.resolution).toEqual({ width: 1280, height: 720 });
      const seen = new Set<string>();
      for (const asset of template.assets) {
        expect(asset.alias, `${template.id} : alias « ${asset.alias} »`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(seen.has(asset.alias), `${template.id} : alias en double « ${asset.alias} »`).toBe(false);
        seen.add(asset.alias);
      }
    }
  });

  it("les paramètres d'assets sont acceptés par les générateurs", () => {
    for (const template of POINTCLICK_TEMPLATES) {
      for (const asset of template.assets) {
        const schema = GENERATOR_SCHEMAS[asset.generator];
        expect(schema, `${template.id} / ${asset.alias} : générateur « ${asset.generator} » non prévu`).toBeDefined();
        const result = schema!.safeParse(asset.params);
        expect(result.success, `${template.id} / ${asset.alias} : ${result.success ? '' : result.error.message}`).toBe(
          true,
        );
      }
    }
  });

  it('passent la validation sans erreur ni avertissement', async () => {
    for (const template of POINTCLICK_TEMPLATES) {
      const bundle = await templateBundle(template);
      const diagnostics = await validatePointClickProject(bundle);
      expect(
        diagnostics.filter((d) => d.severity !== 'info'),
        template.id,
      ).toEqual([]);
    }
  });

  it('la démo a 3 à 4 scènes, 4 à 6 objets et au moins une combinaison', async () => {
    const data = await loadPointClickProject(await templateBundle(pointClickDemoTemplate));
    expect(data.scenes.size).toBeGreaterThanOrEqual(3);
    expect(data.scenes.size).toBeLessThanOrEqual(4);
    expect(data.items.items.length).toBeGreaterThanOrEqual(4);
    expect(data.items.items.length).toBeLessThanOrEqual(6);
    expect(data.items.combinations.length).toBeGreaterThanOrEqual(1);
  });
});

/** Joueur automatique : clique au centre d'une zone puis laisse le personnage arriver. */
class Player {
  readonly logs: string[] = [];
  readonly session: PointClickSession;

  constructor(data: PointClickData) {
    this.session = new PointClickSession(data, { log: (level, message) => this.logs.push(`${level} : ${message}`) });
    this.session.start();
  }

  get phase() {
    return this.session.view().phase;
  }

  get scene() {
    return this.session.view().scene.id;
  }

  private settle(): void {
    for (let i = 0; i < 400 && this.phase === 'walking'; i++) this.session.update(0.1);
  }

  /** Passe toutes les bulles en attente et retourne leurs textes. */
  skip(): string[] {
    const texts: string[] = [];
    for (let i = 0; i < 50 && this.phase === 'message'; i++) {
      texts.push(this.session.view().message?.text ?? '');
      this.session.advance();
    }
    return texts;
  }

  click(hotspotId: string, verb: 'interact' | 'look' = 'interact'): void {
    const hotspot = this.session.view().hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) throw new Error(`Zone « ${hotspotId} » absente de « ${this.scene} »`);
    const { x, y, w, h } = hotspot.bounds;
    this.session.click({ x: x + w / 2, y: y + h / 2 }, verb);
    this.settle();
  }

  use(itemId: string, hotspotId: string): void {
    this.session.selectItem(itemId);
    this.click(hotspotId);
  }

  choose(text: string): void {
    const option = this.session.view().choice?.options.find((o) => o.text === text);
    if (!option) throw new Error(`Choix « ${text} » indisponible`);
    this.session.choose(option.index);
  }

  get inventory(): string[] {
    return this.session.view().inventory.map((i) => i.id);
  }
}

describe('démo « Le Phare oublié »', () => {
  it('est gagnable en suivant la solution, clic par clic', async () => {
    const data = await loadPointClickProject(await templateBundle(pointClickDemoTemplate));
    const p = new Player(data);

    // Plage : introduction, fiole sous la serviette, lentille sous l'étoile de mer.
    expect(p.phase).toBe('message');
    p.skip();
    expect(p.scene).toBe('plage');
    p.click('serviette');
    p.skip();
    p.click('fiole');
    p.skip();
    expect(p.inventory).toEqual(['huile']);
    p.click('etoile');
    p.skip();
    expect(p.inventory).toEqual(['huile', 'lentille']);

    // Cabane : mèche dans le tiroir, dialogue avec le gardien pour obtenir la clé.
    p.click('vers-cabane');
    expect(p.scene).toBe('cabane');
    p.click('tiroir');
    p.skip();
    expect(p.inventory).toContain('meche');
    p.click('gardien');
    expect(p.phase).toBe('choice');
    // La clé n'est pas proposée avant d'avoir posé la question sur le phare.
    expect(p.session.view().choice?.options.map((o) => o.text)).not.toContain('Pourriez-vous m’ouvrir le phare ?');
    p.choose('Qui êtes-vous ?');
    p.skip();
    p.click('gardien');
    p.choose('Pourquoi le phare est-il éteint ?');
    p.skip();
    p.click('gardien');
    expect(p.session.view().choice?.options.map((o) => o.text)).not.toContain('Qui êtes-vous ?');
    p.choose('Pourriez-vous m’ouvrir le phare ?');
    p.skip();
    expect(p.inventory).toContain('cle');

    // Combinaison mèche + huile.
    p.session.selectItem('meche');
    p.session.useItemOnItem('huile');
    p.skip();
    expect(p.inventory).toContain('torche');
    expect(p.inventory).not.toContain('huile');

    // Porte verrouillée sans la clé, puis ouverture avec la clé.
    p.click('sortie');
    expect(p.scene).toBe('plage');
    p.click('vers-phare');
    expect(p.scene).toBe('phare');
    p.click('porte');
    expect(p.skip()[0]).toContain('verrouillée');
    expect(p.scene).toBe('phare');
    p.use('cle', 'porte');
    p.skip();
    expect(p.scene).toBe('falaise');
    p.skip();

    // Sommet : sans lentille la torche est inutile, puis on gagne.
    p.use('torche', 'fanal');
    expect(p.skip()[0]).toContain('Sans lentille');
    expect(p.phase).toBe('explore');
    p.use('lentille', 'fanal');
    p.skip();
    p.use('torche', 'fanal');
    p.skip();
    expect(p.phase).toBe('ended');
    expect(p.session.view().endText).toContain('Le phare brille');
    expect(p.logs).toEqual([]);
  });
});

import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodePng, isPng, resvgContext } from '../shared/test-utils';
import { anim2dGenerator as gen } from './generator';
import { proceduralAnim } from './procedural';
import { ANIM_SUBJECTS, anim2dParamsSchema, anim2dSpecSchema, type Anim2dSpec, type AnimKey } from './schema';
import { buildAtlas, buildSheetSvg, namespaceIds, poseAt, sheetLayout } from './sheet';

/** Spec écrite à la main, façon Claude qui répond au system prompt (2 pièces, 1 animation en boucle). */
const claudeLikeSpec: Anim2dSpec = {
  width: 32,
  height: 32,
  fps: 12,
  parts: [
    { id: 'body', svg: '<circle cx="16" cy="16" r="10" fill="#4cc46a"/>', pivot: [16, 16] },
    { id: 'glow', svg: '<circle id="c" cx="16" cy="16" r="14" fill="#ffffff" opacity="0.4"/>', pivot: [16, 16] },
  ],
  animations: [
    {
      name: 'idle',
      frames: 4,
      loop: true,
      keys: [
        { part: 'body', frame: 0, translate: [0, 0], scale: [1, 1] },
        { part: 'body', frame: 2, translate: [0, -4], scale: [1.1, 0.9] },
        { part: 'body', frame: 4, translate: [0, 0], scale: [1, 1] },
        { part: 'glow', frame: 0, opacity: 0.6, rotate: 0 },
        { part: 'glow', frame: 4, opacity: 0.2, rotate: 90 },
      ],
    },
  ],
};

describe('anim2d — schémas', () => {
  it('applique les valeurs par défaut des paramètres', () => {
    expect(anim2dParamsSchema.parse({})).toEqual({
      prompt: '',
      subject: 'effect',
      width: 96,
      height: 96,
      frames: 8,
      fps: 10,
      animations: ['idle'],
    });
  });

  it('convertit le schéma de spec en JSON Schema (entrée outil pour Claude)', () => {
    expect(() => z.toJSONSchema(anim2dSpecSchema, { io: 'input' })).not.toThrow();
    const json = z.toJSONSchema(anim2dSpecSchema, { io: 'input' }) as { type?: string; properties?: Record<string, unknown> };
    expect(json.type).toBe('object');
    expect(Object.keys(json.properties ?? {})).toEqual(expect.arrayContaining(['width', 'height', 'fps', 'parts', 'animations']));
  });
});

describe('anim2d — poseAt', () => {
  it('interpole linéairement une propriété entre deux clés', () => {
    const keys: AnimKey[] = [
      { part: 'p', frame: 0, translate: [0, 0] },
      { part: 'p', frame: 10, translate: [20, -10] },
    ];
    expect(poseAt(keys, 5).translate).toEqual([10, -5]);
    expect(poseAt(keys, 2.5).translate).toEqual([5, -2.5]);
    expect(poseAt(keys, 0).translate).toEqual([0, 0]);
    expect(poseAt(keys, 10).translate).toEqual([20, -10]);
  });

  it('maintient la valeur de repos avant la première clé et la dernière valeur après la dernière', () => {
    const keys: AnimKey[] = [
      { part: 'p', frame: 4, rotate: 30 },
      { part: 'p', frame: 8, rotate: 90 },
    ];
    expect(poseAt(keys, 0).rotate).toBe(30);
    expect(poseAt(keys, 4).rotate).toBe(30);
    expect(poseAt(keys, 6).rotate).toBe(60);
    expect(poseAt(keys, 8).rotate).toBe(90);
    expect(poseAt(keys, 20).rotate).toBe(90);
  });

  it('interpole chaque propriété indépendamment : une clé qui ne fixe que rotate n’affecte pas translate', () => {
    const keys: AnimKey[] = [
      { part: 'p', frame: 0, rotate: 0 },
      { part: 'p', frame: 10, rotate: 90 },
    ];
    const pose = poseAt(keys, 5);
    expect(pose.rotate).toBe(45);
    expect(pose.translate).toEqual([0, 0]);
    expect(pose.scale).toEqual([1, 1]);
    expect(pose.opacity).toBe(1);
  });
});

describe('anim2d — espace de noms des ids internes', () => {
  it('préfixe les ids déclarés dans un fragment (id, url(#…), href="#…")', () => {
    const fragment = '<circle id="c" fill="red"/><use href="#c"/><rect fill="url(#c)"/>';
    const out = namespaceIds(fragment, 'body-');
    expect(out).toContain('id="body-c"');
    expect(out).toContain('href="#body-c"');
    expect(out).toContain('url(#body-c)');
    expect(out).not.toMatch(/[^-]id="c"/);
  });

  it('ne produit aucun id en double dans la planche même si deux pièces réutilisent le même id interne', () => {
    const spec: Anim2dSpec = {
      width: 24,
      height: 24,
      fps: 8,
      parts: [
        { id: 'a', svg: '<circle id="dot" cx="12" cy="12" r="4" fill="#fff"/>', pivot: [12, 12] },
        { id: 'b', svg: '<circle id="dot" cx="12" cy="12" r="6" fill="#000"/>', pivot: [12, 12] },
      ],
      animations: [{ name: 'idle', frames: 2, loop: true, keys: [] }],
    };
    expect(anim2dSpecSchema.safeParse(spec).success).toBe(true);
    const svg = buildSheetSvg(spec);
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('a-dot');
    expect(ids).toContain('b-dot');
  });
});

describe('anim2d — mise en page de la planche', () => {
  it('la taille de la planche = colonnes (frames) × lignes (animations) × taille de cellule', () => {
    const spec: Anim2dSpec = {
      width: 20,
      height: 30,
      fps: 8,
      parts: [{ id: 'p', svg: '<rect width="20" height="30" fill="#123456"/>', pivot: [10, 15] }],
      animations: [
        { name: 'idle', frames: 3, loop: true, keys: [] },
        { name: 'walk', frames: 5, loop: true, keys: [] },
      ],
    };
    expect(anim2dSpecSchema.safeParse(spec).success).toBe(true);
    const layout = sheetLayout(spec);
    expect(layout.columns).toBe(5); // max des `frames` des animations
    expect(layout.rows).toBe(2); // nombre d'animations
    expect(layout.width).toBe(5 * 20);
    expect(layout.height).toBe(2 * 30);
  });
});

describe('anim2d — atlas', () => {
  it('produit un atlas cohérent : frames « nom_i », dans les limites, animations ordonnées, meta.image présent', () => {
    const spec: Anim2dSpec = {
      width: 16,
      height: 16,
      fps: 6,
      parts: [{ id: 'p', svg: '<rect width="16" height="16" fill="#abcdef"/>', pivot: [8, 8] }],
      animations: [
        { name: 'idle', frames: 3, loop: true, keys: [] },
        { name: 'walk', frames: 2, loop: true, keys: [] },
      ],
    };
    const atlas = buildAtlas(spec) as {
      frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
      animations: Record<string, string[]>;
      meta: { image: string; size: { w: number; h: number } };
    };
    expect(atlas.meta.image).toBe('sheet.png');
    expect(atlas.meta.size).toEqual({ w: 3 * 16, h: 2 * 16 });
    expect(Object.keys(atlas.frames)).toEqual(['idle_0', 'idle_1', 'idle_2', 'walk_0', 'walk_1']);
    expect(atlas.animations).toEqual({ idle: ['idle_0', 'idle_1', 'idle_2'], walk: ['walk_0', 'walk_1'] });
    for (const [name, entry] of Object.entries(atlas.frames)) {
      expect(name).toMatch(/^(idle|walk)_\d+$/);
      expect(entry.frame.x).toBeGreaterThanOrEqual(0);
      expect(entry.frame.y).toBeGreaterThanOrEqual(0);
      expect(entry.frame.x + entry.frame.w).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(entry.frame.y + entry.frame.h).toBeLessThanOrEqual(atlas.meta.size.h);
    }
  });
});

describe('anim2d — rendu', () => {
  it('produit un PNG aux dimensions de la planche, plus l’atlas et la source, avec les bonnes infos', async () => {
    const params = anim2dParamsSchema.parse({});
    const result = await gen.render(claudeLikeSpec, params, resvgContext);
    const layout = sheetLayout(claudeLikeSpec);

    const main = result.files.find((f) => f.role === 'main');
    expect(main).toBeDefined();
    expect(isPng(main!.data as Uint8Array)).toBe(true);
    const img = decodePng(main!.data as Uint8Array);
    expect([img.width, img.height]).toEqual([layout.width, layout.height]);

    const atlasFile = result.files.find((f) => f.role === 'atlas');
    expect(atlasFile).toBeDefined();
    expect(JSON.parse(atlasFile!.data as string)).toEqual(buildAtlas(claudeLikeSpec));

    const sourceFile = result.files.find((f) => f.role === 'source');
    expect(sourceFile).toBeDefined();
    expect(JSON.parse(sourceFile!.data as string)).toEqual(claudeLikeSpec);

    expect(result.info).toEqual({
      frameWidth: claudeLikeSpec.width,
      frameHeight: claudeLikeSpec.height,
      fps: claudeLikeSpec.fps,
      frames: layout.columns,
      animations: 'idle',
    });
  });
});

describe('anim2d — specs invalides', () => {
  it('rejette une clé référençant une pièce inconnue', () => {
    const spec = structuredClone(claudeLikeSpec);
    spec.animations[0]!.keys.push({ part: 'inconnue', frame: 0 });
    const r = anim2dSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/Pièce inconnue « inconnue »/);
  });

  it('rejette une frame hors des limites de l’animation', () => {
    const spec = structuredClone(claudeLikeSpec);
    spec.animations[0]!.keys[0]!.frame = 99;
    const r = anim2dSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/Frame 99 hors de l.animation « idle »/);
  });

  it('rejette un id de pièce en double', () => {
    const spec = structuredClone(claudeLikeSpec);
    spec.parts[1]!.id = spec.parts[0]!.id;
    const r = anim2dSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/Id de pièce en double « body »/);
  });

  it('rejette un fragment de pièce contenant une racine <svg>', () => {
    const spec = structuredClone(claudeLikeSpec);
    spec.parts[0]!.svg = '<svg><circle cx="1" cy="1" r="1"/></svg>';
    const r = anim2dSpecSchema.safeParse(spec);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/ne doit pas contenir de racine <svg>/);
  });
});

describe('anim2d — génération procédurale', () => {
  const animNames = ['idle', 'walk', 'wave', 'attack'];

  for (const subject of ANIM_SUBJECTS) {
    it(`est déterministe et conforme au schéma pour le sujet « ${subject} »`, () => {
      const params = anim2dParamsSchema.parse({
        subject,
        animations: animNames,
        width: 48,
        height: 64,
        frames: 6,
        fps: 12,
      });
      const a = proceduralAnim(params, new Rng(42));
      const b = proceduralAnim(params, new Rng(42));
      expect(b).toEqual(a);

      const parsed = anim2dSpecSchema.safeParse(a);
      expect(parsed.success).toBe(true);
      expect(a.width).toBe(48);
      expect(a.height).toBe(64);
      expect(a.fps).toBe(12);
      expect(a.animations.map((x) => x.name)).toEqual(animNames);
    });
  }

  it('deux graines différentes produisent des spécifications différentes', () => {
    const params = anim2dParamsSchema.parse({ subject: 'effect', animations: ['idle'] });
    const a = proceduralAnim(params, new Rng(1));
    const b = proceduralAnim(params, new Rng(2));
    expect(a).not.toEqual(b);
  });
});

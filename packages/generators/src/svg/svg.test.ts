import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodePng, isPng, resvgContext } from '../shared/test-utils';
import { SCENES, TIMES } from './background';
import { CREATURES } from './battler';
import { SVG_STYLES } from './builder';
import {
  DEFAULT_SIZES,
  imageSvgGenerator as gen,
  imageSvgParamsSchema,
  imageSvgSpecSchema,
  proceduralSvg,
  resolveSvgSize,
  SVG_SUBJECTS,
  type ImageSvgSpec,
} from './generator';
import { OBJECTS } from './objects';
import { EXPRESSIONS } from './portrait';
import { sanitizeSvg } from './sanitize';

/** Enveloppe un fragment dans un document SVG minimal valide. */
function wrap(fragment: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${fragment}</svg>`;
}

const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('image.svg — paramètres et tailles', () => {
  it('applique les valeurs par défaut des paramètres', () => {
    const params = imageSvgParamsSchema.parse({});
    expect(params).toMatchObject({ prompt: '', subject: 'illustration', style: 'soft' });
  });

  it('résout la taille par défaut selon le sujet', () => {
    expect(resolveSvgSize({ subject: 'background' })).toEqual(DEFAULT_SIZES.background);
    expect(resolveSvgSize({ subject: 'background' })).toEqual([1280, 720]);
    expect(resolveSvgSize({ subject: 'portrait' })).toEqual([600, 900]);
    expect(resolveSvgSize({ subject: 'battler' })).toEqual([256, 256]);
    expect(resolveSvgSize({ subject: 'object' })).toEqual([256, 256]);
    expect(resolveSvgSize({ subject: 'icon' })).toEqual([256, 256]);
    expect(resolveSvgSize({ subject: 'illustration' })).toEqual([1024, 768]);
  });

  it('conserve le ratio quand une seule dimension est imposée', () => {
    expect(resolveSvgSize({ subject: 'portrait', width: 300 })).toEqual([300, 450]);
    expect(resolveSvgSize({ subject: 'background', height: 360 })).toEqual([640, 360]);
  });

  it('produit un schéma JSON exploitable pour la spec (entrée outil IA)', () => {
    const schema = z.toJSONSchema(imageSvgSpecSchema, { io: 'input' }) as Record<string, unknown>;
    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
    const properties = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(['width', 'height', 'svg']));
    expect(() => z.toJSONSchema(imageSvgParamsSchema, { io: 'input' })).not.toThrow();
  });
});

describe('sanitizeSvg — retrait des éléments et attributs dangereux', () => {
  it('supprime <script>', () => {
    const out = sanitizeSvg(wrap('<script>alert(1)</script><rect width="5" height="5"/>'));
    expect(out).not.toMatch(/<script/i);
    expect(out).toMatch(/<rect/);
  });

  it('supprime <foreignObject>', () => {
    const out = sanitizeSvg(wrap('<foreignObject><div>x</div></foreignObject><rect width="5" height="5"/>'));
    expect(out).not.toMatch(/<foreignObject/i);
    expect(out).toMatch(/<rect/);
  });

  it('retire les attributs on*', () => {
    const out = sanitizeSvg(wrap('<rect onclick="alert(1)" onmouseover="evil()" width="5" height="5" fill="#f00"/>'));
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).toMatch(/<rect/);
    expect(out).toContain('fill="#f00"');
  });

  it('retire un href javascript:, y compris encodé en entités', () => {
    const direct = sanitizeSvg(wrap('<a href="javascript:alert(1)"><rect width="5" height="5"/></a>'));
    expect(direct).not.toMatch(/javascript:/i);
    expect(direct).not.toMatch(/\shref\s*=/i);

    const encoded = sanitizeSvg(wrap('<a href="&#106;avascript:alert(1)"><rect width="5" height="5"/></a>'));
    expect(encoded).not.toMatch(/javascript:/i);
    expect(encoded).not.toMatch(/\shref\s*=/i);
  });

  it('retire les href externes http(s), garde les ancres internes #id', () => {
    const out = sanitizeSvg(wrap('<a href="https://evil.example.com/x"><rect width="5" height="5"/></a>'));
    expect(out).not.toMatch(/\shref\s*=/i);

    const internal = sanitizeSvg(wrap('<use href="#logo"/><rect id="logo" width="5" height="5"/>'));
    expect(internal).toContain('href="#logo"');
  });

  it('retire les <image> distants mais garde les data:image/png', () => {
    const remote = '<image href="http://evil.example.com/x.png" width="5" height="5"/>';
    const local = `<image href="${TINY_PNG_DATA_URI}" width="5" height="5"/>`;
    const out = sanitizeSvg(wrap(remote + local));
    const images = out.match(/<image\b[^>]*>/gi) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('data:image/png');
    expect(out).not.toContain('evil.example.com');
  });

  it('supprime les <style> avec @import ou url(http…), garde les <style> inoffensifs', () => {
    const importCss = '<style>@import url("http://evil.example.com/x.css");</style><rect width="5" height="5"/>';
    const withImport = sanitizeSvg(wrap(importCss));
    expect(withImport).not.toMatch(/<style/i);

    const remoteUrlCss = '<style>.a{fill:url(http://evil.example.com/x.png)}</style>';
    const withRemoteUrl = sanitizeSvg(wrap(`${remoteUrlCss}<rect class="a" width="5" height="5"/>`));
    expect(withRemoteUrl).not.toMatch(/<style/i);

    const safe = sanitizeSvg(wrap('<style>.a{fill:#f00}</style><rect class="a" width="5" height="5"/>'));
    expect(safe).toMatch(/<style/i);
    expect(safe).toContain('.a{fill:#f00}');
  });

  it('supprime DOCTYPE et ENTITY', () => {
    const raw =
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      wrap('<rect width="5" height="5"/>');
    const out = sanitizeSvg(raw);
    expect(out).not.toMatch(/DOCTYPE/i);
    expect(out).not.toMatch(/<!ENTITY/i);
    expect(out).not.toMatch(/xxe/i);
  });

  it('impose xmlns, width, height et viewBox sur la racine', () => {
    const out = sanitizeSvg('<svg><rect width="4" height="4"/></svg>', { width: 40, height: 20 });
    const expectedRoot = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"';
    expect(out.startsWith(expectedRoot)).toBe(true);
  });

  it('est idempotent sur un SVG procédural', () => {
    const params = imageSvgParamsSchema.parse({ subject: 'battler', creature: 'ghost' });
    const raw = proceduralSvg(params, new Rng(11));
    const once = sanitizeSvg(raw, { width: 256, height: 256 });
    const twice = sanitizeSvg(once, { width: 256, height: 256 });
    expect(twice).toBe(once);
  });
});

describe('image.svg — génération procédurale', () => {
  it('est déterministe pour une graine et conforme au schéma de spec, pour chaque sujet', () => {
    for (const subject of SVG_SUBJECTS) {
      const params = imageSvgParamsSchema.parse({ subject, prompt: 'un decor de test' });
      const a = gen.procedural(params, new Rng(42));
      const b = gen.procedural(params, new Rng(42));
      expect(b).toEqual(a);
      const [w, h] = DEFAULT_SIZES[subject];
      expect(a.width).toBe(w);
      expect(a.height).toBe(h);
      const parsed = imageSvgSpecSchema.safeParse(a);
      expect(parsed.success).toBe(true);
    }
  });

  it('garde la même identité (couleur de cheveux imposée) entre deux expressions du même personnage', () => {
    const base = { subject: 'portrait', character: 'Aria', hairColor: '#123456', style: 'flat' } as const;
    const params1 = imageSvgParamsSchema.parse({ ...base, expression: 'happy' });
    const params2 = imageSvgParamsSchema.parse({ ...base, expression: 'angry' });
    const svg1 = proceduralSvg(params1, new Rng(1));
    const svg2 = proceduralSvg(params2, new Rng(2));
    expect(svg1).toContain('#123456');
    expect(svg2).toContain('#123456');
    // Les deux rendus diffèrent bien (l'expression change le dessin) tout en partageant l'identité.
    expect(svg1).not.toBe(svg2);
  });
});

describe('image.svg — rendu', () => {
  it('rend un PNG principal et une source SVG cohérents avec la spec', async () => {
    const params = imageSvgParamsSchema.parse({ subject: 'icon', prompt: 'une gemme bleue' });
    const spec = gen.procedural(params, new Rng(3));
    const result = await gen.render(spec, params, resvgContext);

    const main = result.files.find((f) => f.role === 'main');
    expect(main).toBeDefined();
    const png = main!.data as Uint8Array;
    expect(isPng(png)).toBe(true);
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([spec.width, spec.height]);

    const source = result.files.find((f) => f.role === 'source');
    expect(source).toBeDefined();
    expect(typeof source!.data).toBe('string');
    expect(source!.data as string).toMatch(/^<svg[\s>]/);
    expect(source!.data as string).toMatch(/<\/svg>\s*$/);

    expect(result.info).toEqual({ width: spec.width, height: spec.height, subject: 'icon' });
  });

  it('rend une spec écrite à la main (façon Claude)', async () => {
    const handWrittenSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="30" fill="#3366ff"/></svg>';
    const spec: ImageSvgSpec = { width: 64, height: 64, svg: handWrittenSvg };
    expect(imageSvgSpecSchema.safeParse(spec).success).toBe(true);
    const params = imageSvgParamsSchema.parse({ subject: 'icon' });
    const result = await gen.render(spec, params, resvgContext);
    const main = result.files.find((f) => f.role === 'main')!;
    const png = main.data as Uint8Array;
    expect(isPng(png)).toBe(true);
    expect(decodePng(png)).toMatchObject({ width: 64, height: 64 });
  });

  it('rejette les specs invalides (svg vide, dimensions <= 0)', () => {
    expect(imageSvgSpecSchema.safeParse({ width: 64, height: 64, svg: '' }).success).toBe(false);
    expect(
      imageSvgSpecSchema.safeParse({
        width: 0,
        height: 64,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>',
      }).success,
    ).toBe(false);
    expect(
      imageSvgSpecSchema.safeParse({
        width: 64,
        height: -10,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>',
      }).success,
    ).toBe(false);
  });
});

describe('image.svg — aucun rendu ne lève', () => {
  it('portraits : les 6 expressions se rendent', async () => {
    for (const expression of EXPRESSIONS) {
      const params = imageSvgParamsSchema.parse({
        subject: 'portrait',
        character: 'Loop',
        expression,
        width: 60,
        height: 90,
      });
      const spec = gen.procedural(params, new Rng(1));
      const result = await gen.render(spec, params, resvgContext);
      expect(isPng(result.files[0]!.data as Uint8Array)).toBe(true);
    }
  });

  it('décors : les 10 scènes x 3 moments se rendent', async () => {
    for (const scene of SCENES) {
      for (const timeOfDay of TIMES) {
        const params = imageSvgParamsSchema.parse({ subject: 'background', scene, timeOfDay, width: 80, height: 45 });
        const spec = gen.procedural(params, new Rng(1));
        const result = await gen.render(spec, params, resvgContext);
        expect(isPng(result.files[0]!.data as Uint8Array)).toBe(true);
      }
    }
  });

  it('battlers : les 6 créatures se rendent', async () => {
    for (const creature of CREATURES) {
      const params = imageSvgParamsSchema.parse({ subject: 'battler', creature, width: 64, height: 64 });
      const spec = gen.procedural(params, new Rng(1));
      const result = await gen.render(spec, params, resvgContext);
      expect(isPng(result.files[0]!.data as Uint8Array)).toBe(true);
    }
  });

  it('objets : chaque objet se rend', async () => {
    for (const object of OBJECTS) {
      const params = imageSvgParamsSchema.parse({ subject: 'object', prompt: object, width: 48, height: 48 });
      const spec = gen.procedural(params, new Rng(1));
      const result = await gen.render(spec, params, resvgContext);
      expect(isPng(result.files[0]!.data as Uint8Array)).toBe(true);
    }
  });

  it('les 4 styles se rendent', async () => {
    for (const style of SVG_STYLES) {
      const params = imageSvgParamsSchema.parse({ subject: 'illustration', style, width: 80, height: 60 });
      const spec = gen.procedural(params, new Rng(1));
      const result = await gen.render(spec, params, resvgContext);
      expect(isPng(result.files[0]!.data as Uint8Array)).toBe(true);
    }
  });
});

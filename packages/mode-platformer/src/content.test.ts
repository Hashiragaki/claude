import { PLATFORM_TILE_ROLES, type AssetKind } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PlatformerLevelSchema, PlatformerSystemSchema, levelPath, PLATFORMER_SYSTEM_PATH } from './schema';
import { PLATFORMER_TEMPLATES, platformerDemoTemplate } from './templates';

/**
 * NOTE : `@forge/mode-platformer` ne dépend pas de `@forge/generators` (règle « aucune dépendance
 * nouvelle »). Les schémas ci-dessous reproduisent donc localement les `paramsSchema` des
 * générateurs `charset`, `image.svg`, `music` et `sfx` (voir `packages/generators/src/{pixel/
 * charset,svg,audio}/*`) pour vérifier que les demandes d'assets des modèles leur seraient
 * acceptées, sans créer de dépendance vers le paquet. Signalé dans le rapport (« issues »).
 */

const HEX6 = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const charsetParamsSchemaLocal = z.object({
  prompt: z.string().default(''),
  skinTone: HEX6.optional(),
  hairColor: HEX6.optional(),
  outfitColor: HEX6.optional(),
  hairStyle: z.enum(['short', 'long', 'spiky', 'bald', 'ponytail', 'hood']).optional(),
  outfitStyle: z.enum(['tunic', 'robe', 'armor', 'dress']).optional(),
  accessory: z.enum(['none', 'hat', 'helmet', 'crown', 'glasses']).optional(),
});

const imageSvgParamsSchemaLocal = z.object({
  prompt: z.string().default(''),
  subject: z.enum(['background', 'portrait', 'battler', 'object', 'icon', 'illustration']).default('illustration'),
  width: z.number().int().min(16).max(2048).optional(),
  height: z.number().int().min(16).max(2048).optional(),
});

const musicParamsSchemaLocal = z.object({
  prompt: z.string().default(''),
  mood: z.enum(['calm', 'happy', 'tense', 'sad', 'epic', 'mysterious', 'battle', 'village']).default('calm'),
  bpm: z.number().int().min(60).max(200).optional(),
  bars: z.number().int().min(4).max(32).default(8),
  loop: z.boolean().default(true),
});

const sfxParamsSchemaLocal = z.object({
  prompt: z.string().default(''),
  preset: z
    .enum([
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
    ])
    .default('random'),
});

/** Générateurs vérifiés (id → schéma local) ; `tileset.side` en est volontairement exclu. */
const CHECKED_GENERATOR_SCHEMAS: Record<string, z.ZodType> = {
  charset: charsetParamsSchemaLocal,
  'image.svg': imageSvgParamsSchemaLocal,
  music: musicParamsSchemaLocal,
  sfx: sfxParamsSchemaLocal,
};

/** Kind d'asset produit par chaque générateur (pour vérifier les alias, voir `checkAsset` de `validate.ts`). */
const GENERATOR_KINDS: Record<string, AssetKind> = {
  'tileset.side': 'tileset',
  charset: 'charset',
  'image.svg': 'image',
  music: 'music',
  sfx: 'sfx',
};

describe('modèles de projet', () => {
  it('les fichiers de chaque modèle respectent le format attendu', () => {
    for (const template of PLATFORMER_TEMPLATES) {
      for (const file of template.files) {
        const schema = file.path === PLATFORMER_SYSTEM_PATH ? PlatformerSystemSchema : PlatformerLevelSchema;
        const result = schema.safeParse(file.content);
        expect(result.success, `${template.id} / ${file.path} : ${result.success ? '' : result.error.message}`).toBe(
          true,
        );
      }
      // Chaque niveau listé par le système correspond à un fichier `levels/<id>.json` du modèle.
      const system = PlatformerSystemSchema.parse(
        template.files.find((f) => f.path === PLATFORMER_SYSTEM_PATH)!.content,
      );
      const paths = new Set(template.files.map((f) => f.path));
      for (const id of system.levels) expect(paths.has(levelPath(id)), `${template.id} : niveau « ${id} »`).toBe(true);
    }
  });

  it("les alias d'assets sont en kebab-case et uniques", () => {
    for (const template of PLATFORMER_TEMPLATES) {
      const seen = new Set<string>();
      for (const asset of template.assets) {
        expect(asset.alias, `${template.id} : alias « ${asset.alias} »`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(seen.has(asset.alias), `${template.id} : alias en double « ${asset.alias} »`).toBe(false);
        seen.add(asset.alias);
        expect(
          GENERATOR_KINDS[asset.generator],
          `${template.id} : générateur inconnu « ${asset.generator} »`,
        ).toBeDefined();
      }
    }
  });

  it("les paramètres des demandes d'assets sont acceptés par le générateur correspondant", () => {
    for (const template of PLATFORMER_TEMPLATES) {
      for (const asset of template.assets) {
        const schema = CHECKED_GENERATOR_SCHEMAS[asset.generator];
        if (!schema) continue; // `tileset.side` : générateur écrit en parallèle, non vérifié ici.
        const result = schema.safeParse(asset.params);
        expect(
          result.success,
          `${template.id} / ${asset.alias} (${asset.generator}) : ${result.success ? '' : result.error.message}`,
        ).toBe(true);
      }
    }
  });

  it('les niveaux de la démo ont une arrivée atteignable en largeur et aucune entité sur une tuile solide', () => {
    for (const file of platformerDemoTemplate.files) {
      if (file.path === PLATFORMER_SYSTEM_PATH) continue;
      const level = PlatformerLevelSchema.parse(file.content);
      const goal = level.entities.find((e) => e.type === 'goal');
      expect(goal, `${file.path} : arrivée manquante`).toBeDefined();
      expect(goal!.x, `${file.path} : arrivée avant le départ`).toBeGreaterThan(level.playerStart.x);

      const isSolid = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= level.width || y >= level.height) return false;
        const tile = level.layers.terrain[y * level.width + x];
        if (tile === undefined || tile === -1) return false;
        return PLATFORM_TILE_ROLES[tile]?.collision === 'solid';
      };
      expect(isSolid(level.playerStart.x, level.playerStart.y), `${file.path} : départ sur une tuile solide`).toBe(
        false,
      );
      for (const entity of level.entities) {
        expect(
          isSolid(entity.x, entity.y),
          `${file.path} : entité « ${entity.id} » (${entity.x}, ${entity.y}) sur une tuile solide`,
        ).toBe(false);
      }
    }
  });
});

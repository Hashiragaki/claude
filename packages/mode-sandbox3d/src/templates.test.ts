import { normalizeAlias } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { sandbox3dMode } from './mode';
import { parseScene } from './schema';
import { SCENE_ENTRY, blankTemplate, demoTemplate } from './templates';

const MODEL_TEMPLATES = [
  'tree', 'rock', 'house', 'crate', 'character', 'chest', 'lamp', 'tower', 'fence', 'mushroom', 'sword', 'well',
];
const SUPPORTED_ANIMATIONS: Record<string, string[]> = {
  tree: ['sway'],
  character: ['idle', 'walk', 'wave'],
  chest: ['open'],
};

describe('modèles de projet', () => {
  it('le mode expose ses deux modèles', () => {
    expect(sandbox3dMode.id).toBe('sandbox3d');
    expect(sandbox3dMode.name).toBe('Bac à sable 3D');
    expect(sandbox3dMode.templates.map((t) => t.id)).toEqual(['sandbox3d-blank', 'sandbox3d-demo']);
  });

  for (const template of [blankTemplate, demoTemplate]) {
    describe(template.name, () => {
      const file = template.files.find((f) => f.path === template.manifest.entry);
      const scene = parseScene(file?.content);

      it('déclare un manifeste 1280×720 et un fichier de scène valide', () => {
        expect(template.manifest).toEqual({
          resolution: { width: 1280, height: 720 },
          pixelArt: false,
          entry: SCENE_ENTRY,
        });
        expect(file).toBeDefined();
      });

      it('ne référence que des alias déclarés dans ses assets', () => {
        const byAlias = new Map(template.assets.map((a) => [normalizeAlias(a.alias), a]));
        expect(byAlias.size).toBe(template.assets.length);
        const refs = [...scene.objects.map((o) => o.model), scene.player.model, scene.music].filter(
          (r): r is string => r !== undefined,
        );
        for (const ref of refs) expect(byAlias.has(normalizeAlias(ref)), ref).toBe(true);
        for (const obj of scene.objects) expect(byAlias.get(normalizeAlias(obj.model))?.generator).toBe('model3d');
        if (scene.music) expect(byAlias.get(normalizeAlias(scene.music))?.generator).toBe('music');
      });

      it('demande des modèles et animations pris en charge par le générateur', () => {
        for (const asset of template.assets) {
          expect(Number.isInteger(asset.seed)).toBe(true);
          if (asset.generator !== 'model3d') continue;
          const params = asset.params as { template: string; animations: string[]; prompt: string };
          expect(MODEL_TEMPLATES).toContain(params.template);
          expect(params.prompt.length).toBeGreaterThan(10);
          for (const anim of params.animations) expect(SUPPORTED_ANIMATIONS[params.template] ?? []).toContain(anim);
        }
      });

      it('utilise des animations demandées pour chaque modèle', () => {
        const animationsOf = (ref: string): string[] => {
          const asset = template.assets.find((a) => normalizeAlias(a.alias) === normalizeAlias(ref));
          return (asset?.params.animations as string[] | undefined) ?? [];
        };
        for (const obj of scene.objects) {
          if (obj.animation) expect(animationsOf(obj.model)).toContain(obj.animation);
          if (obj.interact?.animation) expect(animationsOf(obj.model)).toContain(obj.interact.animation);
        }
        if (scene.player.model) {
          for (const anim of [scene.player.idle, scene.player.walk].filter(Boolean)) {
            expect(animationsOf(scene.player.model)).toContain(anim);
          }
        }
      });

      it('place tous les objets sur le sol', () => {
        const half = scene.ground.size / 2;
        for (const obj of scene.objects) {
          expect(Math.abs(obj.position[0]), obj.id).toBeLessThan(half);
          expect(Math.abs(obj.position[2]), obj.id).toBeLessThan(half);
        }
      });
    });
  }

  it('la démo contient une clairière complète', () => {
    const scene = parseScene(demoTemplate.files[0]?.content);
    expect(scene.objects.length).toBeGreaterThanOrEqual(15);
    expect(scene.objects.length).toBeLessThanOrEqual(25);
    const chest = scene.objects.find((o) => o.model === 'coffre');
    expect(chest?.interact).toMatchObject({ animation: 'open', once: true });
    const npc = scene.objects.find((o) => o.model === 'villageoise');
    expect(npc?.interact?.animation).toBe('wave');
    expect(scene.player).toMatchObject({ model: 'voyageur', idle: 'idle', walk: 'walk' });
    // Des modèles réutilisés plutôt qu'un asset par objet.
    expect(demoTemplate.assets.length).toBeLessThan(scene.objects.length);
  });

  it('la scène vide contient un arbre et un joueur-capsule', () => {
    const scene = parseScene(blankTemplate.files[0]?.content);
    expect(scene.objects).toHaveLength(1);
    expect(scene.player.model).toBeUndefined();
  });
});

import {
  AssetRegistry,
  parseExpression,
  type AssetKind,
  type Diagnostic,
  type ProjectBundle,
  type ProjectFiles,
} from '@forge/core';
import type { z } from 'zod';
import { zodDiagnostics } from './loader';
import {
  ItemsFileSchema,
  POINTCLICK_ITEMS_PATH,
  POINTCLICK_SYSTEM_PATH,
  PointClickSystemSchema,
  SceneSchema,
  scenePath,
  type ItemsFile,
  type Point,
  type PointClickAction,
  type PointClickSystem,
  type Polygon,
  type Scene,
} from './schema';

const KIND_LABEL: Record<AssetKind, string> = {
  image: 'image',
  spritesheet: 'planche de sprites',
  charset: 'charset',
  tileset: 'tileset',
  sfx: 'effet sonore',
  music: 'musique',
  model: 'modèle 3D',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readValidated<T>(
  files: ProjectFiles,
  path: string,
  schema: z.ZodType<T>,
  diagnostics: Diagnostic[],
): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await files.readJson(path);
  } catch (error) {
    diagnostics.push({ file: path, severity: 'error', message: `Lecture impossible : ${errorMessage(error)}` });
    return null;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    diagnostics.push(...zodDiagnostics(path, result.error));
    return null;
  }
  return result.data;
}

/** Point dans un polygone (lancer de rayon). */
function inPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const inWalkArea = (scene: Scene, p: Point): boolean => scene.walkArea.some((poly) => inPolygon(p, poly));

/** Contexte de validation partagé. */
interface Ctx {
  diagnostics: Diagnostic[];
  assets: AssetRegistry;
  sceneIds: Set<string>;
  scenes: Map<string, Scene>;
  itemIds: Set<string>;
  hasEnd: boolean;
}

function checkAsset(ctx: Ctx, file: string, ref: string | undefined, kind: AssetKind, where: string): void {
  if (!ref || ctx.assets.resolve(ref, kind)) return;
  ctx.diagnostics.push({
    file,
    severity: 'warning',
    message: `${where} : ${KIND_LABEL[kind]} « ${ref} » introuvable dans les assets.`,
  });
}

function checkExpr(ctx: Ctx, file: string, source: string, where: string): void {
  try {
    parseExpression(source);
  } catch (error) {
    ctx.diagnostics.push({
      file,
      severity: 'error',
      message: `${where} : expression invalide « ${source} » (${errorMessage(error)}).`,
    });
    return;
  }
  for (const m of source.matchAll(/\bhas\(\s*["']([^"']*)["']\s*\)/g)) {
    if (!ctx.itemIds.has(m[1]!)) {
      ctx.diagnostics.push({
        file,
        severity: 'warning',
        message: `${where} : has("${m[1]}") référence un objet inconnu.`,
      });
    }
  }
  for (const m of source.matchAll(/\bvisited\(\s*["']([^"']*)["']\s*\)/g)) {
    if (!ctx.sceneIds.has(m[1]!)) {
      ctx.diagnostics.push({
        file,
        severity: 'warning',
        message: `${where} : visited("${m[1]}") référence une scène inconnue.`,
      });
    }
  }
}

function checkItem(ctx: Ctx, file: string, id: string, where: string): void {
  if (ctx.itemIds.has(id)) return;
  ctx.diagnostics.push({ file, severity: 'error', message: `${where} : objet inconnu « ${id} ».` });
}

function checkHotspotRef(ctx: Ctx, file: string, current: Scene, hotspot: string, sceneId: string | undefined): void {
  const targetId = sceneId ?? current.id;
  const target = sceneId ? ctx.scenes.get(sceneId) : current;
  if (sceneId && !ctx.sceneIds.has(sceneId)) {
    ctx.diagnostics.push({ file, severity: 'error', message: `Action « hide/show » : scène inconnue « ${sceneId} ».` });
    return;
  }
  if (target && !target.hotspots.some((h) => h.id === hotspot)) {
    ctx.diagnostics.push({
      file,
      severity: 'error',
      message: `Action « hide/show » : zone inconnue « ${hotspot} » dans la scène « ${targetId} ».`,
    });
  }
}

/** Parcourt récursivement une liste d'actions (if, dialogue). */
function checkActions(ctx: Ctx, file: string, scene: Scene, actions: PointClickAction[], where: string): void {
  actions.forEach((action, i) => {
    const here = `${where}, action ${i + 1} (${action.type})`;
    switch (action.type) {
      case 'give':
      case 'remove':
        checkItem(ctx, file, action.item, here);
        break;
      case 'set':
        checkExpr(ctx, file, action.value, here);
        break;
      case 'goto': {
        const target = ctx.scenes.get(action.scene);
        if (!ctx.sceneIds.has(action.scene)) {
          ctx.diagnostics.push({ file, severity: 'error', message: `${here} : scène inconnue « ${action.scene} ».` });
        } else if (
          target &&
          action.x !== undefined &&
          action.y !== undefined &&
          target.walkArea.length > 0 &&
          !inWalkArea(target, { x: action.x, y: action.y })
        ) {
          ctx.diagnostics.push({
            file,
            severity: 'warning',
            message: `${here} : arrivée (${action.x}, ${action.y}) hors de la zone de marche de « ${action.scene} ».`,
          });
        }
        break;
      }
      case 'hide':
      case 'show':
        checkHotspotRef(ctx, file, scene, action.hotspot, action.scene);
        break;
      case 'sound':
        checkAsset(ctx, file, action.asset, 'sfx', here);
        break;
      case 'music':
        checkAsset(ctx, file, action.asset, 'music', here);
        break;
      case 'if':
        checkExpr(ctx, file, action.condition, here);
        checkActions(ctx, file, scene, action.then, `${here} (alors)`);
        if (action.else) checkActions(ctx, file, scene, action.else, `${here} (sinon)`);
        break;
      case 'dialogue':
        action.choices.forEach((choice, c) => {
          if (choice.condition) checkExpr(ctx, file, choice.condition, `${here}, choix ${c + 1}`);
          checkActions(ctx, file, scene, choice.actions, `${here}, choix ${c + 1}`);
        });
        break;
      case 'end':
        ctx.hasEnd = true;
        break;
      default:
        break;
    }
  });
}

function validateScene(ctx: Ctx, scene: Scene, expectedId: string): void {
  const file = scenePath(expectedId);
  if (scene.id !== expectedId) {
    ctx.diagnostics.push({
      file,
      severity: 'error',
      message: `Identifiant « ${scene.id} » différent du nom de fichier (« ${expectedId} » attendu).`,
    });
  }
  checkAsset(ctx, file, scene.background, 'image', 'Fond');
  checkAsset(ctx, file, scene.music, 'music', 'Musique');

  const hasWalk = scene.walkArea.length > 0;
  if (scene.playerStart && hasWalk && !inWalkArea(scene, scene.playerStart)) {
    ctx.diagnostics.push({
      file,
      severity: 'warning',
      message: `Départ du joueur (${scene.playerStart.x}, ${scene.playerStart.y}) hors de la zone de marche.`,
    });
  }

  const ids = new Set<string>();
  for (const hotspot of scene.hotspots) {
    const label = `Zone « ${hotspot.id} »`;
    if (ids.has(hotspot.id)) {
      ctx.diagnostics.push({ file, severity: 'error', message: `${label} : identifiant en double.` });
    }
    ids.add(hotspot.id);
    checkAsset(ctx, file, hotspot.sprite, 'image', `${label}, sprite`);
    if (hotspot.walkTo && hasWalk && !inWalkArea(scene, hotspot.walkTo)) {
      ctx.diagnostics.push({
        file,
        severity: 'warning',
        message: `${label} : point d'approche (${hotspot.walkTo.x}, ${hotspot.walkTo.y}) hors de la zone de marche.`,
      });
    }
    hotspot.interactions.forEach((interaction, i) => {
      const where = `${label}, interaction ${i + 1}`;
      if (interaction.item) checkItem(ctx, file, interaction.item, where);
      if (interaction.condition) checkExpr(ctx, file, interaction.condition, where);
      checkActions(ctx, file, scene, interaction.actions, where);
    });
  }
  checkActions(ctx, file, scene, scene.onFirstEnter, 'onFirstEnter');
  checkActions(ctx, file, scene, scene.onEnter, 'onEnter');
}

function validateItems(ctx: Ctx, items: ItemsFile, scenes: Scene[]): void {
  const file = POINTCLICK_ITEMS_PATH;
  const seen = new Set<string>();
  for (const item of items.items) {
    if (seen.has(item.id)) {
      ctx.diagnostics.push({ file, severity: 'error', message: `Objet « ${item.id} » : identifiant en double.` });
    }
    seen.add(item.id);
    checkAsset(ctx, file, item.icon, 'image', `Objet « ${item.id} », icône`);
  }
  const first = scenes[0];
  items.combinations.forEach((combo, i) => {
    const where = `Combinaison ${i + 1} (${combo.a} + ${combo.b})`;
    checkItem(ctx, file, combo.a, where);
    checkItem(ctx, file, combo.b, where);
    if (combo.result) checkItem(ctx, file, combo.result, where);
    if (combo.condition) checkExpr(ctx, file, combo.condition, where);
    // Les combinaisons n'appartiennent à aucune scène : zones relatives à la première scène.
    if (first) checkActions(ctx, file, first, combo.actions, where);
  });
}

function validateSystem(ctx: Ctx, system: PointClickSystem, file: string): void {
  if (!system.scenes.includes(system.startScene)) {
    ctx.diagnostics.push({
      file,
      severity: 'error',
      message: `Scène de départ inconnue « ${system.startScene} » (absente de « scenes »).`,
    });
  }
  const dup = system.scenes.find((id, i) => system.scenes.indexOf(id) !== i);
  if (dup) ctx.diagnostics.push({ file, severity: 'error', message: `Scène « ${dup} » listée deux fois.` });
  for (const id of system.startItems) checkItem(ctx, file, id, 'Objets de départ');
  checkAsset(ctx, file, system.playerCharset, 'charset', 'Charset du joueur');
  checkAsset(ctx, file, system.titleMusic, 'music', 'Musique du titre');
  checkAsset(ctx, file, system.titleBackground, 'image', "Image de l'écran titre");
  for (const [key, ref] of Object.entries(system.sfx)) checkAsset(ctx, file, ref, 'sfx', `sfx.${key}`);
}

/** Validation complète d'un projet point & click (utilisée par `pointClickMode.validate`). */
export async function validatePointClickProject(bundle: ProjectBundle): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const entry = bundle.manifest.entry || POINTCLICK_SYSTEM_PATH;
  const system = await readValidated(bundle.files, entry, PointClickSystemSchema, diagnostics);
  if (!system) return diagnostics;

  const items = (await bundle.files.exists(POINTCLICK_ITEMS_PATH))
    ? await readValidated(bundle.files, POINTCLICK_ITEMS_PATH, ItemsFileSchema, diagnostics)
    : ItemsFileSchema.parse({});

  const scenes = new Map<string, Scene>();
  for (const id of system.scenes) {
    const path = scenePath(id);
    if (!(await bundle.files.exists(path))) {
      diagnostics.push({ file: entry, severity: 'error', message: `Scène introuvable « ${id} » (${path}).` });
      continue;
    }
    const scene = await readValidated(bundle.files, path, SceneSchema, diagnostics);
    if (scene) scenes.set(id, scene);
  }

  const ctx: Ctx = {
    diagnostics,
    assets: new AssetRegistry(bundle.manifest.assets, bundle.files),
    sceneIds: new Set(system.scenes),
    scenes,
    itemIds: new Set((items?.items ?? []).map((i) => i.id)),
    hasEnd: false,
  };

  validateSystem(ctx, system, entry);
  if (items) validateItems(ctx, items, [...scenes.values()]);
  for (const [id, scene] of scenes) validateScene(ctx, scene, id);
  if (scenes.size === system.scenes.length && !ctx.hasEnd) {
    diagnostics.push({
      file: entry,
      severity: 'info',
      message: 'Aucune action « end » : le jeu ne peut pas se terminer.',
    });
  }
  return diagnostics;
}

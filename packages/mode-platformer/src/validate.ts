import {
  AssetRegistry,
  EMPTY_TILE,
  PLATFORM_TILE_ROLES,
  type AssetKind,
  type Diagnostic,
  type ProjectBundle,
  type ProjectFiles,
  type TileRole,
} from '@forge/core';
import { z } from 'zod';
import {
  PLATFORMER_SYSTEM_PATH,
  PlatformerLevelSchema,
  levelPath,
  PlatformerSystemSchema,
  type PlatformerEntity,
  type PlatformerLevel,
  type PlatformerSystem,
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

/** Convertit les erreurs zod en diagnostics lisibles (fichier + chemin du champ fautif). */
function zodDiagnostics(file: string, error: z.ZodError): Diagnostic[] {
  return error.issues.map((issue) => ({
    file,
    severity: 'error',
    message: `Format invalide${issue.path.length ? ` (${issue.path.join('.')})` : ''} : ${issue.message}`,
  }));
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

function checkAsset(
  diagnostics: Diagnostic[],
  file: string,
  assets: AssetRegistry,
  ref: string | undefined,
  kind: AssetKind,
  where: string,
): void {
  if (!ref || assets.resolve(ref, kind)) return;
  diagnostics.push({ file, severity: 'warning', message: `${where} : ${KIND_LABEL[kind]} « ${ref} » introuvable dans les assets.` });
}

function inBoundsOf(size: { width: number; height: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size.width && y < size.height;
}

/** Rôle de la tuile de terrain à une case (`undefined` si vide ou hors limites). */
function terrainRoleAt(level: PlatformerLevel, x: number, y: number): TileRole | undefined {
  if (!inBoundsOf(level, x, y)) return undefined;
  const tile = level.layers.terrain[y * level.width + x];
  if (tile === undefined || tile === EMPTY_TILE) return undefined;
  return PLATFORM_TILE_ROLES[tile];
}

function isSolidAt(level: PlatformerLevel, x: number, y: number): boolean {
  return terrainRoleAt(level, x, y)?.collision === 'solid';
}

const LEVEL_LAYER_KINDS = [
  ['terrain', false],
  ['decor', true],
] as const;

/** Vérifie un niveau : couches, index de tuiles, entités, départ, références d'assets. */
function validateLevel(level: PlatformerLevel, assets: AssetRegistry): Diagnostic[] {
  const file = levelPath(level.id);
  const diagnostics: Diagnostic[] = [];
  const size = level.width * level.height;
  const maxIndex = PLATFORM_TILE_ROLES.length - 1;

  for (const [layerName, optional] of LEVEL_LAYER_KINDS) {
    const data = level.layers[layerName];
    if (data.length !== size && !(optional && data.length === 0)) {
      diagnostics.push({
        file,
        severity: 'error',
        message: `Couche « ${layerName} » : ${data.length} tuile(s) au lieu de ${size} (${level.width}×${level.height}).`,
      });
    }
    const badIndex = data.findIndex((t) => t < -1 || t > maxIndex);
    if (badIndex >= 0) {
      const count = data.filter((t) => t < -1 || t > maxIndex).length;
      diagnostics.push({
        file,
        severity: 'error',
        message:
          `Couche « ${layerName} » : ${count} tuile(s) d'index hors limites [-1, ${maxIndex}] ` +
          `(première en ${badIndex % level.width}, ${Math.floor(badIndex / level.width)} : ${data[badIndex]}).`,
      });
    }
  }

  const ids = new Set<string>();
  for (const entity of level.entities) {
    const label = `Entité « ${entity.id} »`;
    if (ids.has(entity.id)) diagnostics.push({ file, severity: 'error', message: `${label} : identifiant en double.` });
    ids.add(entity.id);
    if (!inBoundsOf(level, entity.x, entity.y)) {
      diagnostics.push({ file, severity: 'error', message: `${label} : position (${entity.x}, ${entity.y}) hors du niveau.` });
    }
    if (entity.type === 'enemy' && entity.sprite) checkAsset(diagnostics, file, assets, entity.sprite, 'charset', label);
  }
  if (!level.entities.some((e: PlatformerEntity) => e.type === 'goal')) {
    diagnostics.push({ file, severity: 'warning', message: 'Aucune arrivée (« goal ») dans ce niveau.' });
  }

  const { x: sx, y: sy } = level.playerStart;
  if (!inBoundsOf(level, sx, sy)) {
    diagnostics.push({ file, severity: 'error', message: `Départ : position (${sx}, ${sy}) hors du niveau.` });
  } else if (isSolidAt(level, sx, sy)) {
    diagnostics.push({ file, severity: 'error', message: `Départ : position (${sx}, ${sy}) dans une tuile solide.` });
  }

  checkAsset(diagnostics, file, assets, level.tileset, 'tileset', 'Tileset');
  checkAsset(diagnostics, file, assets, level.music, 'music', 'Musique');
  checkAsset(diagnostics, file, assets, level.background, 'image', 'Fond');

  return diagnostics;
}

function validateSystem(system: PlatformerSystem, assets: AssetRegistry, file: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (system.startLevel && !system.levels.includes(system.startLevel)) {
    diagnostics.push({
      file,
      severity: 'error',
      message: `Niveau de départ inconnu « ${system.startLevel} » (absent de « levels »).`,
    });
  }
  checkAsset(diagnostics, file, assets, system.playerCharset, 'charset', 'Charset du joueur');
  checkAsset(diagnostics, file, assets, system.titleMusic, 'music', 'Musique du titre');
  checkAsset(diagnostics, file, assets, system.levelMusic, 'music', 'Musique par défaut des niveaux');
  for (const [key, ref] of Object.entries(system.sfx)) checkAsset(diagnostics, file, assets, ref, 'sfx', `sfx.${key}`);
  return diagnostics;
}

/** Validation complète d'un projet plateformer (utilisée par `platformerMode.validate`). */
export async function validatePlatformerProject(bundle: ProjectBundle): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const entry = bundle.manifest.entry || PLATFORMER_SYSTEM_PATH;
  const system = await readValidated(bundle.files, entry, PlatformerSystemSchema, diagnostics);
  if (!system) return diagnostics;

  const assets = new AssetRegistry(bundle.manifest.assets, bundle.files);

  const levels = new Map<string, PlatformerLevel>();
  for (const id of system.levels) {
    const path = levelPath(id);
    if (!(await bundle.files.exists(path))) {
      diagnostics.push({ file: entry, severity: 'error', message: `Niveau introuvable « ${id} » (${path}).` });
      continue;
    }
    const level = await readValidated(bundle.files, path, PlatformerLevelSchema, diagnostics);
    if (level) levels.set(id, level);
  }

  for (const [id, level] of levels) {
    if (level.next && !system.levels.includes(level.next)) {
      diagnostics.push({ file: levelPath(id), severity: 'error', message: `Niveau suivant inconnu « ${level.next} ».` });
    }
    diagnostics.push(...validateLevel(level, assets));
  }

  diagnostics.push(...validateSystem(system, assets, entry));

  return diagnostics;
}

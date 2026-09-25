import { AssetRegistry, type AssetKind, type AssetMeta, type Diagnostic, type ProjectBundle } from '@forge/core';
import { insideBounds, groundBounds } from './movement';
import { formatIssuePath, safeParseScene, type SceneData } from './schema';

/**
 * Animations connues d'un modèle d'après ses métadonnées (paramètres du générateur ou
 * `info.animations`), ou `null` si on ne sait pas.
 */
export function knownAnimations(meta: AssetMeta): string[] | null {
  const fromParams = meta.params?.['animations'];
  if (Array.isArray(fromParams) && fromParams.every((a) => typeof a === 'string')) return fromParams;
  const fromInfo = meta.info['animations'];
  if (typeof fromInfo === 'string') {
    return fromInfo
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
  }
  return null;
}

const KIND_LABELS: Partial<Record<AssetKind, string>> = { model: 'un modèle 3D', music: 'une musique' };

/** Numéro de ligne (1-based) de la première occurrence de `needle`, s'il est trouvé. */
function lineOf(text: string, needle: string): number | undefined {
  const index = text.indexOf(needle);
  if (index < 0) return undefined;
  return text.slice(0, index).split('\n').length;
}

/** Ligne de la déclaration d'un objet (`"id": "…"`) dans le JSON de la scène. */
function objectLine(text: string, id: string): number | undefined {
  const escaped = JSON.stringify(id);
  return lineOf(text, `"id": ${escaped}`) ?? lineOf(text, `"id":${escaped}`);
}

/**
 * Vérifie la scène d'un projet « bac à sable 3D » : format, références d'assets (modèles,
 * musique), animations connues et objets hors du sol.
 */
export async function validateSandbox3d(bundle: ProjectBundle): Promise<Diagnostic[]> {
  const file = bundle.manifest.entry;
  const diagnostics: Diagnostic[] = [];

  let text: string;
  try {
    text = await bundle.files.readText(file);
  } catch {
    return [{ file, severity: 'error', message: `Fichier de scène introuvable : ${file}` }];
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [{ file, severity: 'error', message: `JSON invalide : ${detail}` }];
  }

  const parsed = safeParseScene(data);
  if (!parsed.success) {
    const objects = (data as { objects?: unknown } | null)?.objects;
    for (const issue of parsed.error.issues) {
      const where = formatIssuePath(issue.path);
      const message = where ? `${where} : ${issue.message}` : issue.message;
      const diag: Diagnostic = { file, severity: 'error', message };
      // Localise l'objet fautif dans le fichier quand c'est possible.
      if (issue.path[0] === 'objects' && typeof issue.path[1] === 'number' && Array.isArray(objects)) {
        const id = (objects[issue.path[1]] as { id?: unknown } | undefined)?.id;
        const line = typeof id === 'string' ? objectLine(text, id) : undefined;
        if (line) diag.line = line;
      }
      diagnostics.push(diag);
    }
    return diagnostics;
  }

  const scene: SceneData = parsed.data;
  const registry = new AssetRegistry(bundle.manifest.assets, bundle.files);

  const checkRef = (ref: string, kind: AssetKind, label: string, line?: number): AssetMeta | undefined => {
    const meta = registry.resolve(ref, kind);
    if (!meta) {
      const other = registry.resolve(ref);
      const message = other
        ? `${label} : « ${ref} » est un asset de type ${other.kind}, pas ${KIND_LABELS[kind] ?? kind}`
        : `${label} : asset « ${ref} » introuvable`;
      diagnostics.push({ file, severity: 'error', message, ...(line ? { line } : {}) });
    }
    return meta;
  };

  const checkAnimation = (meta: AssetMeta | undefined, name: string | undefined, label: string, line?: number) => {
    if (!meta || !name) return;
    const known = knownAnimations(meta);
    if (known && !known.includes(name)) {
      const list = known.length ? known.join(', ') : 'aucune';
      diagnostics.push({
        file,
        severity: 'warning',
        message:
          `${label} : animation « ${name} » absente du modèle « ${meta.alias ?? meta.name} » ` +
          `(disponibles : ${list})`,
        ...(line ? { line } : {}),
      });
    }
  };

  // Joueur
  if (scene.player.model) {
    const line = lineOf(text, '"player"');
    const meta = checkRef(scene.player.model, 'model', 'Joueur', line);
    checkAnimation(meta, scene.player.idle, 'Joueur (repos)', line);
    checkAnimation(meta, scene.player.walk, 'Joueur (marche)', line);
  }

  // Musique
  if (scene.music) checkRef(scene.music, 'music', 'Musique', lineOf(text, '"music"'));

  // Objets
  const bounds = groundBounds(scene.ground.size);
  for (const obj of scene.objects) {
    const line = objectLine(text, obj.id);
    const label = `Objet « ${obj.id} »`;
    const meta = checkRef(obj.model, 'model', label, line);
    checkAnimation(meta, obj.animation, label, line);
    checkAnimation(meta, obj.interact?.animation, `${label} (interaction)`, line);
    const [x, , z] = obj.position;
    if (!insideBounds({ x, z }, bounds)) {
      diagnostics.push({
        file,
        severity: 'warning',
        message: `${label} : position (${x}, ${z}) hors du sol (${scene.ground.size} × ${scene.ground.size} m)`,
        ...(line ? { line } : {}),
      });
    }
  }

  // Point d'apparition
  if (!insideBounds(scene.spawn, bounds)) {
    diagnostics.push({
      file,
      severity: 'warning',
      message: `Point d’apparition (${scene.spawn.x}, ${scene.spawn.z}) hors du sol : joueur replacé au bord`,
      line: lineOf(text, '"spawn"'),
    });
  }

  return diagnostics;
}

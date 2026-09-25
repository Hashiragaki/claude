import type { Circle, Vec2 } from './movement';
import type { SceneData, SceneObject } from './schema';

/** Rayon de collision par défaut d'un objet (mètres, multiplié par son échelle). */
export const DEFAULT_OBJECT_RADIUS = 0.5;
/** Distance maximale (mètres, entre les bords) pour interagir avec un objet. */
export const INTERACT_REACH = 0.9;

export interface ObjectCollider extends Circle {
  id: string;
}

/** Échelle horizontale d'un objet (la plus grande entre X et Z). */
export function horizontalScale(scale: SceneObject['scale']): number {
  if (scale === undefined) return 1;
  if (typeof scale === 'number') return Math.abs(scale);
  return Math.max(Math.abs(scale[0]), Math.abs(scale[2]));
}

/** Rayon de collision effectif d'un objet (0 s'il est traversable). */
export function colliderRadius(obj: SceneObject): number {
  if (obj.collider === false) return 0;
  if (obj.collider) return obj.collider.radius;
  return DEFAULT_OBJECT_RADIUS * horizontalScale(obj.scale);
}

/** Cercles de collision des objets de la scène. */
export function sceneColliders(scene: Pick<SceneData, 'objects'>): ObjectCollider[] {
  const out: ObjectCollider[] = [];
  for (const obj of scene.objects) {
    const radius = colliderRadius(obj);
    if (radius > 0) out.push({ id: obj.id, x: obj.position[0], z: obj.position[2], radius });
  }
  return out;
}

/** Un objet est interactif s'il a une interaction non encore épuisée (`once`). */
export function isInteractable(obj: SceneObject, triggered: ReadonlySet<string>): boolean {
  return !!obj.interact && !(obj.interact.once && triggered.has(obj.id));
}

/**
 * Objet interactif le plus proche du joueur, si l'écart entre leurs bords est inférieur à
 * `reach`.
 */
export function findNearestInteractable(
  player: Vec2,
  playerRadius: number,
  objects: readonly SceneObject[],
  triggered: ReadonlySet<string>,
  reach = INTERACT_REACH,
): SceneObject | null {
  let best: SceneObject | null = null;
  let bestGap = Infinity;
  for (const obj of objects) {
    if (!isInteractable(obj, triggered)) continue;
    const dist = Math.hypot(obj.position[0] - player.x, obj.position[2] - player.z);
    const gap = dist - colliderRadius(obj) - playerRadius;
    if (gap <= reach && gap < bestGap) {
      best = obj;
      bestGap = gap;
    }
  }
  return best;
}

export interface ActiveInteraction {
  objectId: string;
  text: string;
}

export type InteractionEvent =
  | { type: 'open'; objectId: string; text: string; animation?: string; firstTime: boolean }
  | { type: 'close'; objectId: string };

/**
 * État des interactions : texte affiché et objets déjà utilisés. `confirm` ouvre la boîte de
 * dialogue de l'objet proche, ou ferme celle qui est ouverte.
 */
export class InteractionTracker {
  active: ActiveInteraction | null = null;
  private readonly used = new Set<string>();

  /** Objets avec lesquels le joueur a déjà interagi (ordre chronologique). */
  get triggered(): string[] {
    return [...this.used];
  }

  get triggeredSet(): ReadonlySet<string> {
    return this.used;
  }

  hasTriggered(id: string): boolean {
    return this.used.has(id);
  }

  confirm(nearest: SceneObject | null): InteractionEvent | null {
    if (this.active) return this.close();
    if (!nearest?.interact || !isInteractable(nearest, this.used)) return null;
    const firstTime = !this.used.has(nearest.id);
    this.used.add(nearest.id);
    this.active = { objectId: nearest.id, text: nearest.interact.text };
    return {
      type: 'open',
      objectId: nearest.id,
      text: nearest.interact.text,
      ...(nearest.interact.animation ? { animation: nearest.interact.animation } : {}),
      firstTime,
    };
  }

  close(): InteractionEvent | null {
    if (!this.active) return null;
    const { objectId } = this.active;
    this.active = null;
    return { type: 'close', objectId };
  }

  /** Restaure les objets déjà utilisés (chargement de partie) ; ferme la boîte ouverte. */
  restore(ids: Iterable<string>): void {
    this.used.clear();
    for (const id of ids) this.used.add(id);
    this.active = null;
  }
}

import { z } from 'zod';
import {
  InteractionTracker,
  findNearestInteractable,
  sceneColliders,
  type InteractionEvent,
  type ObjectCollider,
} from './interaction';
import {
  RUN_MULTIPLIER,
  groundBounds,
  resolveCollisions,
  slideVelocity,
  stepMovement,
  wrapAngle,
  type Bounds,
  type PlayerState,
} from './movement';
import type { SceneData, SceneObject } from './schema';

/** Entrées d'un pas logique (déjà traduites depuis le clavier / la manette). */
export interface WorldInput {
  /** -1 (gauche) à 1 (droite). */
  moveX: number;
  /** -1 (arrière) à 1 (avant). */
  moveY: number;
  run: boolean;
  /** Appui sur « confirmer » pendant ce pas. */
  confirm: boolean;
}

export interface WorldStepResult {
  event: InteractionEvent | null;
  /** Le joueur se déplace (vitesse perceptible). */
  moving: boolean;
  running: boolean;
  /** Vitesse horizontale courante (m/s). */
  speed: number;
}

/** État sauvegardé d'une partie de bac à sable 3D. */
export const SandboxSaveStateSchema = z.object({
  version: z.literal(1),
  player: z.object({ x: z.number(), z: z.number(), rotation: z.number() }),
  triggered: z.array(z.string()),
});
export type SandboxSaveState = z.infer<typeof SandboxSaveStateSchema>;

export interface SandboxDebugState {
  player: { x: number; z: number };
  nearby: string | null;
  triggered: string[];
  [key: string]: unknown;
}

const DEG2RAD = Math.PI / 180;
/** En dessous de cette vitesse (m/s), le joueur est considéré à l'arrêt. */
const MOVING_THRESHOLD = 0.15;

/**
 * Logique pure d'une scène d'exploration : déplacement relatif à la caméra, collisions,
 * interactions et sauvegarde. Le rendu (Three.js) ne fait que refléter cet état.
 */
export class SandboxWorld {
  readonly colliders: ObjectCollider[];
  readonly bounds: Bounds;
  readonly interactions = new InteractionTracker();
  player: PlayerState;
  /** Objet interactif à portée (invite « Appuyer sur Entrée »). */
  nearby: SceneObject | null = null;
  private readonly objectsById: Map<string, SceneObject>;

  constructor(readonly scene: SceneData) {
    this.colliders = sceneColliders(scene);
    this.bounds = groundBounds(scene.ground.size);
    this.objectsById = new Map(scene.objects.map((o) => [o.id, o]));
    this.player = { x: 0, z: 0, rotation: (scene.spawn.rotation ?? 0) * DEG2RAD, vx: 0, vz: 0 };
    this.teleport(scene.spawn.x, scene.spawn.z);
  }

  get playerRadius(): number {
    return this.scene.player.radius;
  }

  /** Lacet de caméra plaçant la caméra derrière le joueur. */
  cameraYawBehindPlayer(): number {
    return wrapAngle(this.player.rotation + Math.PI);
  }

  object(id: string): SceneObject | undefined {
    return this.objectsById.get(id);
  }

  /** Place le joueur (hors des obstacles et dans les limites du sol). */
  teleport(x: number, z: number, rotation = this.player.rotation): void {
    const resolved = resolveCollisions({ x, z }, this.playerRadius, this.colliders, this.bounds, 6);
    this.player = { x: resolved.x, z: resolved.z, rotation, vx: 0, vz: 0 };
    this.updateNearby();
  }

  step(input: WorldInput, cameraYaw: number, dt: number): WorldStepResult {
    let event: InteractionEvent | null = null;
    if (input.confirm) {
      this.updateNearby();
      event = this.interactions.confirm(this.nearby);
    }
    // Pendant un dialogue, le joueur ne bouge pas (il ralentit jusqu'à l'arrêt).
    const frozen = this.interactions.active !== null;
    const move = frozen ? { x: 0, y: 0 } : { x: clampUnit(input.moveX), y: clampUnit(input.moveY) };
    const running = !frozen && input.run && (move.x !== 0 || move.y !== 0);
    const params = { speed: this.scene.player.speed, runMultiplier: RUN_MULTIPLIER };
    const next = stepMovement(this.player, move, cameraYaw, running, params, dt);
    const resolved = resolveCollisions(next, this.playerRadius, this.colliders, this.bounds);
    const velocity = slideVelocity(next.vx, next.vz, resolved.normals);
    this.player = { x: resolved.x, z: resolved.z, rotation: next.rotation, vx: velocity.vx, vz: velocity.vz };
    this.updateNearby();
    const speed = Math.hypot(velocity.vx, velocity.vz);
    return { event, moving: speed > MOVING_THRESHOLD, running, speed };
  }

  /** Ferme la boîte de dialogue ouverte, s'il y en a une. */
  closeInteraction(): InteractionEvent | null {
    return this.interactions.close();
  }

  private updateNearby(): void {
    this.nearby = findNearestInteractable(
      this.player,
      this.playerRadius,
      this.scene.objects,
      this.interactions.triggeredSet,
    );
  }

  serialize(): SandboxSaveState {
    return {
      version: 1,
      player: { x: round(this.player.x), z: round(this.player.z), rotation: round(this.player.rotation) },
      triggered: this.interactions.triggered,
    };
  }

  /** Restaure un état sauvegardé ; retourne `false` (sans rien changer) s'il est invalide. */
  restore(state: unknown): boolean {
    const parsed = SandboxSaveStateSchema.safeParse(state);
    if (!parsed.success) return false;
    const { player, triggered } = parsed.data;
    // Les objets supprimés de la scène depuis la sauvegarde sont ignorés.
    this.interactions.restore(triggered.filter((id) => this.objectsById.has(id)));
    this.teleport(player.x, player.z, wrapAngle(player.rotation));
    return true;
  }

  debugState(): SandboxDebugState {
    return {
      player: { x: round(this.player.x), z: round(this.player.z) },
      nearby: this.nearby?.id ?? null,
      triggered: this.interactions.triggered,
    };
  }
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

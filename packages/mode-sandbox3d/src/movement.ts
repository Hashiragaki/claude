/**
 * Déplacement du joueur et collisions au sol (cercles), sans dépendance au rendu.
 *
 * Conventions : Y vers le haut, sol dans le plan XZ. Une orientation (`rotation`) de 0 regarde
 * vers +Z (convention glTF). La caméra est décrite par son lacet `cameraYaw` : à 0, elle est placée
 * côté +Z de la cible et regarde vers -Z.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  x: number;
  z: number;
  /** Orientation autour de Y (radians). */
  rotation: number;
  /** Vitesse horizontale (m/s). */
  vx: number;
  vz: number;
}

/** Entrée de déplacement : `x` vers la droite, `y` vers l'avant (valeurs dans [-1, 1]). */
export interface MoveInput {
  x: number;
  y: number;
}

export interface MovementParams {
  /** Vitesse de marche (m/s). */
  speed: number;
  /** Multiplicateur de vitesse en course. */
  runMultiplier?: number;
  /** Accélération (m/s²) ; par défaut 8 × la vitesse (pleine vitesse en ~0,12 s). */
  acceleration?: number;
  /** Décélération à l'arrêt (m/s²) ; par défaut 10 × la vitesse. */
  deceleration?: number;
  /** Raideur de la rotation vers la direction de marche. */
  turnRate?: number;
}

export const RUN_MULTIPLIER = 1.8;

export interface Circle {
  x: number;
  z: number;
  radius: number;
}

/** Rectangle du sol dans lequel le joueur reste confiné. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** Rotation amortie vers `target` par le plus court chemin (indépendante du pas de temps). */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const t = 1 - Math.exp(-lambda * Math.max(0, dt));
  return wrapAngle(current + wrapAngle(target - current) * t);
}

/** Direction au sol (longueur ≤ 1) correspondant à l'entrée, relative à l'orientation de la caméra. */
export function cameraRelativeDirection(input: MoveInput, cameraYaw: number): Vec2 {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  // Avant = de la caméra vers la cible ; droite = avant × haut.
  let x = input.x * cos - input.y * sin;
  let z = -input.x * sin - input.y * cos;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  return { x, z };
}

/** Orientation (radians) regardant dans la direction `dir` (0 = +Z). */
export function headingOf(dir: Vec2): number {
  return Math.atan2(dir.x, dir.z);
}

/**
 * Avance le joueur d'un pas : la vitesse tend vers la vitesse voulue avec une accélération bornée
 * et le personnage pivote progressivement vers sa direction de marche.
 */
export function stepMovement(
  state: PlayerState,
  input: MoveInput,
  cameraYaw: number,
  running: boolean,
  params: MovementParams,
  dt: number,
): PlayerState {
  const dir = cameraRelativeDirection(input, cameraYaw);
  const moving = dir.x !== 0 || dir.z !== 0;
  const maxSpeed = params.speed * (running ? (params.runMultiplier ?? RUN_MULTIPLIER) : 1);
  const targetVx = dir.x * maxSpeed;
  const targetVz = dir.z * maxSpeed;
  const rate = moving ? (params.acceleration ?? params.speed * 8) : (params.deceleration ?? params.speed * 10);
  let dvx = targetVx - state.vx;
  let dvz = targetVz - state.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDelta = rate * dt;
  if (dv > maxDelta && dv > 0) {
    dvx *= maxDelta / dv;
    dvz *= maxDelta / dv;
  }
  const vx = state.vx + dvx;
  const vz = state.vz + dvz;
  const rotation = moving ? dampAngle(state.rotation, headingOf(dir), params.turnRate ?? 14, dt) : state.rotation;
  return { x: state.x + vx * dt, z: state.z + vz * dt, rotation, vx, vz };
}

export function groundBounds(size: number): Bounds {
  const half = size / 2;
  return { minX: -half, maxX: half, minZ: -half, maxZ: half };
}

export function insideBounds(point: Vec2, bounds: Bounds, margin = 0): boolean {
  return (
    point.x >= bounds.minX + margin &&
    point.x <= bounds.maxX - margin &&
    point.z >= bounds.minZ + margin &&
    point.z <= bounds.maxZ - margin
  );
}

export interface CollisionResult extends Vec2 {
  /** Normales (unitaires, vers l'extérieur de l'obstacle) des contacts rencontrés. */
  normals: Vec2[];
}

/**
 * Repousse un cercle (le joueur) hors des obstacles circulaires puis le confine dans les limites
 * du sol. Plusieurs passes gèrent les obstacles qui se touchent.
 */
export function resolveCollisions(
  position: Vec2,
  radius: number,
  colliders: readonly Circle[],
  bounds?: Bounds | null,
  iterations = 3,
): CollisionResult {
  let { x, z } = position;
  const normals: Vec2[] = [];
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (const c of colliders) {
      const min = c.radius + radius;
      if (min <= 0) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= min * min) continue;
      const dist = Math.sqrt(distSq);
      // Centres confondus : on pousse arbitrairement vers +X.
      const nx = dist > 1e-9 ? dx / dist : 1;
      const nz = dist > 1e-9 ? dz / dist : 0;
      x = c.x + nx * min;
      z = c.z + nz * min;
      normals.push({ x: nx, z: nz });
      moved = true;
    }
    if (bounds) {
      const cx = Math.min(Math.max(x, bounds.minX + radius), bounds.maxX - radius);
      const cz = Math.min(Math.max(z, bounds.minZ + radius), bounds.maxZ - radius);
      if (cx !== x) normals.push({ x: cx > x ? 1 : -1, z: 0 });
      if (cz !== z) normals.push({ x: 0, z: cz > z ? 1 : -1 });
      if (cx !== x || cz !== z) moved = true;
      x = cx;
      z = cz;
    }
    if (!moved) break;
  }
  return { x, z, normals };
}

/** Retire de la vitesse les composantes dirigées vers les obstacles touchés (glissement le long). */
export function slideVelocity(vx: number, vz: number, normals: readonly Vec2[]): { vx: number; vz: number } {
  for (const n of normals) {
    const dot = vx * n.x + vz * n.z;
    if (dot < 0) {
      vx -= dot * n.x;
      vz -= dot * n.z;
    }
  }
  return { vx, vz };
}

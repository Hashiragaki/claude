/**
 * Utilitaires mathématiques purs (sans DOM ni Three.js), partagés par la caméra, la visionneuse
 * et les modes 3D.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ramène un angle (radians) dans l'intervalle ]-π, π]. */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** Plus court écart angulaire signé pour aller de `from` à `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Amortissement exponentiel indépendant du pas de temps : `lambda` est la « raideur »
 * (≈ 1/durée caractéristique). Avec `lambda = 10`, ~63 % de l'écart est comblé en 0,1 s.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (lambda <= 0 || dt <= 0) return current;
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Comme `damp`, mais pour un angle (prend le plus court chemin). */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return wrapAngle(damp(current, current + angleDelta(current, target), lambda, dt));
}

/**
 * Distance à laquelle placer une caméra perspective pour qu'une sphère de rayon `radius` tienne
 * entièrement dans le champ (vertical `fovDeg` et horizontal déduit de `aspect`).
 * `margin` > 1 laisse de l'air autour de l'objet.
 */
export function framingDistance(radius: number, fovDeg: number, aspect: number, margin = 1.15): number {
  const r = Math.max(radius, 1e-3);
  const vHalf = (fovDeg * DEG2RAD) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 1e-3));
  const distance = Math.max(r / Math.sin(vHalf), r / Math.sin(hHalf));
  return distance * margin;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Décalage d'une caméra en orbite autour d'un point : `yaw` autour de Y (0 = derrière, côté +Z),
 * `pitch` au-dessus de l'horizon, `radius` en mètres.
 */
export function orbitOffset(yaw: number, pitch: number, radius: number): Vec3Like {
  const horizontal = Math.cos(pitch) * radius;
  return { x: Math.sin(yaw) * horizontal, y: Math.sin(pitch) * radius, z: Math.cos(yaw) * horizontal };
}

/** Convertit `#rgb` / `#rrggbb` (ou un nombre) en couleur numérique `0xrrggbb`. */
export function parseHexColor(value: string | number | undefined, fallback = 0xffffff): number {
  if (typeof value === 'number') return value;
  if (!value) return fallback;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex))
    return parseInt(
      hex
        .split('')
        .map((c) => c + c)
        .join(''),
      16,
    );
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return parseInt(hex.slice(0, 6), 16);
  return fallback;
}

/** Plus grand rectangle de proportions `aspect` qui tient dans `width × height` (letterbox). */
export function fitAspect(width: number, height: number, aspect: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || aspect <= 0) return { width: Math.max(0, width), height: Math.max(0, height) };
  if (width / height > aspect) return { width: Math.floor(height * aspect), height: Math.floor(height) };
  return { width: Math.floor(width), height: Math.floor(width / aspect) };
}

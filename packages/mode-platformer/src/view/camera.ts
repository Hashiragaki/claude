/**
 * Caméra 2D avec zone morte, bornée au niveau, en pixels entiers (mode plateformer). Pure logique
 * (aucune dépendance Pixi) : facile à faire évoluer sans toucher au rendu.
 */
export interface CameraState {
  /** Centre de la caméra (avant bornage au niveau), en pixels monde. */
  centerX: number;
  centerY: number;
}

export interface CameraResult extends CameraState {
  /** Coin haut-gauche visible, en pixels monde entiers (après bornage). */
  left: number;
  top: number;
}

/** Zone morte : le centre de la caméra ne bouge que lorsque le joueur en sort. */
export const DEAD_ZONE_WIDTH = 48;
export const DEAD_ZONE_HEIGHT = 40;

/**
 * Fait suivre la caméra à `target` (position, en pixels monde) avec une zone morte, puis borne le
 * cadre au niveau (centré si le niveau est plus petit que la vue) et arrondit à des pixels entiers.
 */
export function followCamera(
  prev: CameraState,
  target: { x: number; y: number },
  view: { width: number; height: number },
  level: { width: number; height: number },
  deadZone: { width: number; height: number } = { width: DEAD_ZONE_WIDTH, height: DEAD_ZONE_HEIGHT },
): CameraResult {
  let centerX = prev.centerX;
  let centerY = prev.centerY;
  const halfW = deadZone.width / 2;
  const halfH = deadZone.height / 2;
  const dx = target.x - centerX;
  if (dx > halfW) centerX = target.x - halfW;
  else if (dx < -halfW) centerX = target.x + halfW;
  const dy = target.y - centerY;
  if (dy > halfH) centerY = target.y - halfH;
  else if (dy < -halfH) centerY = target.y + halfH;

  const left = boundAxis(centerX - view.width / 2, view.width, level.width);
  const top = boundAxis(centerY - view.height / 2, view.height, level.height);
  return { centerX, centerY, left: Math.round(left), top: Math.round(top) };
}

function boundAxis(pos: number, viewSize: number, levelSize: number): number {
  if (levelSize <= viewSize) return (levelSize - viewSize) / 2;
  return Math.max(0, Math.min(levelSize - viewSize, pos));
}

/** État initial (avant le premier `followCamera`) : centré sur `target`. */
export function initialCamera(target: { x: number; y: number }): CameraState {
  return { centerX: target.x, centerY: target.y };
}

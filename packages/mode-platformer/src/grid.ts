import { PLATFORM_TILE_ROLES, type TileCollision } from '@forge/core';
import type { LevelLayerName, PlatformerLevel } from './schema';

/**
 * Accès en lecture à la grille de tuiles d'un niveau (couche `terrain` pour les collisions,
 * `decor` pour le rendu). Les coordonnées `tx`/`ty` sont des indices de case (pas des pixels).
 *
 * Hors limites : `x < 0` ou `x >= width` renvoie une collision `solid` (mur invisible sur les
 * côtés) ; `y < 0` (au-dessus du niveau) ou `y >= height` (en dessous) renvoie `none` (le joueur
 * peut sauter au-dessus du niveau ou tomber en dessous, ce qui déclenche la mort par chute).
 */
export class LevelGrid {
  readonly width: number;
  readonly height: number;

  constructor(private readonly level: PlatformerLevel) {
    this.width = level.width;
    this.height = level.height;
  }

  /** Index de tuile brut d'une couche (`-1` hors limites ou case vide). */
  tileAt(layer: LevelLayerName, tx: number, ty: number): number {
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return -1;
    const data = this.level.layers[layer];
    return data[ty * this.width + tx] ?? -1;
  }

  /** Collision de la couche `terrain` à une case, en tenant compte des limites du niveau. */
  collisionAt(tx: number, ty: number): TileCollision {
    if (tx < 0 || tx >= this.width) return 'solid';
    if (ty < 0 || ty >= this.height) return 'none';
    const index = this.tileAt('terrain', tx, ty);
    if (index < 0) return 'none';
    return PLATFORM_TILE_ROLES[index]?.collision ?? 'none';
  }
}

import { TILE_SIZE } from '@forge/core';
import type { LevelGrid } from './grid';
import type { Rect } from './types';

/** Corps physique déplacé par {@link moveBody} : boîte englobante + vitesse + contact au sol. */
export interface Body extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
}

export interface MoveOptions {
  /** Traverse volontairement les plateformes `oneway` en descendant (bas + saut). */
  dropThrough?: boolean;
}

export interface MoveResult {
  /** Un mur `solid` a stoppé le mouvement horizontal. */
  hitWall: boolean;
  /** Un plafond `solid` a stoppé le mouvement vertical montant. */
  hitCeiling: boolean;
  /** Le corps a atterri sur une tuile `solid` ou `oneway` ce pas-ci. */
  landed: boolean;
  /** Chevauche une tuile `hazard` (avec marge) après le déplacement. */
  hazard: boolean;
}

/** Distance maximale parcourue par sous-pas, pour ne jamais traverser une tuile d'un pas. */
const MAX_SUBSTEP = 4;
/** Marge (px) appliquée à la boîte avant de tester le chevauchement avec une tuile `hazard`. */
const HAZARD_MARGIN = 2;
/** Épaisseur de la sonde sous les pieds pour recalculer `onGround`. */
const GROUND_PROBE = 1;
/** Tolérance numérique pour les comparaisons de bords de case. */
const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Cases (inclusives) couvertes par un intervalle de pixels `[from, from + size)`. */
function tileSpan(from: number, size: number): [number, number] {
  const c0 = Math.floor(from / TILE_SIZE);
  const c1 = Math.floor((from + size - EPS) / TILE_SIZE);
  return [c0, Math.max(c0, c1)];
}

function moveX(body: Body, dx: number, grid: LevelGrid): boolean {
  let remaining = dx;
  let hitWall = false;
  while (Math.abs(remaining) > EPS) {
    const step = clamp(remaining, -MAX_SUBSTEP, MAX_SUBSTEP);
    const targetX = body.x + step;
    const [r0, r1] = tileSpan(body.y, body.h);
    let blocked = false;
    if (step > 0) {
      const col = Math.floor((targetX + body.w - EPS) / TILE_SIZE);
      for (let r = r0; r <= r1 && !blocked; r++) {
        if (grid.collisionAt(col, r) === 'solid') {
          body.x = col * TILE_SIZE - body.w;
          blocked = true;
        }
      }
    } else if (step < 0) {
      const col = Math.floor(targetX / TILE_SIZE);
      for (let r = r0; r <= r1 && !blocked; r++) {
        if (grid.collisionAt(col, r) === 'solid') {
          body.x = (col + 1) * TILE_SIZE;
          blocked = true;
        }
      }
    }
    if (blocked) {
      body.vx = 0;
      hitWall = true;
      break;
    }
    body.x = targetX;
    remaining -= step;
  }
  return hitWall;
}

function moveY(
  body: Body,
  dy: number,
  grid: LevelGrid,
  dropThrough: boolean,
): { landed: boolean; hitCeiling: boolean } {
  let remaining = dy;
  let landed = false;
  let hitCeiling = false;
  while (Math.abs(remaining) > EPS) {
    const step = clamp(remaining, -MAX_SUBSTEP, MAX_SUBSTEP);
    const prevBottom = body.y + body.h;
    const targetY = body.y + step;
    const [c0, c1] = tileSpan(body.x, body.w);
    let blocked = false;
    if (step > 0) {
      const bottom = targetY + body.h;
      const row = Math.floor((bottom - EPS) / TILE_SIZE);
      for (let c = c0; c <= c1 && !blocked; c++) {
        const coll = grid.collisionAt(c, row);
        const oneway = coll === 'oneway' && !dropThrough && prevBottom <= row * TILE_SIZE + EPS;
        if (coll === 'solid' || oneway) {
          body.y = row * TILE_SIZE - body.h;
          blocked = true;
        }
      }
    } else if (step < 0) {
      const row = Math.floor(targetY / TILE_SIZE);
      for (let c = c0; c <= c1 && !blocked; c++) {
        if (grid.collisionAt(c, row) === 'solid') {
          body.y = (row + 1) * TILE_SIZE;
          blocked = true;
        }
      }
    }
    if (blocked) {
      body.vy = 0;
      if (step > 0) landed = true;
      else hitCeiling = true;
      break;
    }
    body.y = targetY;
    remaining -= step;
  }
  return { landed, hitCeiling };
}

function checkHazard(body: Body, grid: LevelGrid): boolean {
  const w = body.w - 2 * HAZARD_MARGIN;
  const h = body.h - 2 * HAZARD_MARGIN;
  if (w <= 0 || h <= 0) return false;
  const x = body.x + HAZARD_MARGIN;
  const y = body.y + HAZARD_MARGIN;
  const [c0, c1] = tileSpan(x, w);
  const [r0, r1] = tileSpan(y, h);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid.collisionAt(c, r) === 'hazard') return true;
    }
  }
  return false;
}

function probeGround(body: Body, grid: LevelGrid): boolean {
  const [c0, c1] = tileSpan(body.x, body.w);
  const row = Math.floor((body.y + body.h + GROUND_PROBE - EPS) / TILE_SIZE);
  for (let c = c0; c <= c1; c++) {
    const coll = grid.collisionAt(c, row);
    if (coll === 'solid' || coll === 'oneway') return true;
  }
  return false;
}

/**
 * Déplace un corps de `body.vx * dt`, `body.vy * dt`, axe par axe (X puis Y), en sous-pas d'au
 * plus {@link MAX_SUBSTEP}px pour ne jamais traverser une tuile. Mute `body` (position, vitesse
 * annulée en cas de collision, `onGround` recalculé par une sonde sous les pieds).
 */
export function moveBody(body: Body, dt: number, grid: LevelGrid, opts: MoveOptions = {}): MoveResult {
  const dx = body.vx * dt;
  const dy = body.vy * dt;
  const hitWall = moveX(body, dx, grid);
  const { landed, hitCeiling } = moveY(body, dy, grid, opts.dropThrough ?? false);
  const hazard = checkHazard(body, grid);
  body.onGround = probeGround(body, grid);
  return { hitWall, hitCeiling, landed, hazard };
}

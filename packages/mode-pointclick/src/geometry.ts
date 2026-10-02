import type { Point, Polygon, Shape } from './schema';

/**
 * Géométrie pure du mode point & click : tests d'appartenance, boîtes englobantes, point le plus
 * proche et recherche de chemin dans la zone de marche (union de polygones).
 */

const EPS = 1e-6;
/** Décalage des sommets vers l'intérieur pour que les chemins ne frôlent pas les bords. */
const INSET = 1.5;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Point dans un polygone (lancer de rayon ; bords exacts non garantis). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Point dans une forme (rectangle : bords inclus). */
export function pointInShape(p: Point, shape: Shape): boolean {
  if (shape.type === 'rect')
    return p.x >= shape.x && p.x <= shape.x + shape.w && p.y >= shape.y && p.y <= shape.y + shape.h;
  return pointInPolygon(p, shape.points);
}

/** Boîte englobante d'une forme. */
export function shapeBounds(shape: Shape): Bounds {
  if (shape.type === 'rect') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Point du segment [a, b] le plus proche de p. */
function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function onPolygonEdge(p: Point, poly: readonly Point[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distance(p, closestOnSegment(p, poly[j] as Point, poly[i] as Point)) <= EPS) return true;
  }
  return false;
}

/** Dans la zone de marche (union des polygones), bords inclus. */
export function pointInWalkArea(p: Point, walkArea: readonly Polygon[]): boolean {
  return walkArea.some((poly) => pointInPolygon(p, poly) || onPolygonEdge(p, poly));
}

/** Point de la zone de marche le plus proche de `p` (`p` lui-même s'il est dedans). `undefined` si zone vide. */
export function closestPointInWalkArea(p: Point, walkArea: readonly Polygon[]): Point | undefined {
  if (walkArea.length === 0) return undefined;
  if (pointInWalkArea(p, walkArea)) return { x: p.x, y: p.y };
  let best: Point | undefined;
  let bestD = Infinity;
  let bestAny: Point | undefined;
  let bestAnyD = Infinity;
  for (const poly of walkArea) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const c = closestOnSegment(p, poly[j] as Point, poly[i] as Point);
      const d = distance(p, c);
      if (d < bestAnyD) {
        bestAnyD = d;
        bestAny = c;
      }
      // Un point strictement à l'intérieur d'un autre polygone n'est pas sur le bord de l'union.
      const buried = walkArea.some((o) => o !== poly && pointInPolygon(c, o) && !onPolygonEdge(c, o));
      if (!buried && d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best ?? bestAny;
}

/** Le segment [a, b] reste-t-il entièrement dans la zone de marche ? */
export function segmentInWalkArea(a: Point, b: Point, walkArea: readonly Polygon[]): boolean {
  if (!pointInWalkArea(a, walkArea) || !pointInWalkArea(b, walkArea)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts = [0, 1];
  for (const poly of walkArea) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const c = poly[j] as Point;
      const d = poly[i] as Point;
      const ex = d.x - c.x;
      const ey = d.y - c.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k] as number;
    const t1 = ts[k + 1] as number;
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    if (!pointInWalkArea({ x: a.x + dx * tm, y: a.y + dy * tm }, walkArea)) return false;
  }
  return true;
}

/** Sommet du polygone légèrement rentré vers l'intérieur (null si dégénéré). */
function insetVertex(poly: readonly Point[], i: number): Point | null {
  const n = poly.length;
  const prev = poly[(i + n - 1) % n] as Point;
  const cur = poly[i] as Point;
  const next = poly[(i + 1) % n] as Point;
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = poly[k] as Point;
    const b = poly[(k + 1) % n] as Point;
    area += a.x * b.y - b.x * a.y;
  }
  const side = area >= 0 ? 1 : -1;
  const normal = (a: Point, b: Point): Point => {
    const len = distance(a, b) || 1;
    return { x: (-(b.y - a.y) / len) * side, y: ((b.x - a.x) / len) * side };
  };
  const n1 = normal(prev, cur);
  const n2 = normal(cur, next);
  let bx = n1.x + n2.x;
  let by = n1.y + n2.y;
  const bl = Math.hypot(bx, by);
  if (bl < 1e-9) return null;
  bx /= bl;
  by /= bl;
  return { x: cur.x + bx * INSET, y: cur.y + by * INSET };
}

/**
 * Chemin de `from` à `to` dans la zone de marche : liste de points à parcourir (sans le point de
 * départ, `to` compris, ramené dans la zone si besoin). Ligne droite si possible, sinon graphe de
 * visibilité sur les sommets (rentrés) + Dijkstra. Zone vide ou chemin introuvable : `[]`.
 */
export function findPath(from: Point, to: Point, walkArea: readonly Polygon[]): Point[] {
  if (walkArea.length === 0) return [];
  const target = closestPointInWalkArea(to, walkArea);
  if (!target) return [];
  const start = closestPointInWalkArea(from, walkArea) as Point;
  const head: Point[] = distance(start, from) > EPS ? [start] : [];
  if (distance(start, target) < EPS) return head.length > 0 ? head : [];
  if (segmentInWalkArea(start, target, walkArea)) return [...head, target];

  const nodes: Point[] = [start, target];
  for (const poly of walkArea) {
    for (let i = 0; i < poly.length; i++) {
      const v = insetVertex(poly, i);
      if (v && pointInWalkArea(v, walkArea)) nodes.push(v);
    }
  }
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < n; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < (dist[u] as number))) u = k;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const nd = (dist[u] as number) + distance(nodes[u] as Point, nodes[v] as Point);
      if (nd >= (dist[v] as number)) continue;
      if (segmentInWalkArea(nodes[u] as Point, nodes[v] as Point, walkArea)) {
        dist[v] = nd;
        prev[v] = u;
      }
    }
  }
  if (prev[1] === -1) return [];
  const path: Point[] = [];
  for (let k = 1; k !== -1 && k !== 0; k = prev[k] as number) path.push(nodes[k] as Point);
  path.reverse();
  return [...head, ...path];
}

/** Longueur d'une ligne brisée partant de `from`. */
export function pathLength(from: Point, path: readonly Point[]): number {
  let total = 0;
  let cur = from;
  for (const p of path) {
    total += distance(cur, p);
    cur = p;
  }
  return total;
}

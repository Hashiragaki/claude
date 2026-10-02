import { describe, expect, it } from 'vitest';
import {
  closestPointInWalkArea,
  findPath,
  pathLength,
  pointInPolygon,
  pointInShape,
  pointInWalkArea,
  segmentInWalkArea,
  shapeBounds,
} from './geometry';
import type { Polygon } from './schema';

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** Forme en L : le coin rentrant est en (40, 40), la niche (x > 40, y > 40) est interdite. */
const ell: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 100 },
  { x: 0, y: 100 },
];

describe('pointInPolygon / pointInShape', () => {
  it('détecte les points intérieurs et extérieurs', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
  });

  it('gère un polygone concave', () => {
    expect(pointInPolygon({ x: 70, y: 70 }, ell)).toBe(false);
    expect(pointInPolygon({ x: 20, y: 70 }, ell)).toBe(true);
    expect(pointInPolygon({ x: 70, y: 20 }, ell)).toBe(true);
  });

  it('gère les rectangles (bords inclus) et les polygones', () => {
    const rect = { type: 'rect', x: 10, y: 20, w: 30, h: 40 } as const;
    expect(pointInShape({ x: 10, y: 20 }, rect)).toBe(true);
    expect(pointInShape({ x: 40, y: 60 }, rect)).toBe(true);
    expect(pointInShape({ x: 41, y: 60 }, rect)).toBe(false);
    expect(pointInShape({ x: 5, y: 5 }, { type: 'polygon', points: square })).toBe(true);
  });
});

describe('shapeBounds', () => {
  it("retourne la boîte d'un rectangle et d'un polygone", () => {
    expect(shapeBounds({ type: 'rect', x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(shapeBounds({ type: 'polygon', points: ell })).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('pointInWalkArea / closestPointInWalkArea', () => {
  it("teste l'union des polygones, bords compris", () => {
    const other: Polygon = [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ];
    expect(pointInWalkArea({ x: 25, y: 5 }, [square, other])).toBe(true);
    expect(pointInWalkArea({ x: 15, y: 5 }, [square, other])).toBe(false);
    expect(pointInWalkArea({ x: 10, y: 5 }, [square])).toBe(true);
  });

  it("retourne le point lui-même s'il est dans la zone", () => {
    expect(closestPointInWalkArea({ x: 3, y: 4 }, [square])).toEqual({ x: 3, y: 4 });
  });

  it('projette un point extérieur sur le bord le plus proche', () => {
    const p = closestPointInWalkArea({ x: 25, y: 5 }, [square]);
    expect(p?.x).toBeCloseTo(10);
    expect(p?.y).toBeCloseTo(5);
    const corner = closestPointInWalkArea({ x: 20, y: 20 }, [square]);
    expect(corner).toEqual({ x: 10, y: 10 });
  });

  it('ignore les bords enfouis dans un autre polygone', () => {
    const left: Polygon = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ];
    const right: Polygon = [
      { x: 10, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
    ];
    const p = closestPointInWalkArea({ x: 15, y: 30 }, [left, right]);
    expect(p?.x).toBeCloseTo(15);
    expect(p?.y).toBeCloseTo(10);
  });

  it('retourne undefined pour une zone vide', () => {
    expect(closestPointInWalkArea({ x: 0, y: 0 }, [])).toBeUndefined();
  });
});

describe('segmentInWalkArea', () => {
  it('accepte un segment intérieur et refuse celui qui traverse la niche', () => {
    expect(segmentInWalkArea({ x: 10, y: 10 }, { x: 90, y: 20 }, [ell])).toBe(true);
    expect(segmentInWalkArea({ x: 10, y: 90 }, { x: 90, y: 10 }, [ell])).toBe(false);
  });

  it("accepte un segment qui passe d'un polygone chevauchant à l'autre", () => {
    const b: Polygon = [
      { x: 8, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 8, y: 10 },
    ];
    expect(segmentInWalkArea({ x: 1, y: 5 }, { x: 19, y: 5 }, [square, b])).toBe(true);
  });
});

describe('findPath', () => {
  it('retourne [] pour une zone vide', () => {
    expect(findPath({ x: 0, y: 0 }, { x: 5, y: 5 }, [])).toEqual([]);
  });

  it("va en ligne droite quand c'est possible", () => {
    expect(findPath({ x: 1, y: 1 }, { x: 9, y: 9 }, [square])).toEqual([{ x: 9, y: 9 }]);
  });

  it('ramène une destination extérieure dans la zone', () => {
    const path = findPath({ x: 1, y: 1 }, { x: 50, y: 5 }, [square]);
    expect(path).toHaveLength(1);
    expect(path[0]?.x).toBeCloseTo(10);
    expect(path[0]?.y).toBeCloseTo(5);
  });

  it("contourne le coin rentrant d'une zone en L", () => {
    const from = { x: 10, y: 90 };
    const to = { x: 90, y: 10 };
    const path = findPath(from, to, [ell]);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[path.length - 1]).toEqual(to);
    let cur = from;
    for (const p of path) {
      expect(segmentInWalkArea(cur, p, [ell])).toBe(true);
      cur = p;
    }
    // le détour reste proche du chemin idéal (via le coin 40,40)
    const ideal = Math.hypot(30, 50) + Math.hypot(50, 30);
    expect(pathLength(from, path)).toBeLessThan(ideal + 5);
  });

  it('retourne [] si départ et arrivée coïncident', () => {
    expect(findPath({ x: 5, y: 5 }, { x: 5, y: 5 }, [square])).toEqual([]);
  });

  it('ne trouve pas de chemin entre deux polygones disjoints', () => {
    const far: Polygon = [
      { x: 100, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 10 },
      { x: 100, y: 10 },
    ];
    expect(findPath({ x: 5, y: 5 }, { x: 105, y: 5 }, [square, far])).toEqual([]);
  });
});

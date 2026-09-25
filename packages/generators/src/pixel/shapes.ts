import { PixelCanvas } from './canvas';

/**
 * Formes « analytiques » échantillonnées au centre des pixels, avec un éclairage venant d'en haut
 * à gauche. Elles permettent de dessiner des sprites nets et ombrés à n'importe quelle taille
 * (8 à 64 px) à partir de coordonnées unitaires (0–1).
 */
export interface Shape {
  contains(u: number, v: number): boolean;
  /** Éclairage dans [0, 1] (0 = ombre, 1 = lumière). */
  light(u: number, v: number): number;
}

const L = (() => {
  const v = [-0.55, -0.7, 0.6];
  const n = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
  return v.map((x) => x / n) as [number, number, number];
})();

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Sphère (ou ellipsoïde) : ombrage 3D. */
export function sphere(cx: number, cy: number, rx: number, ry = rx): Shape {
  return {
    contains: (u, v) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1,
    light: (u, v) => {
      const nx = (u - cx) / rx;
      const ny = (v - cy) / ry;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      return clamp01(0.5 + 0.62 * (nx * L[0] + ny * L[1] + nz * L[2]) - 0.12);
    },
  };
}

/** Rectangle (coins éventuellement arrondis) ombré comme un cylindre vertical. */
export function box(x0: number, y0: number, x1: number, y1: number, radius = 0, flat = false): Shape {
  return {
    contains: (u, v) => {
      if (u < x0 || u > x1 || v < y0 || v > y1) return false;
      if (radius <= 0) return true;
      const cx = u < x0 + radius ? x0 + radius : u > x1 - radius ? x1 - radius : u;
      const cy = v < y0 + radius ? y0 + radius : v > y1 - radius ? y1 - radius : v;
      return (u - cx) ** 2 + (v - cy) ** 2 <= radius * radius;
    },
    light: (u, v) => {
      const tx = (u - x0) / Math.max(1e-6, x1 - x0);
      const ty = (v - y0) / Math.max(1e-6, y1 - y0);
      if (flat) return clamp01(0.72 - tx * 0.35 - ty * 0.2);
      const cyl = Math.sin(Math.PI * clamp01(tx * 0.85 + 0.1));
      return clamp01(0.25 + cyl * 0.55 - tx * 0.25 + (ty < 0.12 ? 0.15 : 0));
    },
  };
}

/** Capsule (segment épais) ombrée comme un cylindre le long du segment. */
export function capsule(ax: number, ay: number, bx: number, by: number, r: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const len = Math.sqrt(len2);
  const px = -dy / len;
  const py = dx / len;
  const side = px * L[0] + py * L[1] >= 0 ? 1 : -1;
  return {
    contains: (u, v) => {
      const t = clamp01(((u - ax) * dx + (v - ay) * dy) / len2);
      return (u - ax - dx * t) ** 2 + (v - ay - dy * t) ** 2 <= r * r;
    },
    light: (u, v) => {
      const s = (((u - ax) * px + (v - ay) * py) / r) * side;
      return clamp01(0.5 + 0.45 * s);
    },
  };
}

/** Polygone quelconque ; l'éclairage suit un dégradé haut-gauche → bas-droite. */
export function polygon(pts: readonly (readonly [number, number])[], lightFn?: (u: number, v: number) => number): Shape {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  return {
    contains: (u, v) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i] as [number, number];
        const [xj, yj] = pts[j] as [number, number];
        if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    light: lightFn ?? ((u, v) => clamp01(0.85 - ((u - minX) / w) * 0.45 - ((v - minY) / h) * 0.35)),
  };
}

/** Anneau (tore vu de face). */
export function ring(cx: number, cy: number, rOut: number, rIn: number, ry = 1): Shape {
  return {
    contains: (u, v) => {
      const d = Math.hypot(u - cx, (v - cy) / ry);
      return d <= rOut && d >= rIn;
    },
    light: (u, v) => {
      const d = Math.hypot(u - cx, (v - cy) / ry) || 1e-6;
      const mid = (rOut + rIn) / 2;
      const across = (d - mid) / ((rOut - rIn) / 2);
      const nx = ((u - cx) / d) * across;
      const ny = (((v - cy) / ry) / d) * across;
      const nz = Math.sqrt(Math.max(0, 1 - across * across));
      return clamp01(0.45 + 0.6 * (nx * L[0] + ny * L[1] + nz * L[2]) - 0.1);
    },
  };
}

/** Forme définie par une fonction d'appartenance et un éclairage constant ou calculé. */
export function custom(contains: (u: number, v: number) => boolean, light: number | ((u: number, v: number) => number)): Shape {
  return { contains, light: typeof light === 'number' ? () => light : light };
}

export function subtract(a: Shape, b: Shape): Shape {
  return { contains: (u, v) => a.contains(u, v) && !b.contains(u, v), light: a.light };
}

export function intersect(a: Shape, b: Shape): Shape {
  return { contains: (u, v) => a.contains(u, v) && b.contains(u, v), light: a.light };
}

/** Choisit un ton dans une rampe (sombre → clair) selon l'éclairage, par paliers nets. */
export function pickTone(ramp: readonly string[], t: number): string {
  const n = ramp.length;
  if (n === 1) return ramp[0] as string;
  const thresholds = n === 2 ? [0.5] : n === 3 ? [0.36, 0.7] : n === 4 ? [0.3, 0.58, 0.87] : [0.22, 0.42, 0.62, 0.86];
  let i = 0;
  while (i < thresholds.length && t >= (thresholds[i] as number)) i++;
  return ramp[Math.min(i, n - 1)] as string;
}

export interface SpriteOptions {
  /** Couleur du contour extérieur. */
  outline: string;
  /** Marge (pixels) laissée autour du dessin pour le contour. */
  margin?: number;
}

/** Sprite dessiné en coordonnées unitaires, centré dans une toile de taille quelconque. */
export class Sprite {
  readonly canvas: PixelCanvas;
  readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly options: SpriteOptions,
  ) {
    this.canvas = new PixelCanvas(width, height);
    const margin = options.margin ?? 1;
    this.scale = Math.min(width, height) - margin * 2;
    this.ox = (width - this.scale) / 2;
    this.oy = (height - this.scale) / 2;
  }

  /** Coordonnée unitaire → pixel. */
  px(u: number): number {
    return Math.floor(this.ox + u * this.scale);
  }

  py(v: number): number {
    return Math.floor(this.oy + v * this.scale);
  }

  private uv(x: number, y: number): [number, number] {
    return [(x + 0.5 - this.ox) / this.scale, (y + 0.5 - this.oy) / this.scale];
  }

  /**
   * Remplit une forme avec une rampe de tons. `outlined` trace son propre contour par-dessus ce
   * qui est déjà dessiné (séparation nette entre les pièces).
   */
  fill(shape: Shape, ramp: readonly string[], opts: { outlined?: boolean; onlyFilled?: boolean } = {}): this {
    const target = opts.outlined ? new PixelCanvas(this.width, this.height) : this.canvas;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const [u, v] = this.uv(x, y);
        if (!shape.contains(u, v)) continue;
        if (opts.onlyFilled && !this.canvas.filled(x, y)) continue;
        target.set(x, y, pickTone(ramp, shape.light(u, v)));
      }
    }
    if (opts.outlined) {
      target.outline(this.options.outline);
      this.canvas.draw(target);
    }
    return this;
  }

  /** Pose un pixel à une coordonnée unitaire. */
  dot(u: number, v: number, color: string, onlyFilled = true): this {
    const x = this.px(u);
    const y = this.py(v);
    if (!onlyFilled || this.canvas.filled(x, y)) this.canvas.set(x, y, color);
    return this;
  }

  /** Trait entre deux points unitaires. */
  line(u0: number, v0: number, u1: number, v1: number, color: string): this {
    this.canvas.line(this.px(u0), this.py(v0), this.px(u1), this.py(v1), color);
    return this;
  }

  /** Termine le sprite : contour extérieur. */
  finish(): PixelCanvas {
    this.canvas.outline(this.options.outline);
    return this.canvas;
  }
}

import { parseColor, type Rgba } from '../shared/color';
import { encodePng } from '../encode/png';

const colorCache = new Map<string, Rgba>();

function rgbaOf(color: string | Rgba): Rgba {
  if (typeof color !== 'string') return color;
  let c = colorCache.get(color);
  if (!c) {
    c = parseColor(color);
    colorCache.set(color, c);
  }
  return c;
}

/** Toile RVBA pour dessiner du pixel-art pixel par pixel. */
export class PixelCanvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Alpha du pixel (0 hors de la toile). */
  alpha(x: number, y: number): number {
    return this.inBounds(x, y) ? (this.data[(y * this.width + x) * 4 + 3] as number) : 0;
  }

  filled(x: number, y: number): boolean {
    return this.alpha(x, y) > 0;
  }

  get(x: number, y: number): Rgba {
    if (!this.inBounds(x, y)) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i] as number, d[i + 1] as number, d[i + 2] as number, d[i + 3] as number];
  }

  /** Remplace un pixel (les coordonnées sont arrondies à l'entier inférieur). */
  set(x: number, y: number, color: string | Rgba): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (!this.inBounds(px, py)) return;
    const c = rgbaOf(color);
    this.data.set(c, (py * this.width + px) * 4);
  }

  /** Ne dessine que sur un pixel déjà rempli (ombrage, détails). */
  paint(x: number, y: number, color: string | Rgba): void {
    if (this.filled(Math.floor(x), Math.floor(y))) this.set(x, y, color);
  }

  clear(x: number, y: number): void {
    this.set(x, y, [0, 0, 0, 0]);
  }

  rect(x: number, y: number, w: number, h: number, color: string | Rgba): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  hline(x1: number, x2: number, y: number, color: string | Rgba): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.set(x, y, color);
  }

  vline(x: number, y1: number, y2: number, color: string | Rgba): void {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.set(x, y, color);
  }

  /** Segment (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, color: string | Rgba): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, color);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Ellipse pleine centrée sur (cx, cy) — centres de pixels. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string | Rgba): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / (rx || 0.5);
        const dy = (y + 0.5 - cy) / (ry || 0.5);
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }

  /**
   * Ajoute un contour d'1 pixel autour de tout ce qui est dessiné (sur les pixels transparents
   * voisins). `diagonals` inclut les coins pour un contour plus épais.
   */
  outline(color: string | Rgba, diagonals = false): void {
    const targets: [number, number][] = [];
    const n4: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const n8 = diagonals ? [...n4, [1, 1], [1, -1], [-1, 1], [-1, -1]] : n4;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.filled(x, y)) continue;
        if (n8.some(([dx, dy]) => this.filled(x + (dx as number), y + (dy as number)))) targets.push([x, y]);
      }
    }
    for (const [x, y] of targets) this.set(x, y, color);
  }

  /** Copie les pixels non transparents d'une autre toile. */
  draw(src: PixelCanvas, dx = 0, dy = 0): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.set(x + dx, y + dy, c);
      }
    }
  }

  /** Copie miroir horizontal. */
  flipX(): PixelCanvas {
    const out = new PixelCanvas(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out.set(this.width - 1 - x, y, this.get(x, y));
    }
    return out;
  }

  toPng(): Uint8Array {
    return encodePng(this.width, this.height, this.data);
  }
}

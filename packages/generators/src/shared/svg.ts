/** Petits utilitaires pour écrire du SVG compact à la main. */

export type Attrs = Record<string, string | number | undefined | null | false>;

/** Formate un nombre avec au plus `digits` décimales (SVG plus léger). */
export function num(value: number, digits = 1): string {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? '0' : String(r);
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrString(attrs: Attrs): string {
  let out = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    const v = typeof value === 'number' ? num(value, 2) : escapeXml(value);
    out += ` ${key}="${v}"`;
  }
  return out;
}

/** Construit un élément : `el('rect', { width: 4 })` → `<rect width="4"/>`. */
export function el(tag: string, attrs: Attrs = {}, children?: string | string[]): string {
  const body = Array.isArray(children) ? children.join('') : children;
  return body === undefined || body === ''
    ? `<${tag}${attrString(attrs)}/>`
    : `<${tag}${attrString(attrs)}>${body}</${tag}>`;
}

export const g = (attrs: Attrs, children: string | string[]) => el('g', attrs, children);

/** Document SVG complet avec `xmlns`, `width`, `height` et `viewBox`. */
export function svgDocument(
  width: number,
  height: number,
  body: string | string[],
  options: { viewBox?: [number, number, number, number]; defs?: string | string[]; preserve?: string } = {},
): string {
  const vb = options.viewBox ?? [0, 0, width, height];
  const defs = Array.isArray(options.defs) ? options.defs.join('') : (options.defs ?? '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}"` +
    ` viewBox="${vb.map((v) => num(v)).join(' ')}"` +
    (options.preserve ? ` preserveAspectRatio="${options.preserve}"` : '') +
    '>' +
    (defs ? `<defs>${defs}</defs>` : '') +
    (Array.isArray(body) ? body.join('') : body) +
    '</svg>'
  );
}

export type GradientStop = [offset: number, color: string, opacity?: number];

function stops(list: GradientStop[]): string {
  return list
    .map(([o, c, a]) =>
      el('stop', {
        offset: num(o, 3),
        'stop-color': c,
        'stop-opacity': a === undefined ? undefined : a,
      })
    )
    .join('');
}

/** Dégradé linéaire (coordonnées relatives à la boîte : 0–1). */
export function linearGradient(
  id: string,
  list: GradientStop[],
  dir: [number, number, number, number] = [0, 0, 0, 1],
): string {
  const [x1, y1, x2, y2] = dir;
  return el('linearGradient', { id, x1, y1, x2, y2 }, stops(list));
}

/** Dégradé radial (coordonnées relatives à la boîte : 0–1). */
export function radialGradient(
  id: string,
  list: GradientStop[],
  opts: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {},
): string {
  return el(
    'radialGradient',
    {
      id,
      cx: opts.cx ?? 0.5,
      cy: opts.cy ?? 0.5,
      r: opts.r ?? 0.5,
      fx: opts.fx,
      fy: opts.fy,
    },
    stops(list)
  );
}

/** Dégradé en coordonnées absolues (userSpaceOnUse), pratique pour les grands décors. */
export function linearGradientAbs(
  id: string,
  list: GradientStop[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return el(
    'linearGradient',
    { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 },
    stops(list)
  );
}

export function radialGradientAbs(id: string, list: GradientStop[], cx: number, cy: number, r: number): string {
  return el('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx, cy, r }, stops(list));
}

/** Construit l'attribut `d` d'un chemin à partir de commandes et de nombres. */
export function d(...parts: (string | number)[]): string {
  return parts.map((p) => (typeof p === 'number' ? num(p) : p)).join(' ');
}

/** Liste de points `x,y x,y` pour `<polygon>` / `<polyline>`. */
export function points(list: readonly (readonly [number, number])[]): string {
  return list.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
}

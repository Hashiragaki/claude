import { mix } from '../shared/color';
import { el, linearGradient, radialGradient, svgDocument, type Attrs, type GradientStop } from '../shared/svg';

export const SVG_STYLES = ['flat', 'soft', 'lineart', 'retro'] as const;
export type SvgStyle = (typeof SVG_STYLES)[number];

/**
 * Construit un dessin SVG en tenant compte du style demandé :
 * - `soft` : dégradés et contours doux (rendu par défaut) ;
 * - `flat` : aplats, sans dégradés ni contours ;
 * - `lineart` : contours épais et couleurs éclaircies ;
 * - `retro` : aplats, contours et postérisation des couleurs.
 */
export class SvgBuilder {
  private readonly defs: string[] = [];
  private readonly body: string[] = [];
  private counter = 0;

  constructor(
    readonly style: SvgStyle,
    readonly lineColor = '#2b2233',
    private readonly prefix = 'f',
  ) {}

  get gradients(): boolean {
    return this.style === 'soft';
  }

  id(name: string): string {
    return `${this.prefix}${name}${this.counter++}`;
  }

  /** Adapte une couleur au style (éclaircie en lineart). */
  c(color: string): string {
    return this.style === 'lineart' ? mix(color, '#ffffff', 0.25) : color;
  }

  /** Dégradé linéaire (ou couleur médiane hors style `soft`). */
  lin(list: GradientStop[], dir: [number, number, number, number] = [0, 0, 0, 1]): string {
    if (!this.gradients) return this.c(list[Math.floor((list.length - 1) / 2)]?.[1] ?? '#000000');
    const id = this.id('g');
    this.defs.push(linearGradient(id, list, dir));
    return `url(#${id})`;
  }

  /** Dégradé radial (ou première couleur hors style `soft`). */
  rad(list: GradientStop[], opts: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {}): string {
    if (!this.gradients) return this.c(list[0]?.[1] ?? '#000000');
    const id = this.id('r');
    this.defs.push(radialGradient(id, list, opts));
    return `url(#${id})`;
  }

  /** Dégradé radial affiché dans tous les styles (lueurs, halos). */
  glow(color: string, opacity = 0.8): string {
    const id = this.id('glow');
    this.defs.push(radialGradient(id, [[0, color, opacity], [1, color, 0]]));
    return `url(#${id})`;
  }

  def(markup: string): void {
    this.defs.push(markup);
  }

  /** Attributs de contour principal selon le style (épaisseur relative `scale`). */
  line(scale = 1, color = this.lineColor): Attrs {
    switch (this.style) {
      case 'flat':
        return {};
      case 'soft':
        return { stroke: color, 'stroke-width': 2.5 * scale, 'stroke-opacity': 0.55, 'stroke-linejoin': 'round' };
      case 'lineart':
        return { stroke: color, 'stroke-width': 5 * scale, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      case 'retro':
        return { stroke: color, 'stroke-width': 4 * scale, 'stroke-linejoin': 'round' };
    }
  }

  add(...parts: string[]): this {
    this.body.push(...parts);
    return this;
  }

  /** Ajoute un élément (raccourci de `el`). */
  e(tag: string, attrs: Attrs, children?: string | string[]): this {
    this.body.push(el(tag, attrs, children));
    return this;
  }

  /**
   * Document final : `viewBox` de conception, rendu à `width × height`. `cover` recadre pour
   * remplir (décors) au lieu de tout faire tenir (personnages, objets).
   */
  toSvg(width: number, height: number, viewBox: [number, number, number, number], cover = false): string {
    let body = this.body.join('');
    if (this.style === 'retro') {
      const id = this.id('post');
      const table = '0 0.2 0.4 0.6 0.8 1';
      this.defs.push(
        el(
          'filter',
          { id, 'color-interpolation-filters': 'sRGB' },
          el('feComponentTransfer', {}, [
            el('feFuncR', { type: 'discrete', tableValues: table }),
            el('feFuncG', { type: 'discrete', tableValues: table }),
            el('feFuncB', { type: 'discrete', tableValues: table }),
          ]),
        ),
      );
      body = el('g', { filter: `url(#${id})` }, body);
    }
    return svgDocument(width, height, body, { viewBox, defs: this.defs, preserve: cover ? 'xMidYMid slice' : undefined });
  }
}

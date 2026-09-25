import { Resvg } from '@resvg/resvg-js';

/** Rasterise un SVG en PNG (resvg), à la largeur demandée. */
export async function rasterizeSvg(svg: string, width: number, _height: number): Promise<Uint8Array> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(width)) },
    font: { loadSystemFonts: true },
    shapeRendering: 2,
    textRendering: 1,
  });
  return new Uint8Array(resvg.render().asPng());
}

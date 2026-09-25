import type { Rng } from '@forge/core';
import { mix, shade } from '../../shared/color';
import { el } from '../../shared/svg';
import { SvgBuilder, type SvgStyle } from '../builder';
import { drawBody } from './body';
import { drawBrows, drawFace } from './face';
import { backHeadPath, drawBackHair, drawFrontHair, frontHairPath, hairColors } from './hair';
import { expressionFromText, resolveIdentity, type Expression, type PortraitInput } from './identity';

export { EXPRESSIONS, HAIR_STYLES, type Expression, type PortraitHairStyle } from './identity';

const FACE =
  'M195 250C195 150 405 150 405 250C405 330 395 380 365 418C340 445 318 455 300 455C282 455 260 445 235 418C205 380 195 330 195 250Z';
const EAR_L = 'M200 296C182 288 176 322 184 342C188 352 198 354 205 348Z';
const EAR_R = 'M400 296C418 288 424 322 416 342C412 352 402 354 395 348Z';

export interface PortraitOptions extends PortraitInput {
  expression?: Expression;
  style: SvgStyle;
  width: number;
  height: number;
}

/**
 * Sprite de personnage de visual novel (en buste, fond transparent), dessiné dans un repère
 * 600 × 900. L'identité (couleurs, coiffure, tenue) dérive de `character` pour rester la même
 * d'une expression à l'autre ; l'expression change les yeux, sourcils, bouche, joues et effets.
 */
export function drawPortrait(opts: PortraitOptions, rng: Rng): string {
  const id = resolveIdentity(opts, rng);
  const expression = opts.expression ?? expressionFromText(opts.prompt ?? '') ?? 'neutral';
  const line = mix(shade(id.hair, -0.62), '#2a1a2a', 0.45);
  const b = new SvgBuilder(opts.style, line, 'p');
  const skinShadow = mix(shade(id.skin, -0.12), '#e07088', 0.18);
  const hc = hairColors(id.hair, line);
  const faceClip = b.id('face');
  b.def(el('clipPath', { id: faceClip }, el('path', { d: FACE })));
  const skinFill = b.lin([
    [0, shade(id.skin, 0.06)],
    [1, id.skin],
  ]);
  const lineAttrs = b.line(1.2, line);

  b.add(drawBackHair(b, id, hc));
  b.add(drawBody(b, id, { skin: id.skin, skinShadow, line }));
  b.e('path', { d: backHeadPath(id.hairStyle), fill: hc.dark, ...lineAttrs });
  b.e('path', { d: EAR_L, fill: id.skin, ...lineAttrs });
  b.e('path', { d: EAR_R, fill: id.skin, ...lineAttrs });
  b.e('path', {
    d: 'M196 308Q188 318 194 334M404 308Q412 318 406 334',
    fill: 'none',
    stroke: skinShadow,
    'stroke-width': 3,
  });
  b.e('path', { d: FACE, fill: skinFill, ...lineAttrs });
  b.e('g', { 'clip-path': `url(#${faceClip})` }, [
    el('path', { d: 'M392 250C412 330 392 400 330 452L420 470L430 240Z', fill: skinShadow, opacity: 0.4 }),
    el('path', {
      d: frontHairPath(id.hairStyle),
      fill: mix(skinShadow, hc.dark, 0.15),
      opacity: 0.55,
      transform: 'translate(3 11)',
    }),
  ]);
  const faceColors = {
    skin: id.skin,
    skinShadow,
    line,
    lash: mix(shade(id.hair, -0.7), '#1a1020', 0.6),
    brow: mix(shade(id.hair, -0.35), '#2a1a2a', 0.25),
  };
  b.add(drawFace(b, id, expression, faceColors));
  b.add(drawFrontHair(b, id, hc));
  b.add(drawBrows(expression, faceColors));
  return b.toSvg(opts.width, opts.height, [0, 0, 600, 900]);
}

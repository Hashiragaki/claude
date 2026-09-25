import { mix, shade } from '../../shared/color';
import { el } from '../../shared/svg';
import type { SvgBuilder } from '../builder';
import type { PortraitIdentity } from './identity';

export const TORSO =
  'M268 488C215 496 158 505 132 545C110 580 108 650 112 900L488 900C492 650 490 580 468 545C445 505 385 496 332 488Z';

const TORSO_SHADOW = 'M392 500C438 512 464 540 474 590C486 660 484 760 488 900L432 900C440 760 436 640 418 580C408 550 400 520 392 500Z';

export interface BodyColors {
  skin: string;
  skinShadow: string;
  line: string;
}

function mirror(path: string): string {
  // Symétrie horizontale autour de x = 300 pour un chemin en commandes absolues « x y ».
  return path.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${600 - Number(x)} ${y}`);
}

/** Cou, torse, tenue et ombrages. */
export function drawBody(b: SvgBuilder, id: PortraitIdentity, c: BodyColors): string {
  const o = id.outfit;
  const oDark = shade(o, -0.28);
  const oLight = shade(o, 0.18);
  const line = b.line(1.2, c.line);
  const fill = b.lin([
    [0, oLight],
    [0.5, o],
    [1, shade(o, -0.12)],
  ]);
  const parts: string[] = [
    el('path', { d: 'M270 410L330 410L335 505Q300 522 265 505Z', fill: c.skin, ...line }),
    el('path', { d: 'M270 426Q300 468 330 426L332 462Q300 490 268 462Z', fill: c.skinShadow, opacity: 0.85 }),
    el('path', { d: TORSO, fill, ...line }),
    el('path', { d: TORSO_SHADOW, fill: oDark, opacity: 0.45 }),
    el('path', { d: 'M172 610C166 700 168 800 172 900M428 610C434 700 432 800 428 900', fill: 'none', stroke: oDark, 'stroke-width': 4, opacity: 0.7 }),
  ];
  const white = '#f6f5fa';
  const whiteShade = '#d8d6e6';
  switch (id.outfitKind) {
    case 'school': {
      parts.push(el('path', { d: 'M266 490L300 612L334 490Z', fill: white }));
      const lapel = 'M262 492C264 540 282 600 300 652L244 572C234 540 240 510 262 492Z';
      parts.push(el('path', { d: lapel, fill: oDark, ...line }), el('path', { d: mirror(lapel), fill: oDark, ...line }));
      const collar = 'M266 488L290 538L300 506Z';
      parts.push(el('path', { d: collar, fill: white, stroke: whiteShade, 'stroke-width': 2 }), el('path', { d: mirror(collar), fill: white, stroke: whiteShade, 'stroke-width': 2 }));
      const a = id.accent;
      parts.push(
        el('path', { d: 'M300 540L262 520L266 562Z', fill: a, ...line }),
        el('path', { d: 'M300 540L338 520L334 562Z', fill: shade(a, -0.12), ...line }),
        el('path', { d: 'M296 546L282 600L296 594L300 604L304 594L318 600L304 546Z', fill: shade(a, -0.08), ...line }),
        el('circle', { cx: 300, cy: 541, r: 9, fill: shade(a, 0.12), ...line }),
        el('path', { d: 'M300 652L300 900', stroke: oDark, 'stroke-width': 3 }),
        el('circle', { cx: 312, cy: 700, r: 6, fill: '#e8c060', ...line }),
        el('circle', { cx: 312, cy: 780, r: 6, fill: '#e8c060', ...line }),
        el('path', { d: 'M366 640L402 640L402 668Q384 682 366 668Z', fill: shade(a, 0.1), ...b.line(0.8, c.line) }),
      );
      break;
    }
    case 'casual': {
      const hood = 'M232 500C246 470 354 470 368 500C392 516 402 540 392 566C356 532 244 532 208 566C198 540 208 516 232 500Z';
      parts.push(el('path', { d: hood, fill: oDark, ...line }));
      parts.push(el('path', { d: 'M266 494Q300 536 334 494Z', fill: id.accent, ...line }));
      parts.push(
        el('path', { d: 'M284 528L278 640M316 528L322 640', stroke: '#f0eef6', 'stroke-width': 4, 'stroke-linecap': 'round' }),
        el('rect', { x: 273, y: 636, width: 10, height: 18, rx: 4, fill: id.accent }),
        el('rect', { x: 317, y: 636, width: 10, height: 18, rx: 4, fill: id.accent }),
        el('path', { d: 'M196 790L404 790L426 900L174 900Z', fill: shade(o, -0.1), ...line }),
        el('path', { d: 'M214 800L386 800', stroke: oLight, 'stroke-width': 3, opacity: 0.6 }),
      );
      break;
    }
    case 'fantasy': {
      const cloakColor = shade(mix(id.accent, o, 0.35), -0.25);
      const cloak = 'M270 488C220 498 152 508 126 548C100 588 96 700 96 900L172 900C176 760 192 640 240 562C252 540 262 512 270 488Z';
      parts.push(el('path', { d: 'M278 490L300 566L322 490Z', fill: c.skin }));
      parts.push(el('path', { d: 'M278 490L300 566L322 490', fill: 'none', stroke: '#e8c060', 'stroke-width': 5, 'stroke-linejoin': 'round' }));
      parts.push(
        el('path', { d: 'M236 560L266 560L436 900L398 900Z', fill: '#6a4428', ...line }),
        el('rect', { x: 312, y: 700, width: 30, height: 24, rx: 4, fill: '#e8c060', ...line, transform: 'rotate(28 327 712)' }),
        el('path', { d: cloak, fill: cloakColor, ...line }),
        el('path', { d: mirror(cloak), fill: shade(cloakColor, -0.12), ...line }),
        el('circle', { cx: 262, cy: 508, r: 13, fill: '#e8c060', ...line }),
        el('circle', { cx: 338, cy: 508, r: 13, fill: '#e8c060', ...line }),
        el('path', { d: 'M275 512Q300 526 325 512', fill: 'none', stroke: '#c89a40', 'stroke-width': 4 }),
        el('circle', { cx: 258, cy: 504, r: 4, fill: '#fff4c0' }),
      );
      break;
    }
    case 'formal': {
      parts.push(el('path', { d: 'M268 490L300 650L332 490Z', fill: white }));
      const collar = 'M266 486L292 532L300 504Z';
      parts.push(el('path', { d: collar, fill: white, stroke: whiteShade, 'stroke-width': 2 }), el('path', { d: mirror(collar), fill: white, stroke: whiteShade, 'stroke-width': 2 }));
      const tie = id.accent;
      parts.push(
        el('path', { d: 'M290 504L310 504L306 522L294 522Z', fill: shade(tie, 0.1), ...line }),
        el('path', { d: 'M294 522L306 522L316 640L300 664L284 640Z', fill: tie, ...line }),
        el('path', { d: 'M296 560L312 548M290 600L314 584', stroke: shade(tie, -0.3), 'stroke-width': 3, opacity: 0.6 }),
      );
      const lapel = 'M260 492C262 540 282 610 300 668L250 600L262 574L238 566C232 536 240 508 260 492Z';
      parts.push(el('path', { d: lapel, fill: oDark, ...line }), el('path', { d: mirror(lapel), fill: oDark, ...line }));
      parts.push(el('path', { d: 'M372 628L400 628L392 612Z', fill: id.accent, ...b.line(0.6, c.line) }));
      break;
    }
  }
  return parts.join('');
}

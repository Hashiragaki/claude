import { mix, shade } from '../../shared/color';
import { d, el } from '../../shared/svg';
import { H, SKY, W, ambience, halo, type Scene } from './common';

/** Vue par une fenêtre : ciel du moment, silhouettes lointaines. */
function windowView(s: Scene, x: number, y: number, w: number, h: number, city: boolean): void {
  const [top, mid, low] = SKY[s.time];
  const clip = s.b.id('win');
  s.b.def(el('clipPath', { id: clip }, el('rect', { x, y, width: w, height: h })));
  const parts: string[] = [el('rect', { x, y, width: w, height: h, fill: s.b.lin([[0, top], [0.6, mid], [1, low]]) })];
  if (s.time === 'night') {
    for (let i = 0; i < 18; i++) parts.push(el('circle', { cx: x + s.rng.float(0, w), cy: y + s.rng.float(0, h * 0.6), r: 1.8, fill: '#ffffff' }));
    parts.push(el('circle', { cx: x + w * 0.75, cy: y + h * 0.25, r: 22, fill: '#f4f2e0' }));
  } else {
    parts.push(el('circle', { cx: x + w * 0.75, cy: y + h * (s.time === 'sunset' ? 0.7 : 0.25), r: 30, fill: s.time === 'sunset' ? '#ffd98a' : '#fff8e0' }));
    parts.push(el('ellipse', { cx: x + w * 0.3, cy: y + h * 0.3, rx: 60, ry: 18, fill: '#ffffff', opacity: 0.8 }));
  }
  if (city) {
    let bx = x - 10;
    const far = s.L('#7a86a8');
    while (bx < x + w) {
      const bw = s.rng.float(40, 80);
      const bh = s.rng.float(60, h * 0.55);
      parts.push(el('rect', { x: bx, y: y + h - bh, width: bw, height: bh, fill: far }));
      if (s.time === 'night') {
        for (let k = 0; k < 3; k++) parts.push(el('rect', { x: bx + 8 + k * 12, y: y + h - bh + 14, width: 6, height: 8, fill: '#ffd27a' }));
      }
      bx += bw + 6;
    }
  } else {
    parts.push(el('path', { d: d('M', x, y + h * 0.8, 'Q', x + w * 0.3, y + h * 0.62, x + w * 0.6, y + h * 0.78, 'T', x + w, y + h * 0.7, 'V', y + h, 'H', x, 'Z'), fill: s.L('#5a9a5a') }));
  }
  s.b.e('g', { 'clip-path': `url(#${clip})` }, parts);
}

function frame(s: Scene, x: number, y: number, w: number, h: number, color: string, cross = true): void {
  s.b.e('rect', { x, y, width: w, height: h, fill: 'none', stroke: color, 'stroke-width': 14 });
  if (cross) s.b.e('path', { d: d('M', x + w / 2, y, 'V', y + h, 'M', x, y + h / 2, 'H', x + w), stroke: color, 'stroke-width': 8 });
  s.b.e('rect', { x: x - 16, y: y + h + 4, width: w + 32, height: 14, rx: 4, fill: shade(color, 0.15), ...s.b.line(0.6) });
}

function planks(s: Scene, top: number, color: string): void {
  const c = s.L(color);
  s.b.e('rect', { y: top, width: W, height: H - top, fill: s.b.lin([[0, shade(c, -0.12)], [1, c]]) });
  const lines: string[] = [];
  for (let y = top + 24, k = 0; y < H; y += 20 + k * 6, k++) lines.push(d('M', 0, y, 'H', W));
  for (let i = 0; i < 24; i++) {
    const y = top + s.rng.float(0, H - top);
    lines.push(d('M', s.rng.float(0, W), y, 'v', 18));
  }
  s.b.e('path', { d: lines.join(''), stroke: shade(c, -0.25), 'stroke-width': 3, opacity: 0.6 });
}

function pendant(s: Scene, x: number, len: number, color: string): void {
  s.b.e('path', { d: d('M', x, 0, 'V', len), stroke: s.L('#2a2a30'), 'stroke-width': 3 });
  s.b.e('path', { d: d('M', x - 38, len + 40, 'Q', x, len - 16, x + 38, len + 40, 'Z'), fill: s.L(color), ...s.b.line(0.8) });
  s.b.e('ellipse', { cx: x, cy: len + 42, rx: 14, ry: 7, fill: s.time === 'day' ? '#fff4d0' : '#ffe08a' });
  halo(s, x, len + 60, s.time === 'day' ? 110 : 190, '#ffd88a', s.time === 'day' ? 0.25 : 0.5);
}

function cup(s: Scene, x: number, y: number, color: string): void {
  s.b.e('path', { d: d('M', x - 14, y - 20, 'H', x + 14, 'L', x + 11, y, 'H', x - 11, 'Z'), fill: s.L(color), ...s.b.line(0.5) });
  s.b.e('path', { d: d('M', x + 13, y - 16, 'q', 10, 2, 0, 10), fill: 'none', stroke: s.L(color), 'stroke-width': 4 });
}

export function cafe(s: Scene): void {
  const wall = s.L('#d9a878');
  s.b.e('rect', { width: W, height: 540, fill: s.b.lin([[0, shade(wall, -0.1)], [1, wall]]) });
  s.b.e('path', { d: Array.from({ length: 33 }, (_, i) => d('M', i * 40, 0, 'V', 400)).join(''), stroke: shade(wall, 0.08), 'stroke-width': 12, opacity: 0.5 });
  const wood = s.L('#7a4a2e');
  s.b.e('rect', { y: 400, width: W, height: 140, fill: wood });
  s.b.e('path', { d: Array.from({ length: 16 }, (_, i) => d('M', 20 + i * 80, 420, 'h', 60, 'v', 100, 'h', -60, 'Z')).join(''), fill: 'none', stroke: shade(wood, -0.25), 'stroke-width': 4 });
  s.b.e('rect', { y: 396, width: W, height: 10, fill: shade(wood, 0.2) });
  windowView(s, 90, 90, 440, 290, true);
  frame(s, 90, 90, 440, 290, s.L('#5a3a26'));
  planks(s, 540, '#9a6a44');
  // Étagères et bocaux
  const shelf = s.L('#6a3e26');
  for (const y of [170, 290]) {
    s.b.e('rect', { x: 700, y, width: 460, height: 14, rx: 3, fill: shelf, ...s.b.line(0.6) });
    for (let i = 0; i < 7; i++) {
      const x = 730 + i * 62;
      if ((i + y) % 3 === 0) {
        s.b.e('rect', { x: x - 18, y: y - 58, width: 36, height: 58, rx: 8, fill: s.L('#cfe4ea'), opacity: 0.9, ...s.b.line(0.5) });
        s.b.e('rect', { x: x - 16, y: y - 30, width: 32, height: 28, rx: 6, fill: s.L(['#7a4a2a', '#e0b040', '#c04a3a'][i % 3] as string) });
      } else if (i % 2 === 0) cup(s, x, y, ['#f4f0e8', '#e87a6a', '#6ab0d0'][i % 3] as string);
      else {
        s.b.e('rect', { x: x - 14, y: y - 30, width: 28, height: 30, rx: 4, fill: s.L('#b86a3a') });
        s.b.e('circle', { cx: x, cy: y - 44, r: 20, fill: s.L('#4f9a4a') });
      }
    }
  }
  pendant(s, 330, 90, '#2f6a5a');
  pendant(s, 760, 60, s.accent ?? '#c8503a');
  pendant(s, 1080, 80, '#2f6a5a');
  // Comptoir
  const counter = s.L('#8a5634');
  s.b.e('rect', { x: 640, y: 420, width: 660, height: 200, fill: counter, ...s.b.line(1) });
  s.b.e('path', { d: Array.from({ length: 6 }, (_, i) => d('M', 670 + i * 104, 450, 'h', 80, 'v', 140, 'h', -80, 'Z')).join(''), fill: shade(counter, -0.12), stroke: shade(counter, -0.3), 'stroke-width': 3 });
  s.b.e('rect', { x: 620, y: 404, width: 680, height: 24, rx: 6, fill: s.L('#e8dccb'), ...s.b.line(0.8) });
  const steel = s.L('#b8c0cc');
  s.b.e('rect', { x: 820, y: 320, width: 140, height: 86, rx: 10, fill: steel, ...s.b.line(0.8) });
  s.b.e('rect', { x: 836, y: 336, width: 108, height: 22, rx: 4, fill: shade(steel, -0.3) });
  s.b.e('circle', { cx: 862, cy: 386, r: 8, fill: s.L('#2a2a30') });
  s.b.e('circle', { cx: 918, cy: 386, r: 8, fill: s.L('#2a2a30') });
  s.b.e('path', { d: 'M1060 404V350Q1110 300 1160 350V404Z', fill: s.L('#e0f0f4'), opacity: 0.7, ...s.b.line(0.6) });
  s.b.e('path', { d: 'M1080 404L1090 372H1130L1140 404Z', fill: s.L('#f0a0b0') });
  s.b.e('rect', { x: 1080, y: 368, width: 60, height: 6, fill: s.L('#fff4f0') });
  // Table ronde au premier plan
  const table = s.L('#5a3622');
  s.b.e('path', { d: 'M290 610V700M250 700H330', stroke: table, 'stroke-width': 12, 'stroke-linecap': 'round' });
  s.b.e('ellipse', { cx: 290, cy: 600, rx: 150, ry: 34, fill: s.L('#f0e4d0'), ...s.b.line(1) });
  cup(s, 250, 596, '#ffffff');
  s.b.e('ellipse', { cx: 330, cy: 596, rx: 30, ry: 8, fill: s.L('#ffffff'), ...s.b.line(0.5) });
  s.b.e('path', { d: 'M316 592L340 580L346 594Z', fill: s.L('#e0a05a') });
  for (const x of [110, 470]) {
    s.b.e('rect', { x: x - 40, y: 540, width: 80, height: 90, rx: 10, fill: s.L('#3f6a5a'), ...s.b.line(0.8) });
    s.b.e('path', { d: d('M', x - 34, 630, 'V', 710, 'M', x + 34, 630, 'V', 710), stroke: table, 'stroke-width': 8 });
    s.b.e('rect', { x: x - 46, y: 620, width: 92, height: 18, rx: 6, fill: s.L('#4f8a74'), ...s.b.line(0.6) });
  }
  s.b.e('rect', { x: 560, y: 560, width: 60, height: 60, rx: 6, fill: s.L('#b86a3a'), ...s.b.line(0.6) });
  for (const [dx, dy, r] of [
    [0, -30, 40],
    [-26, -10, 28],
    [26, -12, 28],
  ] as const) s.b.e('circle', { cx: 590 + dx, cy: 540 + dy, r, fill: s.L('#4f9a4a'), ...s.b.line(0.6) });
  ambience(s);
}

export function bedroom(s: Scene): void {
  const wall = s.L(s.accent ? mix(s.accent, '#ffffff', 0.7) : '#e4d6ec');
  s.b.e('rect', { width: W, height: 560, fill: s.b.lin([[0, shade(wall, -0.06)], [1, wall]]) });
  const dots: string[] = [];
  for (let y = 30; y < 540; y += 60) for (let x = (y / 60) % 2 ? 30 : 0; x < W; x += 60) dots.push(d('M', x, y, 'h', 0.1));
  s.b.e('path', { d: dots.join(''), stroke: shade(wall, -0.08), 'stroke-width': 10, 'stroke-linecap': 'round' });
  planks(s, 560, '#c89a6a');
  s.b.e('rect', { y: 548, width: W, height: 16, fill: s.L('#f4f0ec'), ...s.b.line(0.5) });
  windowView(s, 150, 90, 320, 280, false);
  frame(s, 150, 90, 320, 280, s.L('#f4f0ec'));
  const curtain = s.L(s.accent ?? '#7a9ad8');
  s.b.e('path', { d: 'M120 70C150 200 110 300 130 400L200 400C170 300 190 180 180 70Z', fill: curtain, ...s.b.line(0.8) });
  s.b.e('path', { d: 'M500 70C470 200 510 300 490 400L420 400C450 300 430 180 440 70Z', fill: shade(curtain, -0.1), ...s.b.line(0.8) });
  s.b.e('rect', { x: 100, y: 60, width: 420, height: 12, rx: 6, fill: s.L('#8a6a4a') });
  s.b.e('rect', { x: 290, y: 342, width: 40, height: 34, rx: 5, fill: s.L('#c86a4a') });
  s.b.e('circle', { cx: 310, cy: 330, r: 22, fill: s.L('#5aa05a') });
  if (s.time === 'night') {
    s.b.e('path', { d: 'M160 560L460 560L560 720L60 720Z', fill: '#c8d8ff', opacity: 0.12 });
  }
  // Cadres au mur
  for (const [x, y, w, h, c] of [
    [620, 130, 120, 150, '#f0b860'],
    [780, 170, 100, 80, '#6ab0d0'],
  ] as const) {
    s.b.e('rect', { x, y, width: w, height: h, fill: s.L(c), stroke: s.L('#5a3e2e'), 'stroke-width': 8 });
    s.b.e('path', { d: d('M', x + 10, y + h - 10, 'L', x + w * 0.4, y + h * 0.45, 'L', x + w * 0.6, y + h * 0.7, 'L', x + w * 0.75, y + h * 0.5, 'L', x + w - 10, y + h - 10, 'Z'), fill: s.L('#ffffff'), opacity: 0.6 });
  }
  // Lit
  const bedWood = s.L('#8a5a3a');
  s.b.e('rect', { x: 760, y: 300, width: 40, height: 330, rx: 8, fill: bedWood, ...s.b.line(1) });
  s.b.e('rect', { x: 790, y: 470, width: 460, height: 110, rx: 14, fill: s.L('#f4f0f4'), ...s.b.line(1) });
  s.b.e('path', { d: 'M880 440C1000 430 1150 430 1260 450L1260 600L870 600Z', fill: s.L(s.accent ?? '#e0708a'), ...s.b.line(1) });
  s.b.e('path', { d: 'M880 470C1000 460 1150 462 1260 478', fill: 'none', stroke: s.L('#ffffff'), 'stroke-width': 8, opacity: 0.5 });
  s.b.e('ellipse', { cx: 850, cy: 450, rx: 70, ry: 34, fill: s.L('#ffffff'), ...s.b.line(0.8) });
  s.b.e('rect', { x: 780, y: 580, width: 480, height: 40, fill: bedWood, ...s.b.line(0.8) });
  // Bureau et lampe
  const desk = s.L('#a8764a');
  s.b.e('rect', { x: 40, y: 450, width: 420, height: 22, rx: 4, fill: desk, ...s.b.line(0.8) });
  s.b.e('rect', { x: 60, y: 472, width: 20, height: 170, fill: shade(desk, -0.2) });
  s.b.e('rect', { x: 420, y: 472, width: 20, height: 170, fill: shade(desk, -0.2) });
  s.b.e('rect', { x: 300, y: 472, width: 120, height: 100, fill: shade(desk, -0.1), ...s.b.line(0.6) });
  s.b.e('path', { d: 'M100 450L104 380L90 330', fill: 'none', stroke: s.L('#3a3a48'), 'stroke-width': 6 });
  s.b.e('path', { d: 'M60 340L120 318L130 350Z', fill: s.L('#e8c040'), ...s.b.line(0.6) });
  if (s.time !== 'day') halo(s, 110, 380, 170, '#ffd27a', s.time === 'night' ? 0.55 : 0.3);
  for (let i = 0; i < 4; i++) s.b.e('rect', { x: 180 + i * 18, y: 400 - (i % 2) * 8, width: 16, height: 50 + (i % 2) * 8, fill: s.L(['#c84a4a', '#4a7ac8', '#e0b040', '#5aa05a'][i] as string), ...s.b.line(0.4) });
  s.b.e('ellipse', { cx: 560, cy: 660, rx: 220, ry: 40, fill: s.L(s.accent ? shade(s.accent, 0.3) : '#b8a0d8'), opacity: 0.85 });
  ambience(s);
}

export function classroom(s: Scene): void {
  const wall = s.L('#ece2c8');
  s.b.e('rect', { width: W, height: 520, fill: s.b.lin([[0, shade(wall, -0.08)], [1, wall]]) });
  s.b.e('rect', { width: W, height: 26, fill: s.L('#f8f8f4') });
  for (const x of [200, 640, 1080]) s.b.e('rect', { x: x - 90, y: 4, width: 180, height: 14, rx: 4, fill: s.time === 'night' ? '#8a8a70' : '#ffffff' });
  planks(s, 520, '#b88a5a');
  s.b.e('rect', { y: 506, width: W, height: 16, fill: s.L('#8a6a4a') });
  // Tableau
  const board = s.L('#2f5a44');
  s.b.e('rect', { x: 330, y: 110, width: 600, height: 260, fill: board, stroke: s.L('#8a6040'), 'stroke-width': 14 });
  s.b.e('path', { d: 'M380 180Q420 150 460 180T540 180M700 160L760 260L640 260Z', fill: 'none', stroke: s.L('#e8f0e8'), 'stroke-width': 4, opacity: 0.7 });
  s.b.e('circle', { cx: 830, cy: 230, r: 50, fill: 'none', stroke: s.L('#e8f0e8'), 'stroke-width': 4, opacity: 0.7 });
  s.b.e('path', { d: 'M400 300Q520 280 600 310', fill: 'none', stroke: s.L('#e8f0e8'), 'stroke-width': 16, opacity: 0.12 });
  s.b.e('rect', { x: 330, y: 370, width: 600, height: 14, fill: s.L('#8a6040') });
  s.b.e('rect', { x: 420, y: 364, width: 30, height: 8, fill: s.L('#ffffff') });
  // Horloge
  s.b.e('circle', { cx: 630, cy: 64, r: 30, fill: s.L('#ffffff'), stroke: s.L('#3a3a48'), 'stroke-width': 6 });
  s.b.e('path', { d: 'M630 64V46M630 64L644 70', stroke: s.L('#3a3a48'), 'stroke-width': 4, 'stroke-linecap': 'round' });
  // Fenêtres
  for (const x of [1010, 1150]) {
    windowView(s, x, 90, 110, 300, false);
    frame(s, x, 90, 110, 300, s.L('#f4f4f0'));
  }
  // Panneau d'affichage
  s.b.e('rect', { x: 60, y: 130, width: 200, height: 220, fill: s.L('#c89a6a'), stroke: s.L('#8a6040'), 'stroke-width': 10 });
  for (const [x, y, c, r] of [
    [80, 150, '#ffffff', -4],
    [160, 160, '#f8e08a', 5],
    [90, 250, '#a8d8f0', 3],
    [170, 250, '#f8b8c8', -6],
  ] as const) {
    s.b.e('rect', { x, y, width: 64, height: 76, fill: s.L(c), transform: `rotate(${r} ${x + 32} ${y + 38})` });
    s.b.e('circle', { cx: x + 32, cy: y + 6, r: 5, fill: s.L('#d84a4a') });
  }
  // Bureau du professeur
  const wood = s.L('#9a6a44');
  s.b.e('rect', { x: 480, y: 420, width: 320, height: 110, fill: wood, ...s.b.line(1) });
  s.b.e('rect', { x: 470, y: 410, width: 340, height: 18, rx: 4, fill: shade(wood, 0.15), ...s.b.line(0.8) });
  // Pupitres des élèves
  const deskTop = s.L('#d8b48a');
  const metal = s.L('#6a7080');
  const drawDesk = (x: number, y: number, k: number) => {
    s.b.e('path', { d: d('M', x - 70 * k, y + 20 * k, 'V', y + 110 * k, 'M', x + 70 * k, y + 20 * k, 'V', y + 110 * k), stroke: metal, 'stroke-width': 8 * k });
    s.b.e('rect', { x: x - 90 * k, y, width: 180 * k, height: 24 * k, rx: 4, fill: deskTop, ...s.b.line(k) });
    s.b.e('rect', { x: x - 80 * k, y: y + 24 * k, width: 160 * k, height: 30 * k, fill: shade(deskTop, -0.25) });
  };
  for (const x of [220, 520, 820, 1100]) drawDesk(x, 590, 0.9);
  for (const x of [120, 560, 1000]) drawDesk(x, 660, 1.3);
  ambience(s);
  if (s.time === 'night') s.b.e('rect', { width: W, height: H, fill: '#0a1030', opacity: 0.2 });
}


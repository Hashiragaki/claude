import { mix, shade } from '../../shared/color';
import { ridgePath, smoothOpenPath, type Point } from '../../shared/geometry';
import { d, el } from '../../shared/svg';
import { H, W, ambience, clouds, halo, sky, stars, tree, windowFill, type Scene } from './common';

/** Collines superposées : du plus lointain (brumeux) au plus proche. */
function hills(
  s: Scene,
  layers: { y: number; color: string; amp: number; seg: number; sharp?: boolean }[],
): void {
  const haze = s.time === 'night'
    ? '#2a3868'
    : s.time === 'sunset'
      ? '#e8a0a0'
      : '#c8e4f4';
  layers.forEach((layer, i) => {
    const k = (layers.length - 1 - i) / Math.max(1, layers.length);
    const base = mix(s.L(layer.color), haze, k * 0.55);
    const fill = s.b.lin([
      [0, shade(base, 0.08)],
      [1, shade(base, -0.12)],
    ]);
    s.b.e('path', {
      d: ridgePath(W, layer.y, H, s.rng, {
        amplitude: layer.amp,
        segments: layer.seg,
        sharp: layer.sharp,
      }),
      fill,
    });
  });
}

function grassField(s: Scene, top: number, color = '#6cbf5a'): void {
  const g = s.L(color);
  s.b.e('rect', {
    y: top,
    width: W,
    height: H - top,
    fill: s.b.lin([
      [0, shade(g, 0.05)],
      [1, shade(g, -0.2)],
    ]),
  });
  const tufts: string[] = [];
  for (let i = 0; i < 70; i++) {
    const x = s.rng.float(0, W);
    const y = s.rng.float(top + 20, H);
    const h = 6 + ((y - top) / (H - top)) * 12;
    tufts.push(d('M', x - h * 0.4, y, 'L', x, y - h, 'L', x + h * 0.4, y));
  }
  s.b.e('path', {
    d: tufts.join(''),
    fill: 'none',
    stroke: shade(g, -0.25),
    'stroke-width': 2.5,
    'stroke-linejoin': 'round',
  });
}

function fireflies(s: Scene, count: number, y0: number, y1: number): void {
  for (let i = 0; i < count; i++) {
    const x = s.rng.float(40, W - 40);
    const y = s.rng.float(y0, y1);
    halo(s, x, y, 16, '#e8ff9a', 0.6);
    s.b.e('circle', { cx: x, cy: y, r: 2.5, fill: '#f8ffc0' });
  }
}

function lampPost(s: Scene, x: number, ground: number, h = 260): void {
  const metal = s.L('#3a4050');
  s.b.e('rect', { x: x - 6, y: ground - h, width: 12, height: h, fill: metal, ...s.b.line(0.8) });
  s.b.e('rect', { x: x - 14, y: ground - 14, width: 28, height: 14, rx: 3, fill: metal });
  s.b.e('path', {
    d: d(
      'M', x - 22, ground - h, 'L', x + 22, ground - h, 'L', x + 14, ground - h - 40,
      'L', x - 14, ground - h - 40, 'Z',
    ),
    fill: s.time === 'day' ? '#e8eef4' : '#ffe08a',
    stroke: metal,
    'stroke-width': 5,
  });
  s.b.e('path', {
    d: d('M', x - 18, ground - h - 40, 'L', x + 18, ground - h - 40, 'L', x, ground - h - 58, 'Z'),
    fill: metal,
  });
  if (s.time !== 'day') halo(s, x, ground - h - 20, 120, '#ffd27a', s.time === 'night' ? 0.55 : 0.3);
}

function bench(s: Scene, x: number, ground: number): void {
  const wood = s.L('#b07a48');
  const metal = s.L('#3a4050');
  for (const dx of [16, 164])
    s.b.e('rect', { x: x + dx, y: ground - 50, width: 8, height: 50, fill: metal });
  for (const y of [-78, -64])
    s.b.e('rect', {
      x,
      y: ground + y,
      width: 190,
      height: 10,
      rx: 3,
      fill: wood,
      ...s.b.line(0.6),
    });
  s.b.e('rect', {
    x: x - 6,
    y: ground - 50,
    width: 202,
    height: 12,
    rx: 3,
    fill: shade(wood, 0.1),
    ...s.b.line(0.6),
  });
}

function bushes(s: Scene, y: number, count: number, color = '#3f8f46'): void {
  for (let i = 0; i < count; i++) {
    const x = s.rng.float(0, W);
    const r = s.rng.float(30, 55);
    const c = s.L(color);
    s.b.e('circle', { cx: x - r * 0.6, cy: y, r: r * 0.75, fill: shade(c, -0.15) });
    s.b.e('circle', { cx: x + r * 0.6, cy: y, r: r * 0.7, fill: shade(c, -0.1) });
    s.b.e('circle', { cx: x, cy: y - r * 0.35, r, fill: c });
    s.b.e('circle', { cx: x - r * 0.3, cy: y - r * 0.6, r: r * 0.4, fill: shade(c, 0.2), opacity: 0.7 });
  }
}

export function park(s: Scene): void {
  sky(s, 460);
  if (s.time !== 'night') clouds(s, 4, 240);
  hills(s, [{ y: 400, color: '#6aaa7a', amp: 40, seg: 6 }]);
  // Rangée d'arbres lointains
  const far = mix(s.L('#4f9a5a'), s.time === 'night' ? '#26345c' : '#b8dcc8', 0.35);
  for (let x = -20; x < W + 40; x += 46)
    s.b.e('circle', {
      cx: x,
      cy: 430 + s.rng.float(-12, 12),
      r: s.rng.float(34, 48),
      fill: far,
    });
  grassField(s, 450);
  const path = s.L('#e2cc9a');
  s.b.e('path', {
    d: 'M560 450C600 450 640 450 660 452C700 520 820 600 900 720L360 720C470 620 560 520 560 450Z',
    fill: s.b.lin([[0, shade(path, -0.1)], [1, path]]),
  });
  s.b.e('path', {
    d: 'M560 450C560 520 470 620 360 720M660 452C700 520 820 600 900 720',
    fill: 'none',
    stroke: shade(path, -0.25),
    'stroke-width': 4,
  });
  bushes(s, 470, 5);
  tree(s, 110, 640, 520);
  tree(s, 1180, 620, 470, '#56a44e');
  lampPost(s, 330, 600);
  bench(s, 900, 560);
  const flowers: string[] = [];
  for (let i = 0; i < 40; i++) {
    const x = s.rng.float(0, W);
    const y = s.rng.float(560, 710);
    if (x > 360 && x < 900) continue;
    flowers.push(
      el('circle', {
        cx: x,
        cy: y,
        r: 4,
        fill: s.L(['#ff7aa0', '#fff4a0', '#ffffff', '#b890ff'][i % 4] as string),
      }),
    );
  }
  s.b.add(flowers.join(''));
  if (s.time === 'night') fireflies(s, 14, 420, 700);
  ambience(s);
}

export function forest(s: Scene): void {
  sky(s, 420, 640);
  const layers = [
    { y: 440, color: '#5a9a7a', n: 26, h: 220 },
    { y: 520, color: '#3f7f5a', n: 18, h: 300 },
    { y: 620, color: '#2a5f44', n: 12, h: 420 },
  ];
  const haze = s.time === 'night' ? '#1c2a50' : s.time === 'sunset' ? '#e0a090' : '#bfe0d8';
  layers.forEach((layer, i) => {
    const c = mix(s.L(layer.color), haze, (2 - i) * 0.22);
    const trees: string[] = [];
    const trunks: string[] = [];
    for (let k = 0; k < layer.n; k++) {
      const x = (k / layer.n) * W + s.rng.float(-20, 20);
      const h = layer.h * s.rng.float(0.75, 1.1);
      const w = h * 0.32;
      trees.push(
        d(
          'M', x, layer.y - h,
          'L', x + w * 0.5, layer.y - h * 0.55,
          'L', x + w * 0.3, layer.y - h * 0.55,
          'L', x + w * 0.7, layer.y - h * 0.15,
          'L', x - w * 0.7, layer.y - h * 0.15,
          'L', x - w * 0.3, layer.y - h * 0.55,
          'L', x - w * 0.5, layer.y - h * 0.55,
          'Z',
        ),
      );
      trunks.push(
        d('M', x - w * 0.07, layer.y - h * 0.16, 'h', w * 0.14, 'V', layer.y, 'h', -w * 0.14, 'Z'),
      );
    }
    s.b.e('path', { d: trunks.join(''), fill: shade(c, -0.35) });
    s.b.e('path', { d: trees.join(''), fill: c });
    s.b.e('rect', { y: layer.y, width: W, height: H - layer.y, fill: shade(c, -0.1) });
  });
  if (s.time === 'day' || s.time === 'sunset') {
    const ray = s.time === 'day' ? '#fff8c8' : '#ffc890';
    for (let i = 0; i < 4; i++) {
      const x = 380 + i * 150;
      s.b.e('path', {
        d: d('M', x, 0, 'L', x + 60, 0, 'L', x + 260, H, 'L', x + 120, H, 'Z'),
        fill: ray,
        opacity: 0.12,
      });
    }
  }
  const ground = s.L('#2f5a36');
  s.b.e('path', { d: 'M0 640C300 610 900 610 1280 640L1280 720L0 720Z', fill: shade(ground, -0.1) });
  s.b.e('path', { d: 'M520 720C560 680 600 650 640 628C680 650 720 680 780 720Z', fill: s.L('#8a6a48') });
  const ferns: string[] = [];
  for (let i = 0; i < 18; i++) {
    const x = s.rng.float(0, W);
    const y = s.rng.float(660, 720);
    for (const a of [-50, -25, 0, 25, 50]) {
      const rad = ((a - 90) * Math.PI) / 180;
      ferns.push(
        d(
          'M', x, y,
          'Q', x + Math.cos(rad) * 20, y + Math.sin(rad) * 34,
          x + Math.cos(rad) * 44, y + Math.sin(rad) * 40,
        ),
      );
    }
  }
  s.b.e('path', {
    d: ferns.join(''),
    fill: 'none',
    stroke: s.L('#4f9a4a'),
    'stroke-width': 5,
    'stroke-linecap': 'round',
  });
  for (const [x, y] of [
    [300, 690],
    [980, 700],
    [1040, 694],
  ] as const) {
    s.b.e('rect', {
      x: x - 5,
      y: y - 16,
      width: 10,
      height: 16,
      fill: s.L('#f0e4d0'),
    });
    s.b.e('path', {
      d: d('M', x - 18, y - 14, 'Q', x, y - 40, x + 18, y - 14, 'Z'),
      fill: s.L('#d8403a'),
      ...s.b.line(0.6),
    });
  }
  if (s.time === 'night') fireflies(s, 20, 380, 700);
  ambience(s);
}

export function beach(s: Scene): void {
  const horizon = 380;
  sky(s, horizon + 2, 900);
  if (s.time !== 'night') clouds(s, 3, 200);
  const sea = s.L('#2f8fd0');
  s.b.e('rect', {
    y: horizon,
    width: W,
    height: H - horizon,
    fill: s.b.lin([[0, shade(sea, -0.15)], [1, mix(sea, '#6ad8e0', 0.5)]]),
  });
  const glint = s.time === 'sunset' ? '#ffd08a' : s.time === 'night' ? '#dfe8ff' : '#ffffff';
  const lines: string[] = [];
  for (let i = 0; i < 40; i++) {
    const y = horizon + 8 + i * 4 + s.rng.float(0, 4);
    const spread = 20 + i * 6;
    const x = 900 + s.rng.float(-spread, spread);
    lines.push(d('M', x - 14 - i, y, 'h', 28 + i * 2));
  }
  s.b.e('path', { d: lines.join(''), stroke: glint, 'stroke-width': 2.5, opacity: 0.55, 'stroke-linecap': 'round' });
  const sand = s.L('#f0d49a');
  s.b.e('path', {
    d: 'M0 520C300 500 700 540 1280 500L1280 720L0 720Z',
    fill: s.b.lin([[0, shade(sand, 0.08)], [1, shade(sand, -0.12)]]),
  });
  s.b.e('path', {
    d: 'M0 516C300 496 700 536 1280 496',
    fill: 'none',
    stroke: s.L('#ffffff'),
    'stroke-width': 10,
    opacity: 0.8,
    'stroke-linecap': 'round',
  });
  s.b.e('path', {
    d: 'M0 540C320 520 720 560 1280 520',
    fill: 'none',
    stroke: shade(sand, -0.12),
    'stroke-width': 6,
    opacity: 0.6,
  });
  // Palmier
  const trunk = s.L('#9a6a3e');
  s.b.e('path', {
    d: 'M1110 700C1100 600 1080 470 1030 330L1046 326C1100 460 1126 600 1140 700Z',
    fill: trunk,
    ...s.b.line(1),
  });
  const leaf = s.L('#3f9a4a');
  for (const [dx, dy, flip] of [
    [-150, 40, 1],
    [140, 50, -1],
    [-110, -60, 1],
    [120, -50, -1],
    [10, -110, 1],
  ] as const) {
    s.b.e('path', {
      d: d(
        'M', 1038, 330,
        'Q', 1038 + dx * 0.5, 330 + dy - 60 * flip * 0.2, 1038 + dx, 330 + dy + 40,
        'Q', 1038 + dx * 0.45, 330 + dy * 0.4, 1038, 336,
        'Z',
      ),
      fill: leaf,
      ...s.b.line(0.8),
    });
  }
  for (const [x, y] of [
    [1030, 344],
    [1050, 348],
  ] as const) s.b.e('circle', { cx: x, cy: y, r: 12, fill: s.L('#6a4a2a') });
  // Parasol et serviette
  const stripe = s.accent ?? '#e84a5a';
  s.b.e('path', { d: 'M300 470L306 660', stroke: s.L('#e8e0d0'), 'stroke-width': 6 });
  s.b.e('path', { d: 'M180 480Q300 380 430 470Q300 440 180 480Z', fill: s.L(stripe), ...s.b.line(1) });
  s.b.e('path', { d: 'M260 450Q300 400 340 448Q300 438 260 450Z', fill: s.L('#ffffff') });
  s.b.e('path', { d: 'M230 640L420 620L440 680L250 700Z', fill: s.L('#4ab0d0'), ...s.b.line(0.6) });
  s.b.e('path', { d: 'M236 656L424 636M242 672L430 652', stroke: s.L('#ffffff'), 'stroke-width': 6 });
  for (const [x, y] of [
    [620, 640],
    [760, 690],
  ] as const) {
    s.b.e('path', {
      d: d(
        'M', x, y - 12,
        'L', x + 4, y - 3,
        'L', x + 13, y - 3,
        'L', x + 6, y + 3,
        'L', x + 9, y + 12,
        'L', x, y + 7,
        'L', x - 9, y + 12,
        'L', x - 6, y + 3,
        'L', x - 13, y - 3,
        'L', x - 4, y - 3,
        'Z',
      ),
      fill: s.L('#f08a5a'),
    });
  }
  ambience(s);
}

export function castle(s: Scene): void {
  sky(s, 520, 300);
  if (s.time !== 'night') clouds(s, 4, 220);
  hills(s, [
    { y: 380, color: '#7a8ab0', amp: 120, seg: 7, sharp: true },
    { y: 470, color: '#5a9a6a', amp: 50, seg: 5 },
  ]);
  const stone = s.L('#b8b0c4');
  const dark = shade(stone, -0.25);
  const roof = s.L(s.accent ?? '#4a5aa8');
  const lit = s.time !== 'day';
  const tower = (x: number, y: number, w: number, h: number) => {
    s.b.e('rect', {
      x: x - w / 2,
      y,
      width: w,
      height: h,
      fill: stone,
      ...s.b.line(1),
    });
    s.b.e('rect', {
      x: x + w * 0.15,
      y,
      width: w * 0.35,
      height: h,
      fill: dark,
      opacity: 0.35,
    });
    s.b.e('path', {
      d: d('M', x - w / 2 - 10, y, 'L', x, y - w * 1.3, 'L', x + w / 2 + 10, y, 'Z'),
      fill: roof,
      ...s.b.line(1),
    });
    s.b.e('path', {
      d: d('M', x, y - w * 1.3, 'V', y - w * 1.3 - 40),
      stroke: s.L('#5a4a3a'),
      'stroke-width': 3,
    });
    s.b.e('path', {
      d: d('M', x, y - w * 1.3 - 40, 'l', 30, 8, 'l', -30, 8, 'Z'),
      fill: s.L('#e84a4a'),
    });
    for (let k = 0; k < 2; k++) {
      const wy = y + 30 + k * 50;
      if (wy + 30 > y + h) break;
      s.b.e('path', {
        d: d(
          'M', x - 7, wy + 26,
          'V', wy + 8,
          'Q', x, wy - 2, x + 7, wy + 8,
          'V', wy + 26,
          'Z',
        ),
        fill: windowFill(s, lit && k === 0),
      });
    }
  };
  const base = 470;
  s.b.e('rect', { x: 520, y: base - 150, width: 340, height: 150, fill: stone, ...s.b.line(1) });
  const merlons: string[] = [];
  for (let x = 520; x < 860; x += 34) merlons.push(d('M', x, base - 150, 'h', 20, 'v', -18, 'h', -20, 'Z'));
  s.b.e('path', { d: merlons.join(''), fill: stone, ...s.b.line(1) });
  s.b.e('path', { d: 'M660 470V400Q690 370 720 400V470Z', fill: s.L('#4a3426'), ...s.b.line(1) });
  tower(520, 250, 70, 220);
  tower(860, 240, 76, 230);
  tower(690, 170, 90, 150);
  if (s.time === 'night') {
    for (const [x, y] of [
      [520, 290],
      [860, 280],
      [690, 210],
    ] as const) halo(s, x, y, 60);
  }
  grassField(s, 560, '#5aae5a');
  s.b.e('path', {
    d: 'M690 470C700 520 600 560 640 620C680 680 560 700 520 720L700 720C720 680 800 650 760 600C720 560 740 520 720 470Z',
    fill: s.L('#d8c49a'),
  });
  tree(s, 140, 660, 440);
  tree(s, 1150, 690, 400, '#4f9a4a');
  ambience(s);
}

export function generic(s: Scene): void {
  sky(s, 470, 880);
  if (s.time !== 'night') clouds(s, 5, 260);
  hills(s, [
    { y: 360, color: '#8a90c0', amp: 140, seg: 8, sharp: true },
    { y: 440, color: '#6aa46a', amp: 70, seg: 6 },
    { y: 520, color: '#5aa452', amp: 60, seg: 5 },
  ]);
  grassField(s, 590, '#62b456');
  const path = s.L('#e2cc9a');
  s.b.e('path', { d: 'M600 520C620 580 540 640 520 720L660 720C660 640 700 580 640 520Z', fill: path });
  tree(s, 980, 620, 380);
  bushes(s, 640, 3, '#4a9a4a');
  if (s.time === 'night') fireflies(s, 10, 480, 700);
  ambience(s);
}

export function street(s: Scene): void {
  sky(s, 420, 200);
  if (s.time === 'day') clouds(s, 3, 160);
  // Silhouette lointaine de la ville
  const far = mix(s.L('#8a94b8'), s.time === 'night' ? '#1a2448' : '#d0e0f0', 0.4);
  let x = 0;
  const skyline: Point[] = [[0, 420]];
  while (x < W) {
    const w = s.rng.float(50, 110);
    const h = s.rng.float(120, 240);
    skyline.push([x, 420 - h], [x + w, 420 - h]);
    x += w;
  }
  skyline.push([W, 420]);
  s.b.e('path', { d: `M${skyline.map(([px, py]) => `${Math.round(px)} ${Math.round(py)}`).join('L')}Z`, fill: far });
  // Façades
  const colors = ['#e8c8a0', '#c86a5a', '#a8b8d0', '#e0a86a', '#9ac0a0', '#d8d0c0'];
  const awning = s.accent ?? '#d8404a';
  x = -30;
  let i = 0;
  while (x < W) {
    const w = s.rng.float(200, 280);
    const h = s.rng.float(300, 420);
    const top = 560 - h;
    const c = s.L(colors[i % colors.length] as string);
    s.b.e('rect', { x, y: top, width: w, height: h, fill: c, ...s.b.line(1) });
    s.b.e('rect', { x, y: top, width: w, height: 14, fill: shade(c, -0.2) });
    const rows = Math.floor((h - 170) / 70);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 3; k++) {
        const wx = x + 24 + k * ((w - 48) / 3);
        const wy = top + 40 + r * 70;
        const lit = s.rng.bool(0.45);
        s.b.e('rect', {
          x: wx,
          y: wy,
          width: (w - 48) / 3 - 18,
          height: 44,
          fill: windowFill(s, lit),
          stroke: shade(c, -0.35),
          'stroke-width': 4,
        });
        if (lit && s.time === 'night') halo(s, wx + 20, wy + 22, 50, '#ffd27a', 0.25);
      }
    }
    // Rez-de-chaussée : vitrine et auvent
    s.b.e('rect', {
      x: x + 16,
      y: 440,
      width: w - 32,
      height: 120,
      fill: windowFill(s, s.time !== 'day'),
      stroke: shade(c, -0.4),
      'stroke-width': 5,
    });
    const aw = i % 2 === 0 ? s.L(awning) : s.L('#3a7ab0');
    const stripes: string[] = [];
    for (let k = 0; k < w - 24; k += 30) stripes.push(d('M', x + 12 + k, 412, 'h', 15, 'l', 6, 30, 'h', -15, 'Z'));
    s.b.e('path', { d: d('M', x + 8, 412, 'H', x + w - 8, 'l', 8, 30, 'H', x, 'Z'), fill: aw, ...s.b.line(0.8) });
    s.b.e('path', { d: stripes.join(''), fill: s.L('#ffffff'), opacity: 0.85 });
    x += w;
    i++;
  }
  // Trottoir et route
  const walk = s.L('#c8c0b8');
  s.b.e('rect', { y: 560, width: W, height: 70, fill: walk });
  s.b.e('path', {
    d: Array.from({ length: 14 }, (_, k) => d('M', k * 100, 560, 'l', -20, 70)).join(''),
    stroke: shade(walk, -0.15),
    'stroke-width': 3,
  });
  s.b.e('rect', { y: 626, width: W, height: 10, fill: shade(walk, 0.12) });
  s.b.e('rect', { y: 636, width: W, height: 84, fill: s.L('#4a4a58') });
  s.b.e('path', {
    d: Array.from({ length: 8 }, (_, k) => d('M', 40 + k * 170, 680, 'h', 90)).join(''),
    stroke: s.L('#f0f0f0'),
    'stroke-width': 8,
  });
  lampPost(s, 250, 600, 280);
  lampPost(s, 1000, 600, 280);
  for (const px of [620, 1200]) {
    s.b.e('rect', { x: px - 26, y: 540, width: 52, height: 40, rx: 6, fill: s.L('#8a5a3a'), ...s.b.line(0.6) });
    s.b.e('circle', { cx: px, cy: 510, r: 40, fill: s.L('#4f9a4a'), ...s.b.line(0.6) });
    s.b.e('circle', { cx: px - 12, cy: 498, r: 16, fill: s.L('#7ac06a'), opacity: 0.7 });
  }
  ambience(s);
}

export function space(s: Scene): void {
  s.b.e('rect', { width: W, height: H, fill: s.b.lin([[0, '#05061a'], [1, '#141a44']]) });
  const nebula = [
    [300, 260, 380, '#8a3ab0'],
    [900, 420, 420, '#2a6ad0'],
    [640, 120, 300, '#d04a8a'],
  ] as const;
  for (const [x, y, r, c] of nebula) s.b.e('circle', { cx: x, cy: y, r, fill: s.b.glow(c, 0.35) });
  stars(s, H, 220);
  // Planète à anneaux
  const planet = s.accent ?? '#e0904a';
  s.b.e('ellipse', {
    cx: 940,
    cy: 300,
    rx: 250,
    ry: 60,
    fill: 'none',
    stroke: mix(planet, '#ffffff', 0.4),
    'stroke-width': 14,
    opacity: 0.6,
    transform: 'rotate(-14 940 300)',
  });
  s.b.e('circle', {
    cx: 940,
    cy: 300,
    r: 140,
    fill: s.b.rad(
      [[0, shade(planet, 0.35)], [0.7, planet], [1, shade(planet, -0.45)]],
      { cx: 0.35, cy: 0.35, r: 0.75 },
    ),
  });
  s.b.e('path', {
    d: 'M830 250C900 270 980 262 1060 236M810 320C900 340 1000 330 1078 300',
    fill: 'none',
    stroke: shade(planet, -0.2),
    'stroke-width': 12,
    opacity: 0.5,
  });
  s.b.e('path', {
    d: 'M690 300A250 60 0 0 0 1190 300',
    fill: 'none',
    stroke: mix(planet, '#ffffff', 0.4),
    'stroke-width': 14,
    opacity: 0.8,
    transform: 'rotate(-14 940 300)',
  });
  s.b.e('circle', {
    cx: 240,
    cy: 520,
    r: 60,
    fill: s.b.rad([[0, '#e8e8f0'], [1, '#6a6a88']], { cx: 0.35, cy: 0.3, r: 0.8 }),
  });
  for (const [x, y, r] of [
    [220, 500, 10],
    [262, 540, 7],
    [230, 548, 5],
  ] as const) s.b.e('circle', { cx: x, cy: y, r, fill: '#8a8aa4', opacity: 0.6 });
  s.b.e('path', {
    d: 'M180 120L420 200',
    stroke: '#ffffff',
    'stroke-width': 3,
    opacity: 0.5,
    'stroke-linecap': 'round',
  });
  s.b.e('circle', { cx: 420, cy: 200, r: 5, fill: '#ffffff' });
  s.b.e('path', {
    d: smoothOpenPath([[0, 690], [400, 640], [800, 680], [1280, 630]]) + 'L1280 720L0 720Z',
    fill: '#2a2a44',
  });
}

import type { Rng } from '@forge/core';
import { mix, outlineOf, shade } from '../shared/color';
import { starPoints } from '../shared/geometry';
import { matchKeyword } from '../shared/keywords';
import { colorFromText } from '../shared/palettes';
import { el, points, radialGradient } from '../shared/svg';
import type { Anim2dParams, Anim2dSpec, AnimKey, AnimPart, Animation } from './schema';

/** Brouillon dessiné dans un repère 96 × 96, mis à l'échelle ensuite. */
interface Draft {
  parts: AnimPart[];
  animations: Animation[];
}

type KeyProps = Omit<AnimKey, 'part' | 'frame'>;

const U = 96;
const C = 48;

function part(id: string, svg: string, pivot: [number, number] = [C, C]): AnimPart {
  return { id, svg, pivot };
}

const REST: Required<KeyProps> = { translate: [0, 0], rotate: 0, scale: [1, 1], opacity: 1 };

/**
 * Clés d'une pièce : liste de [position relative 0–1, propriétés], converties en frames.
 * La première clé reçoit la valeur de repos de toute propriété animée plus loin, pour que
 * l'interpolation parte bien de la pose de repos.
 */
function track(partId: string, frames: number, stops: [number, KeyProps][]): AnimKey[] {
  const used = new Set(stops.flatMap(([, props]) => Object.keys(props) as (keyof KeyProps)[]));
  return stops.map(([t, props], i) => {
    const filled: KeyProps = { ...props };
    if (i === 0) for (const prop of used) if (filled[prop] === undefined) Object.assign(filled, { [prop]: REST[prop] });
    return { part: partId, frame: Math.round(t * frames), ...filled };
  });
}

function star(cx: number, cy: number, r: number, color: string, n = 4): string {
  return el('polygon', { points: points(starPoints(cx, cy, r, r * 0.32, n)), fill: color });
}

function glowDef(id: string, color: string): string {
  return `<defs>${radialGradient(id, [
    [0, color, 0.85],
    [1, color, 0],
  ])}</defs>`;
}

/* ---------- Effets ---------- */

function burst(frames: number, color: string): Draft {
  const light = mix(color, '#ffffff', 0.6);
  const parts = [
    part('glow', glowDef('g', color) + el('circle', { cx: C, cy: C, r: 44, fill: 'url(#g)' })),
    part('ring', el('circle', { cx: C, cy: C, r: 30, fill: 'none', stroke: light, 'stroke-width': 4 })),
    part('star', star(C, C, 28, '#ffffff', 8) + star(C, C, 16, light, 8)),
  ];
  const keys: AnimKey[] = [
    ...track('glow', frames - 1, [
      [0, { scale: [0.4, 0.4], opacity: 0.3 }],
      [0.3, { scale: [1, 1], opacity: 1 }],
      [1, { scale: [1.3, 1.3], opacity: 0 }],
    ]),
    ...track('ring', frames - 1, [
      [0, { scale: [0.2, 0.2], opacity: 1 }],
      [1, { scale: [1.5, 1.5], opacity: 0 }],
    ]),
    ...track('star', frames - 1, [
      [0, { scale: [0, 0], rotate: 0 }],
      [0.3, { scale: [1, 1], rotate: 40 }],
      [1, { scale: [0.2, 0.2], rotate: 120, opacity: 0 }],
    ]),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    parts.push(
      part(
        `p${i}`,
        el('polygon', {
          points: points([
            [C, C - 5],
            [C + 3, C],
            [C, C + 5],
            [C - 3, C],
          ]),
          fill: i % 2 ? '#ffffff' : light,
        }),
      ),
    );
    keys.push(
      ...track(`p${i}`, frames - 1, [
        [0.1, { translate: [0, 0], opacity: 1 }],
        [
          1,
          {
            translate: [Math.cos(a) * 40, Math.sin(a) * 40],
            opacity: 0,
            scale: [0.4, 0.4],
          },
        ],
      ]),
    );
  }
  return { parts, animations: [{ name: 'idle', frames, loop: false, keys }] };
}

const FLAME = 'M48 10C58 28 74 40 72 62C70 78 60 88 48 88C36 88 26 78 24 62C22 44 40 32 48 10Z';

function fire(frames: number, color: string): Draft {
  const outer = shade(color, -0.1);
  const parts = [
    part('glow', glowDef('g', '#ffb040') + el('circle', { cx: C, cy: 60, r: 44, fill: 'url(#g)' })),
    part('outer', el('path', { d: FLAME, fill: outer }), [C, 88]),
    part('mid', el('path', { d: FLAME, fill: '#ffa030', transform: 'translate(12 22) scale(0.75)' }), [C, 88]),
    part('core', el('path', { d: FLAME, fill: '#fff0a0', transform: 'translate(24 44) scale(0.5)' }), [C, 88]),
  ];
  const flicker = (id: string, k: number): AnimKey[] =>
    track(id, frames, [
      [0, { scale: [1, 1], rotate: 0 }],
      [0.25, { scale: [1 + 0.05 * k, 1 - 0.08 * k], rotate: 3 * k }],
      [0.5, { scale: [1 - 0.04 * k, 1 + 0.08 * k], rotate: -2 * k }],
      [0.75, { scale: [1 + 0.04 * k, 1 - 0.05 * k], rotate: 2 * k }],
      [1, { scale: [1, 1], rotate: 0 }],
    ]);
  const keys = [
    ...track('glow', frames, [
      [0, { opacity: 0.8 }],
      [0.5, { opacity: 1, scale: [1.08, 1.08] }],
      [1, { opacity: 0.8, scale: [1, 1] }],
    ]),
    ...flicker('outer', 1),
    ...flicker('mid', -1.3),
    ...flicker('core', 1.6),
  ];
  for (let i = 0; i < 3; i++) {
    parts.push(
      part(
        `ember${i}`,
        el('circle', {
          cx: 40 + i * 8,
          cy: 60,
          r: 2.5,
          fill: '#ffd060',
        }),
      ),
    );
    const start = i / 3;
    keys.push(
      ...track(`ember${i}`, frames, [
        [0, { opacity: 0 }],
        [start, { translate: [0, 0], opacity: 1 }],
        [Math.min(1, start + 0.6), { translate: [(i - 1) * 8, -50], opacity: 0 }],
      ]),
    );
  }
  return { parts, animations: [{ name: 'idle', frames, loop: true, keys }] };
}

function sparkle(frames: number, color: string): Draft {
  const spots: [number, number, number][] = [
    [30, 34, 16],
    [64, 28, 12],
    [58, 64, 18],
    [26, 68, 10],
  ];
  const parts: AnimPart[] = [];
  const keys: AnimKey[] = [];
  spots.forEach(([x, y, r], i) => {
    parts.push(
      part(
        `s${i}`,
        star(x, y, r, i % 2 ? '#ffffff' : mix(color, '#ffffff', 0.4)) +
          el('circle', { cx: x, cy: y, r: r * 0.2, fill: '#ffffff' }),
        [x, y],
      ),
    );
    const o = i / spots.length;
    keys.push(
      ...track(`s${i}`, frames, [
        [
          0,
          {
            scale: [o < 0.5 ? 1 - o * 2 : 0, o < 0.5 ? 1 - o * 2 : 0],
            rotate: 0,
          },
        ],
        [Math.min(1, o + 0.25), { scale: [1, 1], rotate: 45 }],
        [Math.min(1, o + 0.5), { scale: [0, 0], rotate: 90 }],
      ]),
    );
  });
  return { parts, animations: [{ name: 'idle', frames, loop: true, keys }] };
}

function explosion(frames: number): Draft {
  const parts: AnimPart[] = [];
  const keys: AnimKey[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const x = C + Math.cos(a) * 12;
    const y = C + Math.sin(a) * 12;
    parts.push(
      part(
        `d${i}`,
        el('polygon', {
          points: points([
            [x - 3, y - 2],
            [x + 3, y - 3],
            [x + 2, y + 3],
            [x - 2, y + 2],
          ]),
          fill: i % 2 ? '#ffd060' : '#6a5048',
        }),
        [x, y],
      ),
    );
    keys.push(
      ...track(`d${i}`, frames - 1, [
        [0, { opacity: 0 }],
        [0.15, { translate: [0, 0], opacity: 1 }],
        [
          1,
          {
            translate: [Math.cos(a) * 34, Math.sin(a) * 34],
            rotate: 240,
            opacity: 0,
          },
        ],
      ]),
    );
  }
  parts.push(
    part(
      'smoke',
      [
        [-16, -8],
        [14, -12],
        [0, 14],
        [-18, 12],
        [18, 10],
      ]
        .map(([dx, dy]) =>
          el('circle', {
            cx: C + (dx as number),
            cy: C + (dy as number),
            r: 16,
            fill: '#8a8494',
          }),
        )
        .join(''),
    ),
    part(
      'fire',
      glowDef('g', '#ff7a2a') +
        el('circle', { cx: C, cy: C, r: 36, fill: 'url(#g)' }) +
        el('circle', { cx: C, cy: C, r: 24, fill: '#ff8a30' }) +
        el('circle', { cx: C, cy: C, r: 17, fill: '#ffc040' }),
    ),
    part(
      'core',
      el('circle', {
        cx: C,
        cy: C,
        r: 16,
        fill: '#fff6c8',
      }) + star(C, C, 26, '#ffffff', 8),
    ),
  );
  keys.push(
    ...track('core', frames - 1, [
      [0, { scale: [0.3, 0.3] }],
      [0.2, { scale: [1.2, 1.2] }],
      [0.5, { scale: [0.5, 0.5], opacity: 0 }],
    ]),
    ...track('fire', frames - 1, [
      [0, { scale: [0.1, 0.1] }],
      [0.3, { scale: [1.15, 1.15], opacity: 1 }],
      [0.85, { scale: [1.35, 1.35], opacity: 0 }],
    ]),
    ...track('smoke', frames - 1, [
      [0, { scale: [0.2, 0.2], opacity: 0 }],
      [0.35, { scale: [0.9, 0.9], opacity: 0.85 }],
      [1, { scale: [1.35, 1.35], opacity: 0, translate: [0, -8] }],
    ]),
  );
  return { parts, animations: [{ name: 'idle', frames, loop: false, keys }] };
}

function heal(frames: number, color: string): Draft {
  const plus = (x: number, y: number, s: number, c: string) =>
    el('path', {
      d:
        `M${x - s * 0.3} ${y - s}h${s * 0.6}v${s * 0.7}h${s * 0.7}` +
        `v${s * 0.6}h${-s * 0.7}v${s * 0.7}h${-s * 0.6}v${-s * 0.7}` +
        `h${-s * 0.7}v${-s * 0.6}h${s * 0.7}Z`,
      fill: c,
    });
  const parts = [
    part(
      'glow',
      glowDef('g', color) +
        el('ellipse', {
          cx: C,
          cy: 60,
          rx: 40,
          ry: 30,
          fill: 'url(#g)',
        }),
    ),
  ];
  const keys: AnimKey[] = [
    ...track('glow', frames, [
      [0, { scale: [0.9, 0.9], opacity: 0.7 }],
      [0.5, { scale: [1.1, 1.1], opacity: 1 }],
      [1, { scale: [0.9, 0.9], opacity: 0.7 }],
    ]),
  ];
  [
    [34, 64, 9],
    [60, 70, 7],
    [48, 56, 11],
  ].forEach(([x, y, s], i) => {
    parts.push(
      part(`plus${i}`, plus(x as number, y as number, s as number, i === 2 ? '#ffffff' : mix(color, '#ffffff', 0.35)), [
        x as number,
        y as number,
      ]),
    );
    const start = i / 3;
    keys.push(
      ...track(`plus${i}`, frames, [
        [start, { translate: [0, 0], opacity: 0, scale: [0.5, 0.5] }],
        [start + 0.2, { opacity: 1, scale: [1, 1] }],
        [Math.min(1, start + 0.65), { translate: [0, -36], opacity: 0 }],
      ]),
    );
  });
  parts.push(part('sparkle', star(70, 36, 8, '#ffffff'), [70, 36]));
  keys.push(
    ...track('sparkle', frames, [
      [0, { scale: [0, 0] }],
      [0.5, { scale: [1, 1], rotate: 45 }],
      [1, { scale: [0, 0], rotate: 90 }],
    ]),
  );
  return { parts, animations: [{ name: 'idle', frames, loop: true, keys }] };
}

const EFFECT_WORDS = {
  fire: ['feu', 'fire', 'flamme', 'flame', 'brasier', 'incendie'],
  explosion: ['explosion', 'boom', 'bombe', 'bomb', 'detonation'],
  heal: ['soin', 'heal', 'guerison', 'healing', 'regeneration', 'vie', 'cure'],
  sparkle: ['etincelle', 'sparkle', 'scintillement', 'eclat', 'paillettes', 'twinkle', 'etoiles'],
  burst: ['magie', 'magic', 'sort', 'spell', 'impact', 'burst', 'eclair'],
} as const;

/* ---------- Créature : slime ---------- */

const SLIME = 'M14 84C14 60 30 36 48 34C66 36 82 60 82 84C82 90 14 90 14 84Z';

function slimeDraft(names: string[], frames: number, color: string): Draft {
  const outline = outlineOf(color);
  const parts = [
    part(
      'shadow',
      el('ellipse', {
        cx: C,
        cy: 88,
        rx: 32,
        ry: 5,
        fill: '#1a1024',
        opacity: 0.25,
      }),
      [C, 88],
    ),
    part(
      'body',
      el('path', {
        d: SLIME,
        fill: color,
        stroke: outline,
        'stroke-width': 2.5,
      }) +
        el('path', {
          d: 'M20 82C30 88 66 88 76 82C74 90 22 90 20 82Z',
          fill: shade(color, -0.3),
          opacity: 0.5,
        }),
      [C, 88],
    ),
    part(
      'shine',
      el('path', {
        d: 'M28 58C32 48 38 42 44 40',
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': 4,
        'stroke-linecap': 'round',
        opacity: 0.8,
      }),
      [C, 88],
    ),
    part(
      'face',
      el('ellipse', {
        cx: 38,
        cy: 62,
        rx: 4,
        ry: 5.5,
        fill: '#2a1a2a',
      }) +
        el('ellipse', {
          cx: 58,
          cy: 62,
          rx: 4,
          ry: 5.5,
          fill: '#2a1a2a',
        }) +
        el('circle', {
          cx: 37,
          cy: 60,
          r: 1.6,
          fill: '#ffffff',
        }) +
        el('circle', {
          cx: 57,
          cy: 60,
          r: 1.6,
          fill: '#ffffff',
        }) +
        el('path', {
          d: 'M44 72Q48 76 52 72',
          fill: 'none',
          stroke: '#2a1a2a',
          'stroke-width': 2,
          'stroke-linecap': 'round',
        }),
      [C, 88],
    ),
  ];
  const follow = ['body', 'shine', 'face'];
  const animations = names.map((name): Animation => {
    const kind =
      matchKeyword(name.replace(/_/g, ' '), {
        walk: ['walk', 'move', 'hop', 'run', 'jump', 'marche'],
        attack: ['attack', 'attaque', 'bite', 'morsure', 'charge'],
        hurt: ['hurt', 'hit', 'damage', 'degat', 'blesse'],
      }) ?? 'idle';
    const keys: AnimKey[] = [];
    if (kind === 'walk') {
      const pose: [number, number, number][] = [
        [0, 1.12, 0],
        [0.25, 0.9, -18],
        [0.5, 1, -24],
        [0.75, 0.95, -12],
        [1, 1.12, 0],
      ];
      for (const id of follow) {
        keys.push(
          ...track(
            id,
            frames,
            pose.map(([t, sx, ty]) => [t, { scale: [sx, 2 - sx], translate: [0, ty] }] as [number, KeyProps]),
          ),
        );
      }
      keys.push(
        ...track('shadow', frames, [
          [0, { scale: [1, 1] }],
          [0.5, { scale: [0.7, 0.7], opacity: 0.6 }],
          [1, { scale: [1, 1] }],
        ]),
      );
      return { name, frames, loop: true, keys };
    }
    if (kind === 'attack') {
      for (const id of follow) {
        keys.push(
          ...track(id, frames - 1, [
            [0, { scale: [1, 1] }],
            [0.3, { scale: [1.12, 0.88], translate: [-8, 0] }],
            [
              0.55,
              {
                scale: [0.9, 1.1],
                translate: [18, -6],
                rotate: 10,
              },
            ],
            [1, { scale: [1, 1], translate: [0, 0], rotate: 0 }],
          ]),
        );
      }
      return { name, frames, loop: false, keys };
    }
    if (kind === 'hurt') {
      for (const id of follow) {
        keys.push(
          ...track(id, frames - 1, [
            [0, { translate: [0, 0], opacity: 1 }],
            [0.2, { translate: [-5, 0], opacity: 0.35, scale: [1.1, 0.9] }],
            [0.4, { translate: [5, 0], opacity: 1 }],
            [0.6, { translate: [-3, 0], opacity: 0.35 }],
            [1, { translate: [0, 0], opacity: 1, scale: [1, 1] }],
          ]),
        );
      }
      return { name, frames, loop: false, keys };
    }
    for (const id of follow) {
      keys.push(
        ...track(id, frames, [
          [0, { scale: [1, 1] }],
          [0.5, { scale: [1.08, 0.92] }],
          [1, { scale: [1, 1] }],
        ]),
      );
    }
    keys.push(
      ...track('shadow', frames, [
        [0, { scale: [1, 1] }],
        [0.5, { scale: [1.08, 1] }],
        [1, { scale: [1, 1] }],
      ]),
    );
    return { name, frames, loop: true, keys };
  });
  return { parts, animations };
}

/* ---------- Objets : pièce qui tourne, torche ---------- */

function coinDraft(names: string[], frames: number): Draft {
  const gold = '#f0bd3c';
  const parts = [
    part(
      'shadow',
      el('ellipse', {
        cx: C,
        cy: 86,
        rx: 22,
        ry: 4,
        fill: '#1a1024',
        opacity: 0.22,
      }),
      [C, 86],
    ),
    part(
      'coin',
      el('circle', {
        cx: C,
        cy: 46,
        r: 30,
        fill: gold,
        stroke: '#9a5a14',
        'stroke-width': 3,
      }) +
        el('circle', {
          cx: C,
          cy: 46,
          r: 22,
          fill: 'none',
          stroke: '#c47a24',
          'stroke-width': 2.5,
        }) +
        el('polygon', {
          points: points(starPoints(C, 46, 13, 5.5, 5)),
          fill: '#fff0a0',
          stroke: '#c47a24',
          'stroke-width': 2,
        }),
      [C, 46],
    ),
    part('shine', star(34, 30, 7, '#ffffff'), [34, 30]),
  ];
  const animations = names.map((name): Animation => ({
    name,
    frames,
    loop: true,
    keys: [
      ...track('coin', frames, [
        [0, { scale: [1, 1], translate: [0, 0] }],
        [0.25, { scale: [0.08, 1], translate: [0, -4] }],
        [0.5, { scale: [1, 1], translate: [0, -6] }],
        [0.75, { scale: [0.08, 1], translate: [0, -4] }],
        [1, { scale: [1, 1], translate: [0, 0] }],
      ]),
      ...track('shine', frames, [
        [0, { scale: [1, 1] }],
        [0.2, { scale: [0, 0] }],
        [0.8, { scale: [0, 0] }],
        [1, { scale: [1, 1] }],
      ]),
      ...track('shadow', frames, [
        [0, { scale: [1, 1] }],
        [0.5, { scale: [0.85, 1] }],
        [1, { scale: [1, 1] }],
      ]),
    ],
  }));
  return { parts, animations };
}

function torchDraft(names: string[], frames: number): Draft {
  const flame = fire(frames, '#f05a28');
  const scaleFlame = (p: AnimPart): AnimPart => ({
    ...p,
    svg: `<g transform="translate(24 -8) scale(0.5)">${p.svg}</g>`,
    pivot: [24 + (p.pivot[0] ?? 0) * 0.5, -8 + (p.pivot[1] ?? 0) * 0.5],
  });
  const stick = part(
    'stick',
    el('path', {
      d: 'M44 38L52 38L50 90L46 90Z',
      fill: '#7a4a2a',
      stroke: '#3a2418',
      'stroke-width': 2,
    }) +
      el('rect', {
        x: 40,
        y: 32,
        width: 16,
        height: 8,
        rx: 2,
        fill: '#6a7080',
        stroke: '#2a2e3a',
        'stroke-width': 2,
      }),
    [C, 90],
  );
  const parts = [stick, ...flame.parts.filter((p) => !p.id.startsWith('ember')).map(scaleFlame)];
  const baseKeys = (flame.animations[0] as Animation).keys.filter((k) => !k.part.startsWith('ember'));
  const animations = names.map((name): Animation => ({
    name,
    frames,
    loop: true,
    keys: baseKeys.map((k) => ({ ...k })),
  }));
  return { parts, animations };
}

/* ---------- Personnage simple ---------- */

function characterDraft(names: string[], frames: number, color: string): Draft {
  const skin = '#f3c9a7';
  const hair = '#5a3a2a';
  const outline = outlineOf(color);
  const line = { stroke: outline, 'stroke-width': 2 };
  const parts = [
    part(
      'shadow',
      el('ellipse', {
        cx: C,
        cy: 90,
        rx: 20,
        ry: 4,
        fill: '#1a1024',
        opacity: 0.25,
      }),
      [C, 90],
    ),
    part(
      'leg_l',
      el('rect', {
        x: 39,
        y: 70,
        width: 8,
        height: 18,
        rx: 3,
        fill: '#3a3446',
        ...line,
      }),
      [43, 72],
    ),
    part(
      'leg_r',
      el('rect', {
        x: 49,
        y: 70,
        width: 8,
        height: 18,
        rx: 3,
        fill: '#3a3446',
        ...line,
      }),
      [53, 72],
    ),
    part(
      'arm_l',
      el('rect', {
        x: 27,
        y: 48,
        width: 8,
        height: 22,
        rx: 4,
        fill: shade(color, -0.15),
        ...line,
      }),
      [31, 50],
    ),
    part(
      'body',
      el('rect', {
        x: 34,
        y: 46,
        width: 28,
        height: 28,
        rx: 8,
        fill: color,
        ...line,
      }) +
        el('path', {
          d: 'M40 48L48 58L56 48',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 2.5,
        }),
      [C, 74],
    ),
    part(
      'head',
      el('circle', {
        cx: C,
        cy: 32,
        r: 17,
        fill: skin,
        ...line,
      }) +
        el('path', {
          d: 'M31 30C30 16 38 12 48 12C58 12 66 16 65 30C60 22 52 22 48 26C44 22 36 22 31 30Z',
          fill: hair,
          ...line,
        }) +
        el('ellipse', {
          cx: 42,
          cy: 34,
          rx: 2.2,
          ry: 3,
          fill: '#2a1a2a',
        }) +
        el('ellipse', {
          cx: 54,
          cy: 34,
          rx: 2.2,
          ry: 3,
          fill: '#2a1a2a',
        }) +
        el('path', {
          d: 'M45 40Q48 42 51 40',
          fill: 'none',
          stroke: '#8a3a3a',
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
        }) +
        el('ellipse', {
          cx: 38,
          cy: 39,
          rx: 3,
          ry: 1.6,
          fill: '#ff8aa0',
          opacity: 0.5,
        }) +
        el('ellipse', {
          cx: 58,
          cy: 39,
          rx: 3,
          ry: 1.6,
          fill: '#ff8aa0',
          opacity: 0.5,
        }),
      [C, 48],
    ),
    part(
      'arm_r',
      el('rect', {
        x: 61,
        y: 48,
        width: 8,
        height: 22,
        rx: 4,
        fill: shade(color, -0.05),
        ...line,
      }),
      [65, 50],
    ),
  ];
  const upper = ['arm_l', 'body', 'head', 'arm_r'];
  const animations = names.map((name): Animation => {
    const kind =
      matchKeyword(name.replace(/_/g, ' '), {
        wave: ['wave', 'salut', 'hello', 'coucou', 'greet'],
        walk: ['walk', 'marche', 'run', 'move', 'cours'],
      }) ?? 'idle';
    const keys: AnimKey[] = [];
    const bob = (amp: number) =>
      track('', frames, [
        [0, { translate: [0, 0] }],
        [0.5, { translate: [0, amp] }],
        [1, { translate: [0, 0] }],
      ]);
    for (const id of upper) {
      keys.push(
        ...bob(kind === 'walk' ? -2 : 2).map((k) => ({
          ...k,
          part: id,
        })),
      );
    }
    keys.push(
      ...track('head', frames, [
        [0, { rotate: 0 }],
        [0.5, { rotate: kind === 'wave' ? 6 : 3 }],
        [1, { rotate: 0 }],
      ]),
    );
    if (kind === 'wave') {
      keys.push(
        ...track('arm_r', frames, [
          [0, { rotate: -130 }],
          [0.25, { rotate: -160 }],
          [0.5, { rotate: -120 }],
          [0.75, { rotate: -160 }],
          [1, { rotate: -130 }],
        ]),
      );
    } else if (kind === 'walk') {
      keys.push(
        ...track('arm_l', frames, [
          [0, { rotate: 25 }],
          [0.5, { rotate: -25 }],
          [1, { rotate: 25 }],
        ]),
      );
      keys.push(
        ...track('arm_r', frames, [
          [0, { rotate: -25 }],
          [0.5, { rotate: 25 }],
          [1, { rotate: -25 }],
        ]),
      );
      keys.push(
        ...track('leg_l', frames, [
          [0, { rotate: -20 }],
          [0.5, { rotate: 20 }],
          [1, { rotate: -20 }],
        ]),
      );
      keys.push(
        ...track('leg_r', frames, [
          [0, { rotate: 20 }],
          [0.5, { rotate: -20 }],
          [1, { rotate: 20 }],
        ]),
      );
    } else {
      keys.push(
        ...track('arm_l', frames, [
          [0, { rotate: 0 }],
          [0.5, { rotate: 4 }],
          [1, { rotate: 0 }],
        ]),
      );
      keys.push(
        ...track('arm_r', frames, [
          [0, { rotate: 0 }],
          [0.5, { rotate: -4 }],
          [1, { rotate: 0 }],
        ]),
      );
    }
    return { name, frames, loop: true, keys };
  });
  return { parts, animations };
}

/** Met un brouillon 96 × 96 à l'échelle d'une frame `width × height` (centré). */
function fit(draft: Draft, width: number, height: number, fps: number): Anim2dSpec {
  const k = Math.min(width, height) / U;
  const ox = (width - U * k) / 2;
  const oy = (height - U * k) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    width,
    height,
    fps,
    parts: draft.parts.map((p) => ({
      id: p.id,
      svg:
        k === 1 && ox === 0 && oy === 0
          ? p.svg
          : `<g transform="translate(${r(ox)} ${r(oy)}) scale(${r(k * 1000) / 1000})">${p.svg}</g>`,
      pivot: [r(ox + (p.pivot[0] ?? 0) * k), r(oy + (p.pivot[1] ?? 0) * k)],
    })),
    animations: draft.animations.map((a) => ({
      ...a,
      keys: a.keys.map((key) =>
        key.translate
          ? {
              ...key,
              translate: [r((key.translate[0] ?? 0) * k), r((key.translate[1] ?? 0) * k)],
            }
          : key,
      ),
    })),
  };
}

/** Animation procédurale : effet, créature (slime), objet (pièce, torche) ou personnage. */
export function proceduralAnim(params: Anim2dParams, rng: Rng): Anim2dSpec {
  const text = params.prompt;
  const frames = params.frames;
  const names = params.animations;
  let draft: Draft;
  switch (params.subject) {
    case 'creature':
      draft = slimeDraft(names, frames, colorFromText(text) ?? rng.pick(['#4cc46a', '#3a8ae8', '#e8506a', '#b060e0']));
      break;
    case 'object':
      draft = matchKeyword(text, {
        torch: ['torche', 'torch', 'flambeau', 'feu', 'fire', 'bougie', 'candle'],
      })
        ? torchDraft(names, frames)
        : coinDraft(names, frames);
      break;
    case 'character':
      draft = characterDraft(
        names,
        frames,
        colorFromText(text) ?? rng.pick(['#3a6ea5', '#b03a48', '#2f7a4a', '#6a4a9a']),
      );
      break;
    default: {
      const kind =
        matchKeyword(text, EFFECT_WORDS) ?? rng.pick(['burst', 'sparkle', 'fire', 'heal', 'explosion'] as const);
      const color =
        colorFromText(text) ??
        {
          burst: '#8a5cff',
          fire: '#f05a28',
          heal: '#4ad07a',
          sparkle: '#ffd84a',
          explosion: '#ff7a2a',
        }[kind];
      const base = {
        burst,
        fire,
        heal,
        sparkle,
        explosion: (f: number) => explosion(f),
      }[kind](frames, color);
      const anim = base.animations[0] as Animation;
      draft = {
        parts: base.parts,
        animations: names.map((name) => ({
          ...anim,
          name,
          keys: anim.keys.map((k) => ({ ...k })),
        })),
      };
    }
  }
  return fit(draft, params.width, params.height, params.fps);
}

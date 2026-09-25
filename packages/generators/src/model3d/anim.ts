import type { AnimationSpec, TrackSpec } from './dsl';
import type { Vec3 } from './builder';

/** Fabriques de pistes et d'animations pour les modèles procéduraux. */

export type Property = TrackSpec['property'];

/**
 * Oscillation sinusoïdale bouclée : `base + amplitude × sin(2π·(cycles·t/duration) + phase)`,
 * échantillonnée en `samples` clés (la dernière égale la première).
 */
export function oscillate(
  node: string,
  property: Property,
  base: Vec3,
  amplitude: Vec3,
  duration: number,
  options: { phase?: number; cycles?: number; samples?: number } = {},
): TrackSpec {
  const samples = options.samples ?? 12;
  const cycles = options.cycles ?? 1;
  const phase = options.phase ?? 0;
  const keys = Array.from({ length: samples + 1 }, (_, i) => {
    const s = Math.sin(2 * Math.PI * cycles * (i / samples) + phase);
    return {
      t: (duration * i) / samples,
      value: [base[0] + amplitude[0] * s, base[1] + amplitude[1] * s, base[2] + amplitude[2] * s],
    };
  });
  return { node, property, keys };
}

/** Piste à partir d'une liste `[temps, valeur]`. */
export function keyframes(node: string, property: Property, keys: [number, Vec3][], step = false): TrackSpec {
  const track: TrackSpec = { node, property, keys: keys.map(([t, value]) => ({ t, value })) };
  if (step) track.interpolation = 'step';
  return track;
}

export function animation(name: string, duration: number, tracks: TrackSpec[], loop = true): AnimationSpec {
  return loop ? { name, duration, tracks } : { name, duration, loop: false, tracks };
}

/** Animations génériques applicables à tout modèle via son nœud racine. */
export const GENERIC_ANIMATIONS: Record<string, (root: string) => AnimationSpec> = {
  spin: (root) =>
    animation('spin', 4, [
      keyframes(root, 'rotation', [
        [0, [0, 0, 0]],
        [1, [0, 90, 0]],
        [2, [0, 180, 0]],
        [3, [0, 270, 0]],
        [4, [0, 360, 0]],
      ]),
    ]),
  bob: (root) => animation('bob', 2, [oscillate(root, 'position', [0, 0.08, 0], [0, 0.08, 0], 2)]),
  bounce: (root) =>
    animation('bounce', 0.8, [
      keyframes(root, 'scale', [
        [0, [1, 1, 1]],
        [0.1, [1.12, 0.85, 1.12]],
        [0.3, [0.93, 1.1, 0.93]],
        [0.5, [1.03, 0.97, 1.03]],
        [0.65, [1, 1, 1]],
        [0.8, [1, 1, 1]],
      ]),
    ]),
  pulse: (root) => animation('pulse', 1.2, [oscillate(root, 'scale', [1.03, 1.03, 1.03], [0.03, 0.03, 0.03], 1.2)]),
};

/** Alias (français et anglais) des noms d'animation reconnus. */
const ALIASES: Record<string, string> = {
  rotation: 'spin',
  tourner: 'spin',
  tourne: 'spin',
  pivoter: 'spin',
  flotter: 'bob',
  flottement: 'bob',
  float: 'bob',
  hover: 'bob',
  rebond: 'bounce',
  rebondir: 'bounce',
  squash: 'bounce',
  pulsation: 'pulse',
  battement: 'pulse',
  repos: 'idle',
  respiration: 'idle',
  respirer: 'idle',
  attente: 'idle',
  breathe: 'idle',
  marche: 'walk',
  marcher: 'walk',
  course: 'run',
  courir: 'run',
  salut: 'wave',
  saluer: 'wave',
  coucou: 'wave',
  ouvrir: 'open',
  ouverture: 'open',
  fermer: 'close',
  fermeture: 'close',
  balancement: 'sway',
  balancer: 'sway',
  vent: 'sway',
  wind: 'sway',
  scintillement: 'flicker',
  vaciller: 'flicker',
  scintiller: 'flicker',
  drapeau: 'flag',
  fumee: 'smoke',
  fumée: 'smoke',
  oscillation: 'wobble',
  tremble: 'wobble',
};

/** Noms canoniques des animations demandées (minuscules, alias résolus, sans doublons). */
export function normalizeAnimationNames(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    const canonical = ALIASES[name] ?? name;
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

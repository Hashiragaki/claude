/** Mots-clés du langage (coloration syntaxique et complétion dans l'éditeur). */
export const VN_KEYWORDS = [
  'define',
  'default',
  'image',
  'include',
  'label',
  'scene',
  'show',
  'hide',
  'with',
  'at',
  'menu',
  'if',
  'elif',
  'else',
  'jump',
  'call',
  'return',
  'pause',
  'play',
  'stop',
  'voice',
  'music',
  'sound',
  'fadein',
  'fadeout',
  'loop',
  'noloop',
  'window',
  'pass',
  'centered',
  'Character',
] as const;

/** Transitions reconnues par `with`. */
export const VN_TRANSITIONS = ['fade', 'dissolve', 'none', 'moveinleft', 'moveinright', 'vpunch', 'hpunch'] as const;
export type VNTransition = (typeof VN_TRANSITIONS)[number];

/** Positions reconnues par `at`. */
export const VN_POSITIONS = ['left', 'right', 'center', 'farleft', 'farright'] as const;
export type VNPosition = (typeof VN_POSITIONS)[number];

/** Abscisse (fraction de la largeur) du point d'ancrage bas-centre de chaque position. */
export const POSITION_X: Record<VNPosition, number> = {
  farleft: 0.1,
  left: 0.25,
  center: 0.5,
  right: 0.75,
  farright: 0.9,
};

export const DEFAULT_POSITION: VNPosition = 'center';

export function isTransition(name: string): name is VNTransition {
  return (VN_TRANSITIONS as readonly string[]).includes(name);
}

export function isPosition(name: string): name is VNPosition {
  return (VN_POSITIONS as readonly string[]).includes(name);
}

/** Fraction horizontale d'une position (repli : centre). */
export function positionX(name: string): number {
  return isPosition(name) ? POSITION_X[name] : POSITION_X.center;
}

/** Images intégrées (comme dans Ren'Py) : `scene black`, `scene white`. */
export const BUILTIN_IMAGES: Record<string, number> = {
  black: 0x000000,
  white: 0xffffff,
};

/** Couleur d'une image intégrée, sinon `null`. */
export function builtinImageColor(ref: string): number | null {
  const key = ref.trim().toLowerCase();
  return Object.hasOwn(BUILTIN_IMAGES, key) ? (BUILTIN_IMAGES[key] as number) : null;
}

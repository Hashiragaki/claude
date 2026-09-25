/**
 * Gabarits ASCII des têtes du charset (cadre 16 × 24, vue de face / profil droit / dos).
 * Chaque gabarit commence à la ligne `y0` du cadre (avant le décalage de marche).
 *
 * Légende : `.` rien · `S s K` peau (base, ombre, lumière) · `E` œil ·
 * `H h L` cheveux (base, ombre, reflet) · `M m Q` accessoire (base, ombre, lumière) ·
 * `X` détail sombre (verre de lunettes, fente de casque) · `Y y` or (couronne).
 */

export type Facing = 'down' | 'right' | 'up';

export interface Template {
  y0: number;
  rows: string[];
}

const t = (y0: number, ...rows: string[]): Template => ({ y0, rows });

/** Tête nue (peau et yeux). */
export const HEADS: Record<Facing, Template> = {
  down: t(
    4,
    '.....SSSSSS.....',
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSs...',
    '...SSSSSSSSSs...',
    '...SSESSSSESs...',
    '...SSESSSSESs...',
    '....SSSSSSSs....',
    '.....ssssss.....',
  ),
  right: t(
    4,
    '.....SSSSSS.....',
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '...SSSSSSSESS...',
    '...SSSSSSSESS...',
    '....SSSSSSSs....',
    '.....sssssss....',
  ),
  up: t(
    4,
    '.....SSSSSS.....',
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSs...',
    '...SSSSSSSSSs...',
    '...SSSSSSSSSs...',
    '...SSSSSSSSSs...',
    '....SSSSSSSs....',
    '.....ssssss.....',
  ),
};

export type HairStyle = 'short' | 'long' | 'spiky' | 'bald' | 'ponytail' | 'hood';

/** Mèches arrière (dessinées avant le corps) : cheveux longs, queue-de-cheval. */
export const BACK_HAIR: Partial<Record<HairStyle, Partial<Record<Facing, Template>>>> = {
  long: {
    down: t(
      8,
      '..HH........HH..',
      '..HH........hH..',
      '..Hh........hh..',
      '..Hh........hh..',
      '..hh........hh..',
      '..hh........hh..',
      '...h........h...',
    ),
    right: t(8, '..HHH...........', '..HHH...........', '..HHh...........', '..Hhh...........', '..hhh...........', '...hh...........', '...h............'),
    up: t(
      11,
      '...HHHHHHHHHh...',
      '...HHHHHHHHhh...',
      '...HHHHHHHHhh...',
      '...hHHHHHHhhh...',
      '....hHHHHhhh....',
      '....hhhhhhhh....',
    ),
  },
  ponytail: {
    down: t(5, '.............Hh.', '.............Hh.', '.............hh.', '.............hh.', '..............h.'),
    right: t(5, '.HH.............', 'HHHh............', 'HHh.............', 'Hh..............', 'hh..............', 'h...............'),
    up: t(11, '.......HH.......', '.......Hh.......', '.......Hh.......', '.......hh.......', '........h.......'),
  },
};

/** Cheveux sur la tête (dessinés par-dessus la peau). */
export const FRONT_HAIR: Record<HairStyle, Partial<Record<Facing, Template>>> = {
  short: {
    down: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHh...',
      '...HHHHHHHHHh...',
      '...HHHHhHHHhh...',
      '...HH.H..H.Hh...',
      '...H........h...',
      '...h........h...',
    ),
    right: t(
      3,
      '.....HHHHHH.....',
      '....HHHLLLHH....',
      '...HHHLHHHHHH...',
      '...HHHHHHHHHHH..',
      '...HHHHHHHHHhH..',
      '...HHHHHHH......',
      '...HHHs.........',
      '...hHHs.........',
      '....hh..........',
    ),
    up: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHh...',
      '...HHHHHHHHHh...',
      '...HHHHHHHHHh...',
      '...HHHHHHHHhh...',
      '...HHHHHHHHhh...',
      '...hHHHHHHhhh...',
      '....hhhhhhhh....',
    ),
  },
  long: {
    down: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHh...',
      '..HHHHHHHHHHhh..',
      '..HHHHHhHHHhhh..',
      '..HHH.H..H.Hhh..',
      '..HH........hh..',
    ),
    right: t(
      3,
      '.....HHHHHH.....',
      '....HHHLLLHH....',
      '...HHHLHHHHHH...',
      '..HHHHHHHHHHHH..',
      '..HHHHHHHHHHhH..',
      '..HHHHHHHH......',
      '..HHHHs.........',
      '..HHHHs.........',
      '..HHhh..........',
    ),
    up: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHh...',
      '..HHHHHHHHHHhh..',
      '..HHHHHHHHHHhh..',
      '..HHHHHHHHHHhh..',
      '..HHHHHHHHHHhh..',
      '..HHHHHHHHHhhh..',
    ),
  },
  spiky: {
    down: t(
      2,
      '....H.HH.HH.H...',
      '...HHHHHHHHHHh..',
      '..HHLLHHHHHHHh..',
      '..HHLHHHHHHHHhh.',
      '...HHHHHHHHHhh..',
      '...HHHHhHHHhh...',
      '...H.HH.HH.Hh...',
      '...H........h...',
    ),
    right: t(
      2,
      '....HH..HH..H...',
      '...HHHHHHHHHH...',
      '..HHHHLLLHHHHH..',
      '.HHHHLHHHHHHHHH.',
      '..HHHHHHHHHHHH..',
      '...HHHHHHHHHhHH.',
      '..HHHHHHHH...h..',
      '..HHHs..........',
      '...hHs..........',
      '....hh..........',
    ),
    up: t(
      2,
      '....H.HH.HH.H...',
      '...HHHHHHHHHHh..',
      '..HHLLHHHHHHHh..',
      '..HHLHHHHHHHHhh.',
      '...HHHHHHHHHhh..',
      '..HHHHHHHHHHhh..',
      '..HHHHHHHHHHhh..',
      '...HHHHHHHHhhh..',
      '...hHHHHHHhhh...',
      '....hhhhhhhh....',
    ),
  },
  bald: {
    down: t(4, '.....KKSSSS.....', '....KSSSSSSS....'),
    right: t(4, '.....SKKSSS.....', '....SKSSSSSS....', '................', '................', '................', '......s.........', '......s.........'),
    up: t(4, '.....KKSSSS.....', '....KSSSSSSs....', '...SSSSSSSSSs...'),
  },
  ponytail: {
    down: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHhH..',
      '...HHHHHHHHHhh..',
      '...HHHHhHHHhh...',
      '...HH.H..H.Hh...',
      '...H........h...',
      '...h........h...',
    ),
    right: t(
      3,
      '.....HHHHHH.....',
      '..HHHHHLLLHH....',
      '..HHHHLHHHHHH...',
      '...HHHHHHHHHHH..',
      '...HHHHHHHHHhH..',
      '...HHHHHHH......',
      '...HHHs.........',
      '...hHHs.........',
      '....hh..........',
    ),
    up: t(
      3,
      '.....HHHHHH.....',
      '....HHLLHHHH....',
      '...HHLHHHHHHh...',
      '...HHHHHHHHHh...',
      '...HHHHHMMHHh...',
      '...HHHHHHHHhh...',
      '...HHHHHHHHhh...',
      '...hHHHHHHhhh...',
      '....hhhhhhhh....',
    ),
  },
  hood: {
    down: t(
      2,
      '.....MMMMMM.....',
      '....MQQMMMMM....',
      '...MQMMMMMMMm...',
      '..MQMMMMMMMMmm..',
      '..MMmmmmmmmmmm..',
      '..MMmHHhhHHhmm..',
      '..MMm......mmm..',
      '..MMm......mmm..',
      '..MMm......mmm..',
      '..mMm......mmm..',
      '...mmm....mmm...',
    ),
    right: t(
      2,
      '.....MMMMMM.....',
      '....MMMQQQMM....',
      '...MMMQMMMMMM...',
      '..MMMMMMMMMMMm..',
      '..MMMMMMMMmmmm..',
      '..MMMMMMMmHHh...',
      '..MMMMMMm.......',
      '..MMMMMMm.......',
      '..MMMMMMm.......',
      '..mMMMMMm.......',
      '...mmmmmm.......',
    ),
    up: t(
      2,
      '.....MMMMMM.....',
      '....MQQMMMMM....',
      '...MQMMMMMMMm...',
      '..MQMMMMMMMMmm..',
      '..MMMMMMMMMMmm..',
      '..MMMMMMMMMMmm..',
      '..MMMMMMMMMMmm..',
      '..MMMMMMMMMMmm..',
      '..MMMMMMMMMmmm..',
      '..mMMMMMMMMmmm..',
      '...mmmmmmmmmm...',
    ),
  },
};

export type Accessory = 'none' | 'hat' | 'helmet' | 'crown' | 'glasses';

/** Accessoires (dessinés en dernier). */
export const ACCESSORIES: Record<Exclude<Accessory, 'none'>, Partial<Record<Facing, Template>>> = {
  hat: {
    down: t(2, '......MMMM......', '.....MQMMMm.....', '....MQMMMMmm....', '....YYYYYYyy....', '..QMMMMMMMMMMm..'),
    right: t(2, '.....MMMM.......', '....MQMMMm......', '...MQMMMMMmm....', '...YYYYYYYyy....', '..QMMMMMMMMMMm..'),
    up: t(2, '......MMMM......', '.....MQMMMm.....', '....MQMMMMmm....', '....YYYYYYyy....', '..QMMMMMMMMMMm..'),
  },
  helmet: {
    down: t(
      2,
      '.....QQMMMM.....',
      '....QQMMMMMm....',
      '...QMMMMMMMMm...',
      '...QMMMMMMMMm...',
      '...MMMMMMMMMm...',
      '...mmmmmmmmmm...',
      '...mM.mm.mMm....',
      '...m..mm...m....',
    ),
    right: t(
      2,
      '.....QQMMMM.....',
      '....QQMMMMMM....',
      '...QMMMMMMMMM...',
      '...MMMMMMMMMMm..',
      '...MMMMMMMMMMm..',
      '...mmmmmmmmmmm..',
      '...mmmmm........',
      '...mmmm.........',
      '...mmm..........',
    ),
    up: t(
      2,
      '.....QQMMMM.....',
      '....QQMMMMMm....',
      '...QMMMMMMMMm...',
      '...MMMMMMMMMm...',
      '...MMMMMMMMMm...',
      '...MMMMMMMMmm...',
      '...mmmmmmmmmm...',
      '...mmmmmmmmmm...',
    ),
  },
  crown: {
    down: t(2, '....Y..Y..Y.....', '....YY.YY.YY....', '....YYYYYYyy....', '....yYRYYRyy....'),
    right: t(2, '.....Y..Y..Y....', '.....YY.YY.YY...', '.....YYYYYYyy...', '.....yYRYYRYy...'),
    up: t(2, '....Y..Y..Y.....', '....YY.YY.YY....', '....YYYYYYyy....', '....yYYYYYyy....'),
  },
  glasses: {
    down: t(9, '....XWXXXXWX....'),
    right: t(9, '.......XXXWX....'),
  },
};

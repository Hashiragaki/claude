/**
 * Disposition standard des tilesets Forge : chaque tileset (quel que soit son thème — village,
 * donjon, neige…) contient les mêmes « rôles » de tuiles aux mêmes index. Les cartes restent ainsi
 * valides quand on régénère ou change de tileset.
 *
 * Dans les données de carte, `-1` signifie « pas de tuile ».
 */
export type TileLayer = 'ground' | 'decor' | 'overhead';

export interface TileRole {
  index: number;
  /** Identifiant stable (anglais). */
  id: string;
  /** Nom affiché (français). */
  name: string;
  passable: boolean;
  /** Couche conseillée : `overhead` est dessinée au-dessus des personnages. */
  layer: TileLayer;
  /**
   * Collision en vue de côté (plateformer) : `solid` bloque, `oneway` se traverse par-dessous,
   * `hazard` blesse, `none` est décoratif. Absent pour les tilesets vus de dessus.
   */
  collision?: TileCollision;
}

export type TileCollision = 'none' | 'solid' | 'oneway' | 'hazard';

export const TILE_SIZE = 16;
export const TILESET_COLUMNS = 8;
export const EMPTY_TILE = -1;

const roles: [string, string, boolean, TileLayer][] = [
  // Ligne 0 : sols
  ['ground', 'Sol', true, 'ground'],
  ['ground_alt', 'Sol (variante)', true, 'ground'],
  ['ground_detail', 'Sol (détail)', true, 'ground'],
  ['path', 'Chemin', true, 'ground'],
  ['path_alt', 'Chemin (variante)', true, 'ground'],
  ['water', 'Eau', false, 'ground'],
  ['deep_water', 'Eau profonde', false, 'ground'],
  ['bridge', 'Pont', true, 'decor'],
  // Ligne 1 : structures
  ['wall_top', 'Haut de mur', false, 'decor'],
  ['wall', 'Mur', false, 'decor'],
  ['wall_window', 'Mur avec fenêtre', false, 'decor'],
  ['door', 'Porte', true, 'decor'],
  ['roof', 'Toit', false, 'decor'],
  ['roof_edge', 'Bord de toit', false, 'decor'],
  ['stairs', 'Escalier', true, 'decor'],
  ['fence', 'Barrière', false, 'decor'],
  // Ligne 2 : nature et accessoires
  ['tree_top', 'Feuillage', true, 'overhead'],
  ['tree_trunk', 'Tronc', false, 'decor'],
  ['bush', 'Buisson', false, 'decor'],
  ['rock', 'Rocher', false, 'decor'],
  ['flowers', 'Fleurs', true, 'decor'],
  ['log', 'Bûche', false, 'decor'],
  ['sign', 'Panneau', false, 'decor'],
  ['crate', 'Caisse', false, 'decor'],
  // Ligne 3 : intérieur et divers
  ['table', 'Table', false, 'decor'],
  ['chair', 'Chaise', true, 'decor'],
  ['bed', 'Lit', false, 'decor'],
  ['shelf', 'Étagère', false, 'decor'],
  ['barrel', 'Tonneau', false, 'decor'],
  ['torch', 'Torche', false, 'decor'],
  ['rug', 'Tapis', true, 'decor'],
  ['void', 'Vide', false, 'ground'],
];

export const TILE_ROLES: readonly TileRole[] = roles.map(([id, name, passable, layer], index) => ({
  index,
  id,
  name,
  passable,
  layer,
}));

/** Index par identifiant : `TILE.water === 5`. */
export const TILE = Object.fromEntries(TILE_ROLES.map((r) => [r.id, r.index])) as Record<
  | 'ground'
  | 'ground_alt'
  | 'ground_detail'
  | 'path'
  | 'path_alt'
  | 'water'
  | 'deep_water'
  | 'bridge'
  | 'wall_top'
  | 'wall'
  | 'wall_window'
  | 'door'
  | 'roof'
  | 'roof_edge'
  | 'stairs'
  | 'fence'
  | 'tree_top'
  | 'tree_trunk'
  | 'bush'
  | 'rock'
  | 'flowers'
  | 'log'
  | 'sign'
  | 'crate'
  | 'table'
  | 'chair'
  | 'bed'
  | 'shelf'
  | 'barrel'
  | 'torch'
  | 'rug'
  | 'void',
  number
>;

/** Métadonnées d'un tileset généré (fichier JSON annexe `extra.tiles`). */
export interface TilesetInfo {
  tileSize: number;
  columns: number;
  theme: string;
  /** Disposition : `topdown` (RPG, défaut) ou `side` (plateformer). */
  layout?: 'topdown' | 'side';
  tiles: TileRole[];
}

// ---------------------------------------------------------------------------
// Tilesets vus de côté (mode plateformer)
// ---------------------------------------------------------------------------

/**
 * Disposition standard des tilesets « vue de côté » : 16 rôles sur 2 lignes de 8 tuiles 16×16
 * (PNG 128×32). Comme pour la vue de dessus, les niveaux restent valides quand on change de thème.
 */
export const PLATFORM_TILESET_COLUMNS = 8;

const platformRoles: [string, string, TileCollision, TileLayer][] = [
  // Ligne 0 : terrain et blocs
  ['top', 'Surface (herbe)', 'solid', 'ground'],
  ['fill', 'Terre (intérieur)', 'solid', 'ground'],
  ['top_left', 'Surface (bord gauche)', 'solid', 'ground'],
  ['top_right', 'Surface (bord droit)', 'solid', 'ground'],
  ['platform', 'Plateforme fine', 'oneway', 'ground'],
  ['brick', 'Brique', 'solid', 'ground'],
  ['stone', 'Pierre', 'solid', 'ground'],
  ['crate', 'Caisse', 'solid', 'ground'],
  // Ligne 1 : dangers, passages et décor
  ['spikes', 'Pics', 'hazard', 'ground'],
  ['water', 'Eau', 'hazard', 'ground'],
  ['bridge', 'Pont', 'oneway', 'ground'],
  ['cloud', 'Nuage', 'oneway', 'ground'],
  ['bush', 'Buisson', 'none', 'decor'],
  ['flower', 'Fleurs', 'none', 'decor'],
  ['sign', 'Panneau', 'none', 'decor'],
  ['fence', 'Barrière', 'none', 'decor'],
];

export const PLATFORM_TILE_ROLES: readonly TileRole[] = platformRoles.map(([id, name, collision, layer], index) => ({
  index,
  id,
  name,
  passable: collision !== 'solid',
  layer,
  collision,
}));

/** Index par identifiant : `PLATFORM_TILE.spikes === 8`. */
export const PLATFORM_TILE = Object.fromEntries(PLATFORM_TILE_ROLES.map((r) => [r.id, r.index])) as Record<
  | 'top'
  | 'fill'
  | 'top_left'
  | 'top_right'
  | 'platform'
  | 'brick'
  | 'stone'
  | 'crate'
  | 'spikes'
  | 'water'
  | 'bridge'
  | 'cloud'
  | 'bush'
  | 'flower'
  | 'sign'
  | 'fence',
  number
>;

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
}

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
  tiles: TileRole[];
}

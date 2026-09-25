import { PLATFORM_TILE } from '@forge/core';
import {
  PlatformerLevelSchema,
  PlatformerSystemSchema,
  type PlatformerEntityInput,
  type PlatformerLevel,
  type PlatformerSystem,
  type PlatformerSystemInput,
} from './schema';

/** Outils partagés par les tests (non exportés par le paquet). */

export const DT = 1 / 60;

/** Caractères ASCII reconnus par {@link levelFromAscii} (case = 16px). */
const CHAR_TILES: Record<string, number> = {
  '.': -1,
  ' ': -1,
  '#': PLATFORM_TILE.top,
  'F': PLATFORM_TILE.fill,
  '=': PLATFORM_TILE.platform,
  'B': PLATFORM_TILE.brick,
  'S': PLATFORM_TILE.stone,
  '^': PLATFORM_TILE.spikes,
  '~': PLATFORM_TILE.water,
};

export interface AsciiLevelOptions {
  id?: string;
  name?: string;
  tileset?: string;
  entities?: PlatformerEntityInput[];
  playerStart?: { x: number; y: number };
  next?: string;
  timeLimit?: number;
  /** Caractères supplémentaires (fusionnés avec {@link CHAR_TILES}). */
  extraTiles?: Record<string, number>;
}

/**
 * Construit un niveau à partir de lignes ASCII (une ligne par rangée, un caractère par case).
 * `P` marque le départ du joueur (sert aussi de case vide) si `playerStart` n'est pas fourni.
 */
export function levelFromAscii(rows: readonly string[], options: AsciiLevelOptions = {}): PlatformerLevel {
  const height = rows.length;
  const width = Math.max(1, ...rows.map((r) => r.length));
  const tileChars = { ...CHAR_TILES, ...(options.extraTiles ?? {}) };
  const terrain: number[] = [];
  let playerStart = options.playerStart;
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      if (ch === 'P' && !playerStart) playerStart = { x, y };
      terrain.push(ch === 'P' ? -1 : (tileChars[ch] ?? -1));
    }
  }
  return PlatformerLevelSchema.parse({
    id: options.id ?? 'test',
    name: options.name ?? '',
    width,
    height,
    tileset: options.tileset ?? 'tiles test',
    layers: { terrain, decor: [] },
    playerStart: playerStart ?? { x: 0, y: 0 },
    entities: options.entities ?? [],
    next: options.next,
    timeLimit: options.timeLimit,
  });
}

/** Système plateformer minimal valide pour les tests (physique par défaut sauf surcharges). */
export function makeSystem(overrides: Partial<PlatformerSystemInput> = {}): PlatformerSystem {
  return PlatformerSystemSchema.parse({
    levels: ['test'],
    playerCharset: 'chara test',
    ...overrides,
  });
}
